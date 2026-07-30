# Obsidian 功能对齐路线

## 目标

本项目以覆盖 Obsidian 约 90% 的本地日常能力为对齐目标，同时保留现有的三维知识地形、标签域、知识画布、本地 Agent、草稿写回、安全扫描、回收站和 GitHub 读取能力。需要联网、打印机或高度边缘化的功能不计入首要完成度。

对齐不是复制界面像素，而是逐项验证工作流、快捷键、数据兼容性和恢复能力。普通 Markdown 文件始终是数据源，不引入只能由本 App 读取的私有笔记格式。

官方功能基线：

- [Core plugins](https://obsidian.md/help/Plugins/Core%2Bplugins)
- [Command palette](https://obsidian.md/help/Plugins/Command%2Bpalette)
- [Quick switcher](https://obsidian.md/help/Plugins/Quick%2Bswitcher)
- [Search](https://obsidian.md/help/Plugins/Search)
- [Templates](https://obsidian.md/help/Plugins/Templates)
- [Daily notes](https://obsidian.md/help/Plugins/Daily%2Bnotes)
- [Obsidian URI](https://help.obsidian.md/Extending%2BObsidian/Obsidian%2BURI)
- [Version history](https://help.obsidian.md/Obsidian%2BSync/Version%2Bhistory)

## 当前矩阵

| 能力 | 状态 | 当前实现与下一步 |
| --- | --- | --- |
| File explorer | 已具备 | 可折叠文件树、右键新建/重命名/复制/剪切/删除、真实本地目录读取 |
| Graph view | 已增强 | 二维文件图谱、三维知识地形、拖动/缩放/框选、视口记忆和标签域 |
| Canvas | 已具备 | 文本、笔记、分组与连线，桌面端持久保存 |
| Tags view | 已增强 | 标签列表、标签提取、三维标签知识图谱和域视角 |
| Command palette | 第一版完成 | `Ctrl+P`、模糊搜索、最近命令排序、实际命令执行 |
| Quick switcher | 第一版完成 | `Ctrl+O`、标题/路径/别名搜索、`Shift+Enter` 精确创建、`Ctrl+Enter` 新标签 |
| Search | 第一版完成 | `Ctrl+Shift+F`、正文/路径/标签/任务/属性/正则/排除/OR 搜索 |
| Tabs | 已具备 | 左对齐标签、平滑切换、关闭与前后导航 |
| Properties | 第一版完成 | 可查看、新增、修改和删除字符串、数组、布尔与数字 frontmatter；待做全库属性视图 |
| Backlinks / Outgoing links | 第一版完成 | 左栏笔记导航可查看并打开反链、出链与未解析链接 |
| Bookmarks | 第一版完成 | 笔记书签按知识库保存在本机；待扩展到标题、搜索和图谱视图 |
| Outline | 第一版完成 | 解析 1-6 级 Markdown 标题，忽略 frontmatter/代码块并可定位编辑或阅读位置 |
| Page preview | 第一版完成 | 阅读模式双链支持悬停预览、路径/摘要/标签显示和点击打开；待做可固定的独立预览窗 |
| Daily notes | 第一版完成 | 可配置目录、日期格式和日记模板，并打开或创建今日笔记 |
| Templates | 第一版完成 | 可配置模板目录、选择模板插入并展开 `{{title}}`、`{{date}}`、`{{time}}` |
| Random note | 第一版完成 | 命令面板可随机打开当前库笔记 |
| Note composer | 第一版完成 | 可按标题提取章节并留下双链，也可把另一篇笔记合并到当前笔记且保留来源原文 |
| File recovery | 已具备基础 | 30 天回收站、预览、恢复和 Agent 授权恢复；待做逐版本内容快照 |
| Workspaces | 部分具备 | 列宽、图谱视口和标签状态可保留；待支持命名布局和一键切换 |
| Word count | 第一版完成 | 统一显示可见字数、字符数和预计阅读时间，不计入 frontmatter 与 Markdown 标记 |
| Slash commands | 第一版完成 | 编辑器输入 `/` 可插入标题、列表、任务、引用、代码块、双链、分隔线、日期和时间 |
| Footnotes view | 未开始 | 待解析脚注引用和孤立脚注 |
| Audio recorder | 未开始 | 待录音、附件写入和可选转写 |
| Slides | 未开始 | 待从 Markdown 分隔符生成演示视图 |
| Bases | 未开始 | 待基于 frontmatter 的表格、筛选、排序、公式和卡片视图 |
| Format converter / Importer | 未开始 | 待做旧格式转换和常见笔记来源导入 |
| Unique note creator | 第一版完成 | 命令面板可在“唯一笔记”目录按本地时间戳创建不重名笔记；待开放命名规则配置 |
| Web viewer | 部分具备 | 已有网页端和公开 GitHub 读取；待做 App 内安全网页视图 |
| Sync | 非本地优先项 | 已有 Git commit/push 基础；不计入本地 90% 首要完成度 |
| Publish | 非本地优先项 | 已有 Cloudflare Pages Web 端；不计入本地 90% 首要完成度 |
| Plugin ecosystem | 未开始 | 需要独立的受限插件 API、权限清单和沙箱，不能直接执行 Obsidian 插件 |

## 分阶段实现

### P0：日用导航与编辑基础

- 命令面板、快速切换、全库搜索。
- 编辑/阅读切换、今日笔记、随机笔记。
- 已完成：属性编辑、大纲、悬停预览、反链/出链面板、书签、字数统计和斜杠命令。

验收标准：不依赖文件树，用户也能只用键盘找到、打开、创建和检索笔记。

### P1：知识组织工作流

- 模板、日记配置、笔记拆分/合并、斜杠命令。
- Bases 第一版：属性表格、筛选、排序和保存视图。
- 工作区布局保存与恢复。

验收标准：常用学习、项目和资料归档流程可重复执行，不需要手工维护目录。

### P2：恢复、附件与演示

- 内容版本快照、逐版本预览和恢复。
- 录音、脚注视图、字数统计、幻灯片。
- 导入器、格式转换器、唯一笔记创建器。

验收标准：误操作可恢复，常见附件与长文档工作流完整。

### P3：扩展与协作

- 受限插件 API、权限声明、签名和沙箱。
- Git 冲突解决、分支、提交、push 和 PR 工作流。
- 公开发布范围、发布分支和链接分享。
- App URI/deep-link。

验收标准：第三方扩展不能越过安全边界；多人协作有明确冲突与审阅流程。

## 本轮落地

- 新增统一命令面板，桌面端和 Web 端共享同一个组件。
- 新增快速切换，支持标题、路径和 frontmatter 别名。
- 新增全库搜索，支持普通词、短语、正则、OR、排除、`file:`、`path:`、`content:`、`tag:`、`task:`、`task-todo:`、`task-done:` 和 `[属性:值]`。
- 新增今日笔记、随机笔记、视图切换、侧栏切换、存储和设置命令。
- 修复未连接知识库时“知识画布”错误跳转存储空间的问题；空白画布现在可直接进入和临时编辑。
- 修复未连接知识库时临时新建笔记被连接提示覆盖的问题；临时笔记现在直接进入编辑/阅读界面。
- 桌面端拦截浏览器打印快捷键，将 `Ctrl+P` 稳定交给命令面板。
- 新增左栏笔记导航：属性、大纲、反链/出链和按知识库保存的本地书签。
- 新增模板与日记设置，支持模板插入、模板变量、日记目录、日期格式与日记模板。
- 新增字数、字符数和预计阅读时间，并排除 frontmatter 与 Markdown 语法噪声。
- 新增阅读模式双链点击与悬停页预览，已解析链接展示路径、摘要和标签，未解析链接可继续创建。
- 新增编辑器斜杠命令，支持标题、列表、任务、引用、代码块、双链、分隔线、日期与时间。
- 新增唯一笔记、按标题拆分和安全合并命令；拆分会留下双链，合并默认保留来源笔记。
- 新建与打开继续复用现有标签页、草稿、自动保存和只读安全规则，没有替换三维图谱、Agent 或已有工作流。
