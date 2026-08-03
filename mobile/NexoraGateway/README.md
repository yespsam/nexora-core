# NEXORA Mobile Gateway

状态：跨端 JavaScript 契约与网页回退已实现；iOS 和 Android 原生插件等待完整 Xcode / Android SDK 工具链后实现和真机验证。

## 责任边界

手机网关是 NC-01 与云端之间唯一的公网入口，负责：

- 发现、配对、重连 NC-01，并写入版本化 BLE 快照。
- 在用户明确开启时处理语音、模型请求、加密同步和家居网关。
- 保存可撤销的设备身份；不向项链写入恢复码、模型 API Key 或长期云端令牌。
- App 退到后台后只处理必要的 BLE 状态，不持续打开麦克风。

网页、原生容器和电脑模拟器共用 [`shared/mobile-gateway.mjs`](../../shared/mobile-gateway.mjs)。调用优先级为：电脑模拟器、原生插件、Web Bluetooth。原生插件未就绪时现有网页功能不会被破坏。

## 原生插件契约

Capacitor 插件名为 `NexoraGateway`，也可以由容器直接注入 `window.NEXORA_MOBILE_GATEWAY`。必须实现：

```text
connectPendant({ version, deviceName, serviceUuid, characteristicUuid })
  -> { deviceId, name }

writePendantSnapshot({ version, deviceId, serviceUuid, characteristicUuid, payloadBase64 })
  -> void

disconnectPendant({ deviceId })
  -> void
```

推荐实现 `addListener('pendantDisconnected', callback)`，事件至少包含 `deviceId`。`payloadBase64` 解码后必须保持原始字节，不得修改 NXR1 JSON 内容；最大长度由 `PENDANT_BLE_MAX_BYTES` 限制。

## iOS 实现门槛

- 使用 Core Bluetooth central 模式和指定服务 UUID 过滤，首次配对只能由用户主动触发。
- `Info.plist` 提供蓝牙用途说明；需要后台 BLE 时声明 `bluetooth-central`。
- 使用 Core Bluetooth state preservation/restoration 恢复已连接设备，但仍要正确处理系统终止和蓝牙关闭。
- 密钥进入 Keychain；设备断开、权限拒绝和蓝牙关闭必须返回稳定错误码。

## Android 实现门槛

- Android 12 及以上按实际功能申请 `BLUETOOTH_SCAN` 与 `BLUETOOTH_CONNECT`，不申请与功能无关的权限。
- 优先使用 Companion Device Manager 完成用户可见配对，并按系统规则处理后台连接。
- 密钥进入 Android Keystore；前台服务只用于用户可见、确有必要的持续连接。

## 产品安全

当前 ESP32 固件启用了 BLE Secure Connections，但没有输入界面。EVT 后必须增加二维码或出厂设备密钥，将“看到设备名”与“拥有这台设备”区分开。物理麦克风静音必须切断电气采集路径，不能只改变页面状态。

## 当前电脑边界

本机只有 Apple Command Line Tools，没有完整 Xcode、Android SDK、`adb` 或模拟器。因此当前能验证共享协议、网页回退和模拟器，但不能声称 iOS/Android 原生包已编译。安装完整工具链后，下一门槛是两台真实手机与一台 NC-01 完成配对、后台重连和 1000 次快照稳定性测试。

官方平台依据：

- <https://developer.apple.com/documentation/corebluetooth/>
- <https://developer.apple.com/documentation/xcode/configuring-background-execution-modes>
- <https://developer.android.com/develop/connectivity/bluetooth/bt-permissions>
- <https://developer.android.com/develop/connectivity/bluetooth/ble/background>
