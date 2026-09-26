# Spacedrive 源码研究与知识卡片实施建议

研究日期：2026-09-27。结论：借鉴资源身份、数据归属和同步记录的设计，在现有项目中独立实现以知识卡片为中心的关联助手。

## 研究范围

- Spacedrive 固定提交：[`6dfeccf2113039e35f2ce735f945e70dc3e4ea45`](https://github.com/spacedriveapp/spacedrive/tree/6dfeccf2113039e35f2ce735f945e70dc3e4ea45)，提交日期为 2026-07-29。
- 对照本项目：[`4a37da0`](https://github.com/yrupeechalco-cell/personal-knowledge-agent-generic-agent-base/tree/4a37da0)，对应已发布的 0.3.4 功能及验收记录。
- 阅读了数据实体、标签操作、同步协议、知识界面与集成测试源码。没有安装运行 Spacedrive，也没有执行其测试；源码中存在测试不等于本次验证通过。
- 查询时 GitHub latest release 为 [0.4.3](https://github.com/spacedriveapp/spacedrive/releases/tag/0.4.3)，发布于 2025-03-24。下文针对上述 main 提交，不把它与该安装版本的能力混为一谈。

## 用户已经确定的产品边界

同一个个人账户同步 App 对资料的标注数据，让手机能够联想到电脑上的资料。原件各自保留；真正需要阅读、编辑或融合原件时，用户再连接设备或专门传递文件。产品主线是资料联想辅助。

这替代了早期方案中的默认正文同步、手机附件自动上传和按资料集自动保存原件。0.3.4 的实际行为尚未随本次研究改变。

## 源码确认了什么

| 观察 | 源码依据 | 对我们的意义 |
| --- | --- | --- |
| 文件实例、内容身份、用户标记分开存储 | [entry](https://github.com/spacedriveapp/spacedrive/blob/6dfeccf2113039e35f2ce735f945e70dc3e4ea45/core/src/infra/db/entities/entry.rs)、[content_identity](https://github.com/spacedriveapp/spacedrive/blob/6dfeccf2113039e35f2ce735f945e70dc3e4ea45/core/src/infra/db/entities/content_identity.rs)、[user_metadata](https://github.com/spacedriveapp/spacedrive/blob/6dfeccf2113039e35f2ce735f945e70dc3e4ea45/core/src/infra/db/entities/user_metadata.rs) | 一张资料卡可以对应多个设备位置；标记无需依附绝对路径 |
| 区分设备拥有的文件信息和共同编辑的标签等记录 | [Library Sync](https://github.com/spacedriveapp/spacedrive/blob/6dfeccf2113039e35f2ce735f945e70dc3e4ea45/docs/core/library-sync.mdx)、[Syncable](https://github.com/spacedriveapp/spacedrive/blob/6dfeccf2113039e35f2ce735f945e70dc3e4ea45/core/src/infra/sync/syncable.rs) | 原件在哪、是否可用由持有设备报告；各设备均可编辑共享标注 |
| 标签有别名、上下文和关系，标签应用记录来源及设备 | [Tag](https://github.com/spacedriveapp/spacedrive/blob/6dfeccf2113039e35f2ce735f945e70dc3e4ea45/core/src/domain/tag.rs)、[user_metadata_tag](https://github.com/spacedriveapp/spacedrive/blob/6dfeccf2113039e35f2ce735f945e70dc3e4ea45/core/src/infra/db/entities/user_metadata_tag.rs)、[ApplyTagsAction](https://github.com/spacedriveapp/spacedrive/blob/6dfeccf2113039e35f2ce735f945e70dc3e4ea45/core/src/ops/tags/apply/action.rs) | 把人工确认、规则发现、AI 建议分开，而不只存一串标签文字 |
| 同步包含补齐历史、增量变更及重连恢复的设计，并有双设备测试入口 | [实时同步测试](https://github.com/spacedriveapp/spacedrive/blob/6dfeccf2113039e35f2ce735f945e70dc3e4ea45/core/tests/sync_realtime_test.rs)、[三设备测试](https://github.com/spacedriveapp/spacedrive/blob/6dfeccf2113039e35f2ce735f945e70dc3e4ea45/core/tests/transitive_sync_backfill_test.rs) | 我们也需要断线重连、重复消息和并发修改验收，不能只测试两端第一次连通 |

## 不宜直接照搬的地方

### 元数据同步不自动等于只同步标注

Spacedrive 的 `content_identity` 包含 `text_content`，同步排除字段没有排除它；接收逻辑也接收该字段。因此它的同步模型可以携带提取文字，不能直接作为我们“标注互通”的边界。这里依据字段与序列化路径判断，不代表本次观测了其实际网络流量。

我们应建立专用的知识卡片协议，明确列出允许发送的字段，而不是把整个文件模型序列化后删几个字段。

### 知识界面有尚未接实数据的部分

[`KnowledgeView.tsx`](https://github.com/spacedriveapp/spacedrive/blob/6dfeccf2113039e35f2ce735f945e70dc3e4ea45/packages/interface/src/routes/explorer/views/KnowledgeView.tsx) 的目录列表和标签来自查询，但会话卡片、OCR 数量、转写数量等有固定示例值。[`KnowledgeInspector.tsx`](https://github.com/spacedriveapp/spacedrive/blob/6dfeccf2113039e35f2ce735f945e70dc3e4ea45/packages/interface/src/components/Inspector/variants/KnowledgeInspector.tsx) 的回复由定时器生成原型提示。

这只说明检查的这两个组件未完成真实联想交互，不据此否定仓库其他 AI 路径。它们不能直接交付为我们的关联助手。

### 同内容与同一份逻辑资料需要分别处理

Spacedrive 用内容哈希派生内容身份，并另存文件实例。我们应保留稳定的资料编号，再另外记录版本、所在设备和可选完整哈希。内容修改不应让人工标签失去归属；同内容的两个业务文件也不应未经用户确认就合并成一张卡片。抽样哈希只能作为相同内容候选，完整性验证需要完整哈希。

### 当前许可证不适合直接作为商业同类产品底座

该提交的 [LICENSE](https://github.com/spacedriveapp/spacedrive/blob/6dfeccf2113039e35f2ce735f945e70dc3e4ea45/LICENSE) 标为 FSL-1.1-ALv2，并列出竞争性商业用途和多类托管服务限制。当前决策是研究设计、独立实现。本次没有把其程序代码或资源并入本项目。

## 与本项目的差距

| 项目 | 0.3.4 当前实现 | 下一阶段 |
| --- | --- | --- |
| 原位目录与标记 | 已有扫描、摘要、分类、关键词、引用 tip、人工分类锁定 | 复用，拆出独立资料卡 |
| 资料编号 | `library.rs` 使用根目录与相对路径组合 | 稳定 UUID 与本机路径映射分开，迁移保留旧编号映射 |
| 同步内容 | `mobile_public_snapshot` 输出完整文档，包括 `text`；手机新媒体自动分块上传 | 专用卡片字段白名单；默认同步流程不含正文、附件或文件写回 |
| 账户 | 局域网二维码令牌与一个 `serverId` | 个人账户、设备登记、设备撤销和账户隔离；Codex 模型登录不能替代产品账户 |
| 手机离线 | 当前网页在浏览器中保存资料；依赖当前站点来源和连接方式 | 稳定 HTTPS 入口、本机卡片缓存；即使电脑离线也能查看已同步卡片 |
| 关系 | 已有笔记双链和画布；标签主要为文字数组 | 资料卡之间的关系、来源、确认状态与依据版本 |
| 原件使用 | 现有接口包含正文写回与附件传递 | 作为单独明确操作保留或通过外部工具完成，与卡片浏览/联想解耦 |

本项目源码依据：[library.rs](https://github.com/yrupeechalco-cell/personal-knowledge-agent-generic-agent-base/blob/4a37da0/apps/desktop/src-tauri/src/library.rs)、[mobile sync](https://github.com/yrupeechalco-cell/personal-knowledge-agent-generic-agent-base/blob/4a37da0/apps/web/src/mobile/sync.ts)、[mobile store](https://github.com/yrupeechalco-cell/personal-knowledge-agent-generic-agent-base/blob/4a37da0/apps/web/src/mobile/libraryStore.ts)、[libraryModel](https://github.com/yrupeechalco-cell/personal-knowledge-agent-generic-agent-base/blob/4a37da0/packages/workspace/src/libraryModel.ts)。

## 建议的数据与同步设计

### 卡片与原件分离

- 本机保存：授权目录、原件定位、正文索引、OCR/转写全文和文件打开权限。
- 账户同步：资料编号、显示名称、类型、来源设备、最后观测版本、标签、允许共享的摘要、知识 tip、关系及其确认状态。
- 证据定位可以同步页码、时间段、对应版本和说明；原文引用片段默认留本机，确需共享时由用户明确选择。
- 不发送正文、二进制、完整 OCR/转写、绝对路径、文件授权凭据或模型密钥。向量首版从共享卡片在本机生成。
- 摘要、名称与标签也是用户资料；由用户选择哪些资料卡进入账户同步。设置为“仅本机”的资料不进入同步队列。

### 资料事实与人工标注分开变更

来源设备更新原件状态；任何已授权设备可以更新标注。标注修改不要求原件在线，不改变原件版本。采用操作编号、基准版本、持久队列和删除记录处理重试与断线；同一字段冲突保留双方内容，人工确认结果不被 AI 建议覆盖。

设备离线时只展示最后一次同步的信息与时间，不声称知道最新文件内容。删除 App 中的关联不删除原件。源文件更新后旧推断标为待复核。

### 同账户体验采用轻量卡片中继

建议用个人账户服务保存经授权的卡片变更，并采用成熟方案保护传输与同步内容。这样电脑上传卡片后可以关机，手机稍后仍可获取卡片。原文件不进入该服务。现有局域网通道可用于前期协议验证，但不能当作跨网络账户同步已完成。

暂不引入 Spacedrive 的完整 P2P 文件系统、云盘管理和远程执行系统。服务选型、部署与账户恢复需在实际实现阶段完成；本轮没有创建线上账户服务。

## 推荐实施切片

1. **资料卡与协议分离**：新增稳定资料 ID、本机位置映射、独立卡片字段及事件；迁移旧标签；关闭新卡片模式的自动原件上传和自动下载路径。以协议测试证明确实只传卡片。
2. **同账户卡片互通**：账户与设备身份、卡片变更中继、稳定手机入口、本机缓存及冲突处理。完成电脑卡片到手机、手机标注返回电脑的完整流程。
3. **从不同角度发现关系**：先做项目/主题/人物筛选、保存视图和人工关联，再加入卡片语义检索与有说明的 AI 推荐。原件未取得时明确显示“依据摘要和标记”。

可复用现有扫描、摘要提取、分类编辑、人工锁定和部分界面；需要新增或重构资源身份、同步契约、账户服务及关系数据。当前证据不足以承诺节省具体比例或工期。

## 第一轮完整交付的验收线

- 同一账户：电脑为三份资料生成卡片，手机能按项目和主题查看，能看到原件所在设备。
- 卡片已同步后电脑关机，手机仍能基于这些卡片发现关联；手机新增标注在电脑恢复连接后到达。
- 网络记录不包含原文、图片/音视频字节、全文转写；浏览和打标不调用文件上传、下载或写回接口。
- 修改标签前后，原件路径、修改时间和完整哈希相同；移除卡片关联不删除原件。
- 断线、重复发送和并发编辑不丢失人工标注；不同账户不能读取彼此卡片。
- AI 推荐显示依据及来源版本；没有原件时不声称已阅读全文，原件后续变化后提示复核。

本轮交付为研究与方案更新；尚未改变 0.3.4 的同步行为，也未增加账户系统。
