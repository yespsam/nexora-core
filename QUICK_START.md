# NEXORA CORE 快速开始

NEXORA CORE 是一个可在手机、电脑和 NC-01 项链圆屏上运行的 3D 数字生命原型。

## 1. 直接在线使用

- 手机端：<https://nexora-core-ai.netlify.app/soulmate/>
- 项链圆屏：<https://nexora-core-ai.netlify.app/pendant-display/>

请只收藏上面的稳定地址。旧的 `qiban-companion.netlify.app` 和带部署哈希的
`--qiban-companion.netlify.app` 地址已经失效，浏览器缓存可能暂时显示旧界面，但它们不会再获得更新。

首次打开手机端时，依次完成五步：

1. 选择 LUMO、VEYR 或 AERA。
2. 取名。
3. 设置诞生日和性别。
4. 选择性格种子。
5. 确认声音并让伙伴诞生。

默认声音会随路线匹配：LUMO 使用幼灵，VEYR 使用锋鸣，AERA 使用星语。之后仍可在设置中主动更换。

## 2. 在电脑本地运行

```bash
git clone https://github.com/yespsam/nexora-core.git
cd nexora-core
npm install
npx netlify dev
```

然后打开：

```text
http://localhost:8888/soulmate/
```

本地 Netlify 开发服务器会同时提供网页、对话函数和语音函数。直接双击 HTML 只能预览静态界面，无法完整测试云端对话与真实声音。

私有电脑验收台：

```text
http://localhost:8888/device-lab/?autorun=1
```

## 3. 正确验收

打开电脑验收台并等待自动测试结束。当前有效验收必须同时满足：

- 九个原生 3D 进化形态可读取。
- 手机、电脑窗口与 240 x 240 项链圆屏保持同一身份、记忆和共鸣。
- 动作切换不重新创建模型。
- 三条形象路线分别返回匹配的神经声线。
- 对话写入历史、增加共鸣并能召回长期记忆。

实体样机仍需单独测试电池温升、麦克风回声、扬声器音质、蓝牙距离和吊环强度。

## 4. 浏览器仍显示旧版本

先确认地址栏域名是 `nexora-core-ai.netlify.app`，然后刷新页面。仍未更新时，可在地址末尾临时加入：

```text
?reset=1&release=current
```

`reset=1` 会清除当前域名下保存的伴侣资料，只应在需要重新走诞生流程时使用。正常升级不需要删除人格和记忆。

## 5. 跨设备继续陪伴

已有伙伴时，打开设置里的“加密跨设备同步”，选择“创建恢复码并开启”。请立即把 `NXR1` 恢复码保存在密码管理器或离线位置。

在新手机或电脑首次打开时，直接选择“已有伙伴？用恢复码唤醒”，粘贴恢复码即可恢复名字、人格、成长、记忆和最近对话。同步发生冲突时会合并同一伙伴的最新状态与记忆。

服务器只接收 AES-256-GCM 密文，不保存解密密钥。恢复码一旦遗失无法由服务器找回；“仅停止本机同步”不会删除云端副本，“删除云端加密副本”会永久停止所有设备继续恢复。

## 6. 数据与 API

名字、人格、成长值、对话与长期记忆默认保存在当前浏览器。设置页可以导出或导入 NEXORA 数据文件，也可以选择开启端到端加密同步。

生产站已接入 Netlify AI Gateway 和云端神经语音，不需要用户输入 API Key。开发者需要替换模型时，可在 Netlify 环境变量中配置 `OPENAI_API_KEY`、`OPENAI_BASE_URL` 和 `NETLIFY_AI_MODEL`，不要把密钥写入仓库。
