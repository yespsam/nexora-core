import {
  PENDANT_BLE_DEVICE_NAME,
  PENDANT_BLE_SERVICE_UUID,
  PENDANT_BLE_SNAPSHOT_UUID
} from './pendant-ble.mjs';

export const NEXORA_MOBILE_GATEWAY_VERSION = 1;
export const NEXORA_NATIVE_GATEWAY_NAME = 'NexoraGateway';

const gatewayModes = new Set(['native', 'web-bluetooth', 'simulation']);

function gatewayError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw gatewayError('invalid_payload', 'Pendant payload must be binary data');
}

export function encodeGatewayPayload(value) {
  const bytes = asBytes(value);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 1) binary += String.fromCharCode(bytes[offset]);
  if (typeof globalThis.btoa === 'function') return globalThis.btoa(binary);
  if (typeof globalThis.Buffer !== 'undefined') return globalThis.Buffer.from(bytes).toString('base64');
  throw gatewayError('encoding_unavailable', 'Base64 encoding is unavailable');
}

export function resolveNativeMobileGateway(host = globalThis) {
  const direct = host?.NEXORA_MOBILE_GATEWAY;
  if (direct?.connectPendant && direct?.writePendantSnapshot) return direct;
  const capacitor = host?.Capacitor?.Plugins?.[NEXORA_NATIVE_GATEWAY_NAME];
  if (capacitor?.connectPendant && capacitor?.writePendantSnapshot) return capacitor;
  return null;
}

export function detectMobileGateway({ host = globalThis, navigatorObject = host?.navigator, simulationWriter = null } = {}) {
  if (simulationWriter) return Object.freeze({ mode: 'simulation', available: true, backgroundBle: false });
  if (resolveNativeMobileGateway(host)) {
    return Object.freeze({ mode: 'native', available: true, backgroundBle: true });
  }
  if (navigatorObject?.bluetooth?.requestDevice) {
    return Object.freeze({ mode: 'web-bluetooth', available: true, backgroundBle: false });
  }
  return Object.freeze({ mode: 'unsupported', available: false, backgroundBle: false });
}

function normalizedDevice(result, fallbackName = PENDANT_BLE_DEVICE_NAME) {
  const deviceId = String(result?.deviceId || result?.id || '').trim();
  const name = String(result?.name || fallbackName).trim().slice(0, 80) || fallbackName;
  return { deviceId, name };
}

async function connectNativeGateway(gateway, onDisconnected) {
  let result;
  try {
    result = await gateway.connectPendant({
      version: NEXORA_MOBILE_GATEWAY_VERSION,
      deviceName: PENDANT_BLE_DEVICE_NAME,
      serviceUuid: PENDANT_BLE_SERVICE_UUID,
      characteristicUuid: PENDANT_BLE_SNAPSHOT_UUID
    });
  } catch (error) {
    throw gatewayError(error?.code || error?.name || 'native_connect_failed', 'Native pendant connection failed', error);
  }
  const device = normalizedDevice(result);
  let listener = null;
  if (typeof gateway.addListener === 'function') {
    listener = await gateway.addListener('pendantDisconnected', (event = {}) => {
      if (!event.deviceId || !device.deviceId || event.deviceId === device.deviceId) onDisconnected?.(event);
    });
  }
  const writer = Object.freeze({
    async writeValueWithResponse(value) {
      await gateway.writePendantSnapshot({
        version: NEXORA_MOBILE_GATEWAY_VERSION,
        deviceId: device.deviceId,
        serviceUuid: PENDANT_BLE_SERVICE_UUID,
        characteristicUuid: PENDANT_BLE_SNAPSHOT_UUID,
        payloadBase64: encodeGatewayPayload(value)
      });
    },
    async writeValue(value) {
      return this.writeValueWithResponse(value);
    }
  });
  return Object.freeze({
    mode: 'native',
    name: device.name,
    deviceId: device.deviceId,
    backgroundBle: true,
    writer,
    async disconnect() {
      await listener?.remove?.();
      await gateway.disconnectPendant?.({ deviceId: device.deviceId });
    }
  });
}

async function connectWebBluetooth(navigatorObject, onDisconnected) {
  let device;
  try {
    device = await navigatorObject.bluetooth.requestDevice({
      filters: [{ services: [PENDANT_BLE_SERVICE_UUID] }]
    });
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(PENDANT_BLE_SERVICE_UUID);
    const writer = await service.getCharacteristic(PENDANT_BLE_SNAPSHOT_UUID);
    const disconnected = (event) => onDisconnected?.(event);
    device.addEventListener?.('gattserverdisconnected', disconnected);
    return Object.freeze({
      mode: 'web-bluetooth',
      name: String(device.name || PENDANT_BLE_DEVICE_NAME).slice(0, 80),
      deviceId: String(device.id || ''),
      backgroundBle: false,
      writer,
      async disconnect() {
        device.removeEventListener?.('gattserverdisconnected', disconnected);
        device.gatt?.disconnect?.();
      }
    });
  } catch (error) {
    const code = error?.name === 'NotFoundError' ? 'connection_cancelled' : (error?.code || error?.name || 'web_bluetooth_failed');
    throw gatewayError(code, 'Web Bluetooth pendant connection failed', error);
  }
}

function connectSimulation(simulationWriter) {
  return Object.freeze({
    mode: 'simulation',
    name: `${PENDANT_BLE_DEVICE_NAME} · 电脑模拟器`,
    deviceId: 'nc01-simulator',
    backgroundBle: false,
    writer: simulationWriter,
    async disconnect() {}
  });
}

export async function connectPendantGateway({
  host = globalThis,
  navigatorObject = host?.navigator,
  simulationWriter = null,
  onDisconnected = null
} = {}) {
  const capability = detectMobileGateway({ host, navigatorObject, simulationWriter });
  if (!capability.available || !gatewayModes.has(capability.mode)) {
    throw gatewayError('gateway_unavailable', 'No pendant gateway is available');
  }
  if (capability.mode === 'simulation') return connectSimulation(simulationWriter);
  if (capability.mode === 'native') {
    return connectNativeGateway(resolveNativeMobileGateway(host), onDisconnected);
  }
  return connectWebBluetooth(navigatorObject, onDisconnected);
}

export function pendantGatewayFailureMessage(error) {
  const code = String(error?.code || error?.name || '');
  if (code === 'connection_cancelled' || code === 'NotFoundError') return '已取消连接';
  if (['NotAllowedError', 'SecurityError', 'permission_denied'].includes(code)) return '请允许蓝牙权限后重试';
  if (['bluetooth_off', 'powered_off'].includes(code)) return '请先打开手机蓝牙';
  if (code === 'gateway_unavailable') return '当前环境不支持项链连接，请使用 NEXORA 手机应用';
  return '连接失败，请让项链保持开机';
}
