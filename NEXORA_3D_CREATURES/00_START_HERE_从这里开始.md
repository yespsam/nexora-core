# NEXORA 原创 3D 伙伴

这是 NEXORA CORE 原创 3D 精灵资产的统一入口。每条路线包含幼体、成长体和共鸣体三种原生 3D 形态。

| 路线 | 角色 | 目录 | 匹配声线 |
| --- | --- | --- | --- |
| 可爱 | LUMO / 露莫 | `CUTE_LUMO/` | 幼灵：轻快、非女性 |
| 帅气 | VEYR / 维尔 | `COOL_VEYR/` | 锋鸣：低沉、非女性 |
| 优美 | AERA / 艾拉 | `BEAUTIFUL_AERA/` | 星语：中性、空灵 |

每个角色目录包含：

- `reference/`：建模使用的三视图和拆分视图。
- `model/`：轻量化 Web GLB、带骨骼模型和模型缩略图。
- `animations/`：待机、点头、亲近、招手、说话、行走、跑步动作。
- `evolution/young/`：成长体模型、缩略图与建模三视图。
- `evolution/resonance/`：共鸣体模型、缩略图与建模三视图。
- `metadata.json`：Meshy 任务和原始生成记录。

`asset-manifest.json` 记录了部署版文件大小和 SHA-256 校验值。未压缩高模保存在本地 `meshy_output/`，不会拖慢 GitHub 与手机加载。

通过浏览器访问 [`index.html`](./index.html)，可切换三只伙伴并逐项检查 7 个动作。

设计目标是原创、可收集、可培养、可进化的 3D 情感精灵。角色不复刻任何现有游戏角色、标志或道具。
