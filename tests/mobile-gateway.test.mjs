import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NEXORA_MOBILE_GATEWAY_VERSION,
  connectPendantGateway,
  detectMobileGateway,
  encodeGatewayPayload,
  pendantGatewayFailureMessage,
  resolveNativeMobileGateway
} from '../shared/mobile-gateway.mjs';
import {
  PENDANT_BLE_SERVICE_UUID,
  PENDANT_BLE_SNAPSHOT_UUID
} from '../shared/pendant-ble.mjs';

test('mobile gateway prioritizes simulation, then native, then Web Bluetooth', () => {
  const native = { connectPendant() {}, writePendantSnapshot() {} };
  const host = { NEXORA_MOBILE_GATEWAY: native };
  const navigatorObject = { bluetooth: { requestDevice() {} } };
  assert.equal(detectMobileGateway({ host, navigatorObject, simulationWriter: {} }).mode, 'simulation');
  assert.equal(detectMobileGateway({ host, navigatorObject }).mode, 'native');
  assert.equal(detectMobileGateway({ host: {}, navigatorObject }).mode, 'web-bluetooth');
  assert.equal(detectMobileGateway({ host: {}, navigatorObject: {} }).available, false);
  assert.equal(resolveNativeMobileGateway(host), native);
});

test('native gateway receives the NC-01 contract and base64 snapshot', async () => {
  const calls = [];
  const gateway = {
    async connectPendant(options) {
      calls.push(['connect', options]);
      return { deviceId: 'nc01-7', name: '我的 NC-01' };
    },
    async writePendantSnapshot(options) {
      calls.push(['write', options]);
    }
  };
  const session = await connectPendantGateway({ host: { NEXORA_MOBILE_GATEWAY: gateway } });
  await session.writer.writeValueWithResponse(new Uint8Array([0x4e, 0x58, 0x52, 0x31]));
  assert.equal(session.mode, 'native');
  assert.equal(session.backgroundBle, true);
  assert.equal(session.deviceId, 'nc01-7');
  assert.deepEqual(calls[0], ['connect', {
    version: NEXORA_MOBILE_GATEWAY_VERSION,
    deviceName: 'NEXORA NC-01',
    serviceUuid: PENDANT_BLE_SERVICE_UUID,
    characteristicUuid: PENDANT_BLE_SNAPSHOT_UUID
  }]);
  assert.equal(calls[1][1].payloadBase64, 'TlhSMQ==');
  assert.equal(calls[1][1].deviceId, 'nc01-7');
});

test('Capacitor plugin shape is accepted as a native gateway', () => {
  const plugin = { connectPendant() {}, writePendantSnapshot() {} };
  const host = { Capacitor: { Plugins: { NexoraGateway: plugin } } };
  assert.equal(resolveNativeMobileGateway(host), plugin);
  assert.equal(detectMobileGateway({ host }).backgroundBle, true);
});

test('Web Bluetooth connection resolves the expected service and characteristic', async () => {
  const calls = [];
  const writer = { async writeValueWithResponse() {} };
  const device = {
    id: 'web-nc01',
    name: 'NEXORA NC-01',
    addEventListener(name) { calls.push(['listener', name]); },
    gatt: {
      async connect() {
        calls.push(['gatt']);
        return {
          async getPrimaryService(uuid) {
            calls.push(['service', uuid]);
            return {
              async getCharacteristic(characteristicUuid) {
                calls.push(['characteristic', characteristicUuid]);
                return writer;
              }
            };
          }
        };
      }
    }
  };
  const navigatorObject = {
    bluetooth: {
      async requestDevice(options) {
        calls.push(['request', options]);
        return device;
      }
    }
  };
  const session = await connectPendantGateway({ host: {}, navigatorObject });
  assert.equal(session.mode, 'web-bluetooth');
  assert.equal(session.writer, writer);
  assert.deepEqual(calls[0][1], { filters: [{ services: [PENDANT_BLE_SERVICE_UUID] }] });
  assert.ok(calls.some(([name, value]) => name === 'service' && value === PENDANT_BLE_SERVICE_UUID));
  assert.ok(calls.some(([name, value]) => name === 'characteristic' && value === PENDANT_BLE_SNAPSHOT_UUID));
});

test('simulation session remains available without browser APIs', async () => {
  const writer = { async writeValue() {} };
  const session = await connectPendantGateway({ host: {}, navigatorObject: {}, simulationWriter: writer });
  assert.equal(session.mode, 'simulation');
  assert.equal(session.writer, writer);
  assert.match(session.name, /电脑模拟器/);
});

test('gateway payload encoding accepts binary views and rejects text', () => {
  assert.equal(encodeGatewayPayload(new Uint8Array([1, 2, 3])), 'AQID');
  assert.equal(encodeGatewayPayload(new Uint16Array([0x0201])), 'AQI=');
  assert.throws(() => encodeGatewayPayload('NXR1'), /binary data/);
});

test('gateway errors produce actionable user messages', () => {
  assert.equal(pendantGatewayFailureMessage({ code: 'connection_cancelled' }), '已取消连接');
  assert.match(pendantGatewayFailureMessage({ code: 'permission_denied' }), /蓝牙权限/);
  assert.match(pendantGatewayFailureMessage({ code: 'bluetooth_off' }), /打开手机蓝牙/);
  assert.match(pendantGatewayFailureMessage({ code: 'gateway_unavailable' }), /NEXORA 手机应用/);
});

test('native and Web Bluetooth permission failures preserve their actionable code', async () => {
  const denied = Object.assign(new Error('Denied'), { name: 'NotAllowedError' });
  await assert.rejects(
    connectPendantGateway({
      host: { NEXORA_MOBILE_GATEWAY: { async connectPendant() { throw denied; }, writePendantSnapshot() {} } }
    }),
    (error) => error.code === 'NotAllowedError' && pendantGatewayFailureMessage(error).includes('蓝牙权限')
  );
  await assert.rejects(
    connectPendantGateway({
      host: {},
      navigatorObject: { bluetooth: { async requestDevice() { throw denied; } } }
    }),
    (error) => error.code === 'NotAllowedError' && pendantGatewayFailureMessage(error).includes('蓝牙权限')
  );
});
