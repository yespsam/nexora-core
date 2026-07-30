# NEXORA CORE 私有测试云上线清单

状态：Free 私有门禁已配置，测试站已创建，Identity 为 Invite only，设备云功能关闭
日期：2026-07-30

## 已选技术路径

- 身份：Netlify Identity，测试期使用邀请制注册。
- 访问：Free 计划使用自建 Edge Function 会话门禁，覆盖页面、API、脚本和 3D 模型。
- API：Netlify Functions，统一路径 `/api/device-cloud/*`。
- 数据库：Netlify Database 托管 PostgreSQL；生产和每个 Deploy Preview 使用平台隔离的数据库分支。
- 对象存储：首轮不上传媒体；后续只保存 AES-256-GCM 加密人格快照。
- 现有生产同步：继续使用 `/api/sync`，新设备事件库默认关闭，不参与生产读写。

选择这条路径是为了沿用 Netlify Functions 和部署流程，减少新增供应商。当前账号为 Free 团队，包含每月 300 credits 和硬上限，不会自动产生超额费用；数据库活动时仍会消耗 compute 和 bandwidth credits。

## 运行时安全边界

`device-cloud.mjs` 只有在 `NEXORA_DEVICE_CLOUD_ENABLED=true` 时响应，否则统一返回 404。启用后，每个请求必须满足：

1. Edge Function 对除登录和 Identity 回调外的所有路径验证会话；错误时关闭访问，不绕过。
2. `@netlify/identity` 返回有效用户。
3. 所有写请求通过同源校验，避免 Cookie 会话被跨站利用。
4. Identity 用户 ID 经服务端 pepper 和域分离 HMAC 转换为内部 UUID，客户端不能指定数据库所有者。
5. 每个 PostgreSQL 事务设置 `app.owner_id`，由强制 RLS 再做一次隔离。
6. 事件仍须通过设备 ES256 签名、序号、哈希链、密钥版本和撤销状态验证。

门禁返回 `private, no-store`，Service Worker 不再保存产品 shell；退出时清理 Cache Storage 并注销旧 Service Worker。登录、邀请、确认和密码恢复只接受同源请求，回跳地址仅允许站内路径。

函数使用 `@netlify/database` 提供的当前部署分支连接池。Netlify Database 以平台管理员执行迁移，并向部署代码提供对应 production 或 Preview 分支的连接；平台统一管理迁移事务，迁移文件本身不嵌套 `BEGIN/COMMIT`。迁移不创建或修改平台角色，但会验证所有产品表均启用且强制 RLS，并撤销 `PUBLIC` 权限。每个应用事务只通过服务端设置 `app.owner_id`，事件删除还需要事务级维护标记。独立的 API/维护角色和显式事务继续用于本机 PostgreSQL 测试环境。

## 必需环境变量

| 名称 | 作用 | 生产要求 |
| --- | --- | --- |
| `NEXORA_DEVICE_CLOUD_ENABLED` | 云事件 API 总开关 | 初始为 `false` |
| `NEXORA_SUBJECT_PEPPER` | Identity 主体 HMAC | 至少 32 个随机字符，仅 Functions scope |

数据库连接由 Netlify 根据 production、branch deploy 或 Deploy Preview 自动注入，不保存手工连接串。

## 部署顺序

1. 已创建全新的 `nexora-core-staging` 项目，没有连接或覆盖账号内现有两个项目。
2. 已在空项目中开启 Identity，并在任何产品文件部署前把注册改为 Invite only。
3. 只邀请内部测试账号，验证未受邀邮箱不能建立会话。
4. 配置 pepper，并保持 production context 的设备云总开关为 `false`。
5. 部署 Preview；Netlify 自动创建隔离数据库分支并依次执行三份迁移。
6. 先验证未登录页面、API 和 GLB 文件均被拦截，再在 Preview context 开启设备云总开关。
7. 运行真实 Identity 登录、RLS、30 条函数链路和 1000 条事件验收。
8. 连续一周对账通过后，才开始现有 Blob 快照到事件库的受控双写。

## 上线验收

- 未登录请求与错误 Origin 均被拒绝。
- 未登录直接请求 `.glb`、JavaScript、manifest 和 API 时不能获得产品内容。
- Identity 注册必须为 Invite only，公开 signup 不得上线。
- 客户端传入的 owner header 或外部主体字段不会改变数据库所有者。
- A 用户无法读取 B 用户的保险库，即使知道公共保险库 ID。
- 被撤销设备不能提交事件或拉取事件。
- 普通 API 角色不能删除事件，维护角色也只能删除当前所有者的数据。
- 数据库、对象存储和函数日志中不出现伙伴名字、对话、记忆、恢复密钥或原始音频。
- 关闭总开关后路径返回 404，原 `/api/sync` 不受影响。

## 当前阻断项

- Free 自建门禁已完成本机绕过测试，仍需完成首次成功部署后的真实 Netlify Edge 与 Identity 会话验收。
- 设备云总开关保持关闭；数据库迁移和真实函数链路尚未完成云端验收。
- 生产依赖审计为 0 个漏洞；完整开发依赖审计仍需单独授权向 npm 外传完整开发依赖图。
- 删除工作器和对象存储快照将在测试云资源确定后实现，不能使用用户请求直接执行即时删除。
