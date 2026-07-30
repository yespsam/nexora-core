# NEXORA CORE 私有测试云上线清单

状态：Free 私有门禁、production 数据库与隔离分支加密生命周期验收已完成，私有 GitHub 持续部署已连接，隔离分支一周双写对账进行中，Identity 为 Invite only，production 设备云功能关闭
日期：2026-07-31

## 已选技术路径

- 身份：Netlify Identity，测试期使用邀请制注册。
- 访问：Free 计划使用自建 Edge Function 会话门禁，覆盖页面、API、脚本和 3D 模型。
- API：Netlify Functions，统一路径 `/api/device-cloud/*`。
- 数据库：Netlify Database 托管 PostgreSQL；生产和每个 Deploy Preview 使用平台隔离的数据库分支。
- 对象存储：只保存 AES-256-GCM 加密人格快照，不保存明文人格或原始语音；同月自动压缩为最近 3 份并保留每月最新灾备。
- 现有生产同步：继续使用 `/api/sync`；客户端双写只有在独立开关明确开启时才镜像到设备事件库，旧同步始终先完成并保持权威读源。
- 持续部署：私有仓库 `yespsam/nexora-core` 连接到 Netlify 项目 `nexora-core-staging`；`main` 是生产分支，`product/private-cloud-staging` 是允许的隔离测试分支。

选择这条路径是为了沿用 Netlify Functions 和部署流程，减少新增供应商。当前账号为 Free 团队，包含每月 300 credits 和硬上限，不会自动产生超额费用；数据库活动时仍会消耗 compute 和 bandwidth credits。

## 运行时安全边界

`device-cloud.mjs` 只有在 `NEXORA_DEVICE_CLOUD_ENABLED=true` 时响应，否则统一返回 404。启用后，每个请求必须满足：

1. Edge Function 对除登录和 Identity 回调外的所有路径验证会话；错误时关闭访问，不绕过。
2. `@netlify/identity` 返回有效用户。
3. 所有写请求通过同源校验，避免 Cookie 会话被跨站利用。
4. Identity 用户 ID 经服务端 pepper 和域分离 HMAC 转换为内部 UUID，客户端不能指定数据库所有者。
5. 每个 PostgreSQL 事务设置 `app.owner_id`，所有用户数据查询同时显式包含 `owner_id` 条件；强制 RLS 作为额外隔离层。
6. 事件仍须通过设备 ES256 签名、序号、哈希链、密钥版本和撤销状态验证。
7. 快照上传必须来自未撤销设备，密钥版本和游标不能超前；下载前同时校验对象大小和 SHA-256。
8. 删除只能由无公开路径的计划函数在宽限期结束后执行；对象清除失败时数据库事务回滚并等待重试。

门禁返回 `private, no-store`，Service Worker 不再保存产品 shell；退出时清理 Cache Storage 并注销旧 Service Worker。登录、邀请、确认和密码恢复只接受同源请求，回跳地址仅允许站内路径。

函数使用 `@netlify/database` 提供的当前部署分支连接池。Netlify Database 以平台管理员执行迁移，并向部署代码提供对应 production 或 Preview 分支的连接；平台统一管理迁移事务，迁移文件本身不嵌套 `BEGIN/COMMIT`。迁移不创建或修改平台角色，但会验证所有产品表均启用且强制 RLS，并撤销 `PUBLIC` 权限。

真实分支验收确认 Netlify 托管连接可能绕过 PostgreSQL RLS，因此应用不能只依赖 `app.owner_id` 和策略。`DeviceCloudStore` 的保险库、设备、事件、恢复信封、撤销和删除查询全部显式绑定服务端派生的 `owner_id`；自动化测试会拒绝新增缺少 owner 条件的查询。RLS 在不具备 bypass 权限的运行角色中继续提供第二层隔离。独立的 API/维护角色和显式事务继续用于本机 PostgreSQL 测试环境。

## 必需环境变量

