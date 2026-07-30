# NEXORA CORE 私有测试云上线清单

状态：代码就绪，云资源未创建，生产功能关闭
日期：2026-07-30

## 已选技术路径

- 身份：Netlify Identity，测试期使用邀请制注册。
- API：Netlify Functions，统一路径 `/api/device-cloud/*`。
- 数据库：Netlify Database 或兼容的托管 PostgreSQL 16，函数只使用 pooled URL。
- 对象存储：首轮不上传媒体；后续只保存 AES-256-GCM 加密人格快照。
- 现有生产同步：继续使用 `/api/sync`，新设备事件库默认关闭，不参与生产读写。

选择这条路径是为了沿用当前 Netlify 站点、函数和部署流程，减少新增供应商。Netlify Database 会消耗账户 credits，创建前必须确认预算和数据地区。

## 运行时安全边界

`device-cloud.mjs` 只有在 `NEXORA_DEVICE_CLOUD_ENABLED=true` 时响应，否则统一返回 404。启用后，每个请求必须满足：

1. `@netlify/identity` 返回有效用户。
2. 所有写请求通过同源校验，避免 Cookie 会话被跨站利用。
3. Identity 用户 ID 经服务端 pepper 和域分离 HMAC 转换为内部 UUID，客户端不能指定数据库所有者。
4. 每个 PostgreSQL 事务设置 `app.owner_id`，由强制 RLS 再做一次隔离。
5. 事件仍须通过设备 ES256 签名、序号、哈希链、密钥版本和撤销状态验证。

函数数据库池默认每实例最多 2 条连接，并设置连接、语句和查询超时。`NETLIFY_DB_URL` 管理员连接只用于迁移，不得配置为函数运行连接。

## 必需环境变量

| 名称 | 作用 | 生产要求 |
| --- | --- | --- |
| `NEXORA_DEVICE_CLOUD_ENABLED` | 云事件 API 总开关 | 初始为 `false` |
| `NEXORA_SUBJECT_PEPPER` | Identity 主体 HMAC | 至少 32 个随机字符，仅 Functions scope |
| `NEXORA_CLOUD_API_DATABASE_URL` | 普通 API 数据库角色 pooled URL | 仅 `SELECT/INSERT/UPDATE` 所需表，事件无删除权 |
| `NEXORA_CLOUD_MAINTENANCE_DATABASE_URL` | 删除工作器角色 pooled URL | 与普通函数分离，不暴露给前端 |
| `NEXORA_CLOUD_POOL_MAX` | 单函数实例连接上限 | 默认 `2`，范围 `1-8` |

## 部署顺序

1. 确认测试用户所在地区、数据库地区和 credits 预算。
2. 在 Netlify 开启 Identity，设置为邀请制，只邀请内部测试账号。
3. 创建独立测试数据库或数据库分支，不复用生产站当前数据。
4. 使用管理员连接依次执行 `001`、`002` 迁移，然后创建 API 与维护角色。
5. 把两个最小权限 pooled URL 和 pepper 写入 Netlify Functions 环境变量。
6. 保持生产 context 的总开关为 `false`，只在 Deploy Preview 或独立测试站启用。
7. 部署 Preview 后运行真实 Identity 登录验收；Identity 当前不能通过 `netlify dev` 完整测试。
8. 运行身份、RLS、30 条函数链路和 1000 条事件压力验收。
9. 连续一周对账通过后，才开始现有 Blob 快照到事件库的受控双写。

## 上线验收

- 未登录请求与错误 Origin 均被拒绝。
- 客户端传入的 owner header 或外部主体字段不会改变数据库所有者。
- A 用户无法读取 B 用户的保险库，即使知道公共保险库 ID。
- 被撤销设备不能提交事件或拉取事件。
- 普通 API 角色不能删除事件，维护角色也只能删除当前所有者的数据。
- 数据库、对象存储和函数日志中不出现伙伴名字、对话、记忆、恢复密钥或原始音频。
- 关闭总开关后路径返回 404，原 `/api/sync` 不受影响。

## 当前阻断项

- 尚未确认测试云地区和 credits 预算，因此没有创建云数据库。
- 尚未在站点开启 Netlify Identity。
- npm 安装报告 8 个高危公告；必须在用户明确允许把私有依赖清单发送给 npm 审计服务后完成归因。
- 删除工作器和对象存储快照将在测试云资源确定后实现，不能使用用户请求直接执行即时删除。
