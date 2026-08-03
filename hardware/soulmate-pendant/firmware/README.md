# NEXORA CORE NC-01 固件原型

这是 `Waveshare ESP32-S3-LCD-1.28` 非触控版的首个可编译固件工程。它不是手机页面，而是直接运行在项链主板上的 `240 x 240` 圆屏界面。

## 当前已接通

- GC9A01A 圆屏：显示三条出生路线、三个进化阶段，每个形态含六种互动姿势，共 54 套角色帧。
- BLE GATT：手机可同步名字、伙伴路线、进化阶段、共鸣值、电量和交互状态。
- 运行状态：`boot`、`idle`、`affection`、`listening`、`thinking`、`speaking`、`happy`、`notice`、`charging`、`low-power`、`sleep`。
- 本地身份：断电后通过 ESP32 `Preferences` 恢复角色资料。
- 电池 ADC：按官方 GPIO 1 与三倍分压公式读取；USB 空载不会再被误判为低电量，首件上板后仍需校准曲线。
- 串口台架：没有手机时也可直接发送一行 JSON 检查完整状态机。
- EVT 外设自检：已提供 INMP441 收音电平、MAX98357A 低音量提示音、GPIO4 MOS 震动脉冲、QMI8658 身份读取和静音开关状态命令。

手机仍负责语音识别、大模型和日常声音播放。当前新增的是到货台架自检，不是离线唤醒词或项链端完整语音链路；这两项必须在实体音频模块完成噪声、回声和功耗测量后再启用。四段实体导光灯同样需要先确定 LED 驱动电路和 GPIO。

## 构建

在仓库根目录运行：

```bash
python3 -m pip install --user platformio
npm run build:pendant-firmware
npm run build:pendant-firmware-fs
npm run package:pendant-firmware
```

第一条命令会把 54 张透明 WebP 互动姿势转为圆屏可流式读取的 `NXR1 / RGB565` 帧，再编译应用。第二条命令生成 8 MB LittleFS 镜像。第三条命令重做两项构建并生成工厂镜像与 ZIP 刷机包。构建产物位于：

```text
.pio/build/nc01/firmware.bin
.pio/build/nc01/bootloader.bin
.pio/build/nc01/partitions.bin
.pio/build/nc01/littlefs.bin
```

连接主板后刷入应用和角色资源：

```bash
python3 -m platformio run -d hardware/soulmate-pendant/firmware -t upload
python3 -m platformio run -d hardware/soulmate-pendant/firmware -t uploadfs
```

首轮整片刷写所用偏移如下；仓库本地验收时也会在 `output/pendant-firmware/nc01-flash-bundle/` 生成合并后的 `nexora-nc01-factory.bin`：

| 偏移 | 文件 |
| --- | --- |
| `0x0000` | `bootloader.bin` |
| `0x8000` | `partitions.bin` |
| `0xe000` | `boot_app0.bin` |
| `0x10000` | `firmware.bin` |
| `0x610000` | `littlefs.bin` |

## BLE 契约

- 设备名：`NEXORA NC-01`
- 服务：`c8a10000-5101-4e58-9a18-8f352dc80101`
- 快照特征：`c8a10001-5101-4e58-9a18-8f352dc80101`，支持加密的 `read / write` 与 `notify`
- 最大负载：`384 bytes`

示例：

```json
{"v":1,"profileId":"soulmate-demo","name":"星澜","starter":"beautiful","stage":"young","bond":108,"state":"speaking","battery":76}
```

同样的 JSON 可通过 `115200` 波特率串口发送。固件会返回当前规范化快照，适合在装入外壳前逐状态检查。

外设自检每次只执行一项，避免接线错误时同时给多个模块上电：

```json
{"diagnostic":"imu"}
{"diagnostic":"microphone"}
{"diagnostic":"speaker"}
{"diagnostic":"haptic"}
{"diagnostic":"mute"}
```

`microphone` 返回原始峰值，必须在安静与说话两种条件下比较，不能只看一次 `PASS`。`speaker` 会播放约 350 ms、660 Hz 的低音量提示音。`haptic` 只驱动 GPIO4 对应的板载 MOS 触点；没有核对实板触点前不要把马达接到普通 GPIO。

## 上板前仍需确认

1. 当前引脚按 Waveshare 官方页面配置：LCD `DC 8 / CS 9 / CLK 10 / MOSI 11 / RST 12 / BL 40`，电池 ADC 为 `GPIO 1`。
2. QMI8658 已能做总线身份自检，但抬腕唤醒尚未启用；应基于实体板校准方向、阈值和中断脚后启用，避免佩戴时误唤醒。
3. BLE Secure Connections 已开启但没有屏幕输入能力。进入真实产品阶段前，手机端需增加二维码或出厂密钥配对，不能只依赖设备名。
4. 充电状态目前由手机/台架写入；主板充电管理芯片的可读状态脚需要实测确认。