| 名称 | 作用 | 生产要求 |
| --- | --- | --- |
| `NEXORA_DEVICE_CLOUD_ENABLED` | 云事件 API 总开关 | 初始为 `false` |
| `NEXORA_DEVICE_CLOUD_DUAL_WRITE_ENABLED` | 旧同步成功后的客户端加密镜像开关 | 初始为 `false`，仅隔离分支对账期启用 |
| `NEXORA_DEVICE_CLOUD_MAINTENANCE_ENABLED` | 每小时删除工作器开关 | 初始为 `false`，只和总开关同时启用 |
| `NEXORA_SUBJECT_PEPPER` | Identity 主体 HMAC | 至少 32 个随机字符，仅 Functions scope |

数据库连接由 Netlify 根据 production、branch deploy 或 Deploy Preview 自动注入，不保存手工连接串。CLI alias 不属于真实 branch deploy；本次验收仅为绕过平台未注入连接的问题，短时设置了 `device-cloud-test` 分支专用连接串，并在验收后立即删除且重新部署。

## 部署顺序

1. 已创建全新的 `nexora-core-staging` 项目，没有连接或覆盖账号内现有两个项目；Netlify GitHub App 只获准读取私有仓库 `yespsam/nexora-core`。
2. 已在空项目中开启 Identity，并在任何产品文件部署前把注册改为 Invite only。
3. 只邀请内部测试账号，验证未受邀邮箱不能建立会话。
4. 配置 pepper，并保持 production context 的设备云总开关为 `false`。
5. production 原子部署会应用四份迁移；设备云和维护函数仍由两个独立开关关闭。
6. 已验证正式域名的未登录页面、API 和 GLB 文件均被拦截；仅在 `branch-deploy` context 开启设备云总开关。
7. 已用真实 Identity 登录完成事件链路、跨 owner 隔离、加密快照往返、重复快照幂等、保留压缩、删除取消和到期删除验收。
8. 定向维护执行处理 1 条、失败 0 条，删除 3 个加密对象；独立复核确认账户、快照索引、删除请求和对象存储全部完成。退出流程已跳转到 `signedOut=1` 并确认缓存清理文案。
9. 临时验收页面、函数和数据库连接串已从发布内容及环境变量移除；客户端受控双写机制在获得真实 branch deploy 数据库连接前保持关闭。
10. 2026-07-31 已只为 `product/private-cloud-staging` 设置双写开关并启动对账，计划于 2026-08-07 结束；production 上下文继续保持关闭。
11. Safari 真实登录会话已完成首日同步基线：服务器状态为 `enabled/authenticated/dualWrite=true`，本机只读诊断为已验证 revision 3、事件游标 3，相关 Functions 日志无错误。

双写按“旧同步成功 → 保存旧 revision → 生成签名密文事件 → 写入事件库 → 读回并核对正文、哈希和解密结果”的顺序执行。新路径的超时、注册失败或读回失败只记录不含用户内容的状态，不会把已经成功的旧同步改成失败；未确认的事件会加密保存在 IndexedDB，并以同一个事件 ID 幂等重试。用户删除云副本时，旧 Blob 删除和事件库七天删除请求必须同时进入完成状态，本机设备私钥随后清除。

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
- 关闭双写开关时不创建本机设备密钥、不注册设备、不提交事件；已经参与双写的用户仍能发起事件库删除。

## 当前阻断项

- Free 自建门禁、受邀账号登录、退出和密码恢复表单已通过真实 Netlify 用户体验验收；密码恢复邮件投递仍需在正式发件域配置后复测。
- production 设备云和维护开关保持关闭。正式启用前必须为 production context 单独设置长期稳定的 `NEXORA_SUBJECT_PEPPER`，不得复用或轮换测试密钥。
- 生产依赖审计为 0 个漏洞；完整开发依赖审计仍需单独授权向 npm 外传完整开发依赖图。
- 快照、Netlify Blobs 往返和删除工作器已通过隔离分支验收；受控双写代码、失败隔离、幂等重试和删除协调已通过自动化测试，一周真实对账已启动。剩余风险集中在对账结果、真机网络和 production 独立密钥管理。
