# NEXORA CORE

NEXORA CORE 是一个开源的随身 AI 情感伙伴原型。伙伴以原创 3D 生物形象出现，可以在手机、电脑桌面和 NC-01 项链圆屏模拟器中互动，并通过持续对话形成名字、生日、性格、记忆与成长阶段。

[在线体验](https://nexora-core-ai.netlify.app/soulmate/) · [项链 3D 运行台](https://nexora-core-ai.netlify.app/pendant-display/) · [电脑测试台](https://nexora-core-ai.netlify.app/device-lab/?autorun=1) · [X / Twitter @yesp999](https://x.com/yesp999)

![NEXORA CORE 3D companion](NEXORA_3D_CREATURES/CUTE_LUMO/model/thumbnail.png)

## 三种初始伙伴

| 路线 | 伙伴 | 风格 | 默认声线 |
| --- | --- | --- | --- |
| 可爱 | LUMO / 露莫 | 温暖、活泼、亲近 | 幼灵 |
| 帅气 | VEYR / 维尔 | 锐利、克制、守护 | 锋鸣 |
| 优美 | AERA / 艾拉 | 空灵、安静、细腻 | 星语 |

每个伙伴包含原生 GLB 模型，以及待机、亲近、点头、招手、说话、行走和跑步动作。项链网页只显示 3D 角色，不再提供 2D 造型切换。

## 当前能力

- 首次开机设置名字、生日、性别、初始伙伴和声线。
- 文字或语音对话，并保存有限的本地关系记忆与人格成长数据。
- 三套原创 3D 伙伴和独立动作资源。
- 手机端、透明桌面端、`240 x 240` 项链圆屏和电脑双端测试台。
- Web Bluetooth 身份与状态同步协议。
- Netlify Functions 聊天与云端神经语音接口。
- ESP32-S3 NC-01 固件、3D 打印外壳、切片模拟和装配资料。

## 快速运行

需要 Node.js 20 或更新版本。

```bash
git clone https://github.com/yespsam/nexora-core.git
cd nexora-core
npm install
npx netlify dev
```

启动后打开：

```text
http://localhost:8888/soulmate/
http://localhost:8888/pendant-display/
http://localhost:8888/device-lab/?autorun=1
```

项目可以在没有开发板时完成手机端、项链端、BLE 数据、对话、语音和角色动作模拟。

## 验证

```bash
npm test
npm run test:computer
```

`npm test` 检查聊天、人格、3D 资源、BLE 协议、项链状态和语音配置。`npm run test:computer` 还会编译 ESP32-S3 固件并运行 NC-01 数字样机实验。

## 项目结构

| 路径 | 内容 |
| --- | --- |
| `soulmate/` | 手机端伙伴与对话界面 |
| `pendant-display/` | 只显示 3D 角色的 NC-01 圆屏模拟器 |
| `device-lab/` | 手机与项链联合自动测试台 |
| `NEXORA_3D_CREATURES/` | LUMO、VEYR、AERA 模型与动作 |
| `shared/` | 人格、BLE、3D 和状态机共享模块 |
| `netlify/functions/` | 聊天与语音云函数 |
| `hardware/soulmate-pendant/` | 固件、外壳、打印和实验资料 |

## 硬件状态

当前目标板为 Waveshare ESP32-S3-LCD-1.28，圆屏分辨率为 `240 x 240`。浏览器端直接运行 WebGL 3D；实体低功耗固件需要将同一角色设计转换为适合 ESP32-S3 的显示资源。

电脑模拟不能替代实体麦克风、扬声器、IMU、电池温升、蓝牙距离、跌落和佩戴强度测试。

## API 与隐私

不要把 API Key 提交到 GitHub。开发环境使用 `.env` 或 `.env.local`，线上密钥应配置在 Netlify 环境变量中。伴侣资料默认保存在用户浏览器本地，项链 BLE 快照只同步必要的身份、成长和即时状态字段。

## 参与项目

欢迎通过 GitHub Issues 和 Pull Requests 提交问题、角色动作改进、硬件验证结果与新功能。项目动态发布在 [X / Twitter @yesp999](https://x.com/yesp999)。

## License

本项目采用 [MIT License](LICENSE)。
