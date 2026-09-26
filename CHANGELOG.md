# Changelog

## 0.3.5 - 2026-09-27

- 先在电脑端提供独立知识卡片：稳定资料编号、多个分类视角、关键词搜索、摘要编辑、来源设备及最后观察状态。原件暂不可用时仍能编辑卡片；明确的同目录文本重命名保留卡片编号。
- 已有摘要、分类、标签和知识要点迁入卡片，全部默认「仅本机」。手动设为「可共享」后，可预览和导出严格限定字段的 JSON：不序列化正文、引用原文、附件字节、绝对路径或配对凭据。尚未接入个人账户或手机卡片同步。
- 新索引使用 `document-library/index-v3.json`；升级前的 `index-v1.json` 保持原样，支持安装 0.3.4 回到升级前的索引。新版本增加的标注留在 v3 索引，回滚不会自动合并。
- 卡片保存检查版本，失败保留编辑草稿；保存或放弃前阻止切换和导出。移除监测目录后保留卡片并恢复为仅本机，不删除原文件。
- 本轮先试用电脑端，暂停旧手机正文/附件自动同步及其接口，启动时不恢复旧传输服务。手机已有本机资料保留；原件显式传递将在后续独立接入。
- GitHub 改造前回滚标签：`rollback/desktop-before-knowledge-cards-2026-09-27`；开发分支：`codex/desktop-knowledge-cards`。操作与回滚说明见 `docs/DESKTOP_KNOWLEDGE_CARDS.md`。

## 0.3.4 - 2026-09-26

- 手机导入前增加文件访问说明和「暂不允许 / 允许并选择文件」弹窗；确认后才打开系统选择器，说明本机副本、原文件不变及配对同步范围。取消不影响其他功能，每次导入仍由用户选择资料。
- 支持图片、音频、视频原文件导入与本机持久保存，图片缩略图/放大、音视频播放器、分类标签、类型筛选和原文件导出。支持的格式在设备无法解码时提示另存打开，保留原文件。
- 移除附件单个文件和批次的固定大小上限，改用实际浏览器存储配额、电脑可用磁盘空间及写入结果判断。验证格式与文件头，整批成功后才写入资料目录，失败清理本批临时附件。
- 修复大视频被固定大小拦截：附件以 4 MB 分块保存、上传和下载，显示进度；上传中断按已保存的位置续传，完成后流式写入电脑文件。过期临时上传会清理，空间不足时保留原文件并说明原因。
- 手机附件以原格式同步到电脑选定收件目录；电脑已收录附件打开时下载到手机，按版本缓存。复用配对认证、目录边界、幂等重试和分类冲突处理。
- 本机目录备份明确不包含附件二进制，原文件可单独导出或同步到电脑。图片识别、音视频转写和自动内容摘要尚未接入。

## 0.3.3 - 2026-09-26

- 手机从临时只读预览升级为 IndexedDB 本机知识库：新建、导入、正文编辑、摘要、分类、关键词、搜索、归档及完整 JSON 备份。
- Windows App 增加「手机同步」入口和配对二维码；明确开启后，同一局域网内的手机与文件知识库自动双向同步，手机新笔记保存到用户选择的目录。
- 待同步修改持久保存，断线后恢复连接重试；版本冲突保留双方内容，不自动覆盖；同步响应不覆盖等待期间产生的新编辑。
- 原文件内容编辑复用桌面原子替换、版本检查和上次原文备份；分类只更新知识索引，原文件位置不变。
- 安装包内置手机版页面，无需另装 Node 或手工启动开发服务；已开启的同步服务随 App 重启恢复，关闭同步撤销配对。
- 当前为 HTTP 局域网内测功能：需保持电脑 App 与手机页面打开，不含互联网中继、传输加密、后台同步、原生 iOS 安装包或 HTTP 页面离线重启。DOCX 同步提取正文；Word/PDF 等附件本体不复制到手机，AI 在电脑上运行。

## 0.3.2 - 2026-09-24

- 修复其他电脑安装 / 更新后英语学习不可用：Windows 安装包现在包含完整 TypeWords 生产构建和独立 Node 运行环境，无需另装依赖或选择文件夹。
- 缺少设置、旧 TypeWords 路径失效时自动使用内置版本；提供“使用内置版本”恢复入口，保留学习记录和现有本机地址。
- 修正第三方构建中本地脚本地址的重复斜杠，解决新手引导加载失败的错误；原始源码快照保留，适配补丁单独记录。
- 处理外部发音不可用时的音频播放异常，保留原有语音合成回退。
- 发布流程增加源文件校验、逐文件资源清单及模拟无系统 Node 的启动 / 页面资源 / 词库验证，拒绝不完整插件安装包。
- 随包保留 TypeWords、Node 和依赖许可说明，并链接同版本完整来源与构建方法。

## 0.3.1 - 2026-09-20

- 点击左侧关系图谱、知识画布、文件知识库、英语学习、属性数据库、资源查询和回收站时直接切换主区域，不再增加顶部功能标签页。
- 顶部仅保留已打开的文档标签；文档前进/后退不再经过不可见的功能页。
- 英语学习页面独立保留打开状态，切换功能后返回仍使用同一个页面。

## 0.3.0 - 2026-09-20

- 将资料收件箱升级为文件知识库：多层主题、一份文件多个分类、关键词筛选和跨文件知识 tip 视图，原文件位置保持不变。
- 分段分析完整已收录正文，提取摘要、分类、关键词和带逐字原文引用的 tip；前端与原生保存接口均校验引用。
- 增加逐份保存的批量 AI 整理、暂停/继续、失败重试，以及可选的新增/更新资料自动整理；任务设置和完成状态跨重启保留。
- 保留用户确认的分类和标签；源文件更新后保留旧知识内容并标记待核对，拒绝过期源版本或过期整理版本覆盖。
- 支持 App 内编辑 UTF-8 文本原文件，保存前检查版本、保留 BOM/换行方式并提供上次修改撤销；Word 等资料可在默认程序打开。
- 为现有 Agent 接入文件知识库搜索、分段读取及虚拟知识保存工具。
- 兼容迁移旧索引；文件夹内可明确识别的同内容重命名保留整理结果。

## 0.2.15

- 转换 Windows 路径前缀，确保本机 Node 能启动中文路径中的 TypeWords。
- 修复 Windows 空闲端口可能被误判为超时的问题。0.2.12–0.2.14 为未发布的验收构建，未发布安装包。
- 正式 Windows App 启动时自动准备已启用的 TypeWords 插件，无需手动运行脚本。
- 首次选择本机 TypeWords 生产构建后记住目录；支持启动等待、错误提示、选择目录和重试。
- 复用已运行的 TypeWords；退出知识库时仅清理本次由知识库启动的插件进程。


## 0.2.11 - 2026-09-18

- Restore saved document-inbox layouts to the inbox and preserve the saved sidebar visibility.
- Show accurate view names for document-inbox and English-learning layouts.

## 0.2.10 - 2026-09-18

- Add a desktop document inbox with multiple selected folders, periodic incremental scanning, local full-text search and persistent review cards.
- Support UTF-8 text and DOCX body extraction, with visible unsupported-format, size-limit and offline-folder notices.
- Generate editable summaries, categories and tags using the configured model; reject stale reviews and export cards without changing originals.
- Add native index regression tests and a Chinese acceptance guide in `docs/DOCUMENT_LIBRARY.md`.

## 0.2.9 - 2026-09-17

- Remove the duplicate new-note plus button from the top tab bar; keep note creation in the sidebar and command palette.
- Hide the ambiguous disconnected-vault label in the top bar when no vault is open. Connected source information, save status, and desktop window controls remain available.
- Let the right side of the top bar fit its content instead of reserving a large empty column.

## 0.2.8 - 2026-09-17

- Add an isolated TypeWords English-learning plugin tab with enable/disable, reconnect, standalone opening, preserved iframe state, and the BookA icon.
- Include the user-supplied TypeWords source snapshot under `third_party/typewords`, with original GPL-3.0 license, upstream attribution, and a SHA-256 source manifest.
- Add a portable Windows launcher and build instructions for the local integration trial.
- Render common Markdown/GFM syntax while preserving note wikilinks and outline positions.
- Stage large/destructive Agent replacements for review and reject stale proposals before applying.

## 0.2.7 - 2026-08-08

### Added and improved

- Added a desktop-only Codex provider backed by the signed-in local Codex App Server, including real model discovery, connection state, independent Agent sessions, read-only text conversations, and original-image attachments without storing ChatGPT credentials in the repository.
- Fixed the desktop startup flash by rendering the Agent panel collapsed from the first frame instead of opening it and hiding it after a delay.
- Added a two-system document organization model: cross-document keyword tags plus a canonical article profile with summary, document type, category, source, author, entry date, and publication date.
- Added an editable article profile card above every note, automatic metadata initialization for newly created notes, semantic tag-type filtering, clickable sidebar tag filters, and type/category labels in the file tree.
- Added `docs/METADATA_AND_TAGS.md` to keep the metadata contract stable across Desktop, Web, GitHub, and future Agent workflows.
- Removed the visible Windows system title bar from the desktop app and integrated drag, minimize, maximize/restore, and close controls into the existing workspace toolbar.
- Consolidated appearance, language, storage, note workflow, graph, Agent, update, security, and hotkey controls into one settings center opened from the bottom-left gear.
- Added a keyboard-first command registry with 37 configurable actions, Obsidian-inspired defaults, persistent per-device overrides, conflict prevention, clear/reset controls, and a full reset-to-default action.
- Removed the separate top-bar theme/language controls and routed the Agent settings shortcut into the unified settings center.
- Added a shared light theme for Web and Desktop with a persistent sun/moon switch, purpose-built light graph, canvas, editor, dialog, Trash, updater, and Agent surfaces, while preserving the existing dark theme.
- Added a shared Obsidian-style command palette for Web and Desktop (`Ctrl+P`).
- Added a quick switcher with title, path, and alias lookup (`Ctrl+O`), exact note creation, and new-tab opening.
- Added full-vault search with content, path, tag, task, property, regular-expression, exclusion, and OR queries (`Ctrl+Shift+F`).
- Added command actions for new, daily, and random notes plus graph, canvas, storage, Trash, sidebar, Agent, and settings navigation.
- Made the Canvas entry open an editable blank canvas even before a local knowledge base is connected.
- Fixed the Canvas entry so it always dismisses the storage chooser and navigates directly to the canvas, including on first launch.
- Kept temporary notes visible and editable before a local knowledge base is connected instead of covering them with the empty-state screen.
- Reserved `Ctrl+P` for the command palette in the desktop WebView instead of the browser print dialog.
- Added editable frontmatter properties, a heading outline, backlinks/outgoing links, and per-vault local bookmarks.
- Added configurable template and daily-note folders, date formatting, template variables, template insertion, and daily-note templates.
- Added visible word, character, and estimated reading-time statistics that ignore frontmatter and Markdown syntax.
- Added clickable wikilinks with resolved-note hover previews for title, path, excerpt, and tags.
- Added keyboard-driven slash commands for headings, lists, tasks, quotes, code blocks, wikilinks, dividers, dates, and times.
- Added unique timestamp notes plus native split-by-heading and non-destructive merge-note commands.
- Added `docs/OBSIDIAN_PARITY_ROADMAP.md` as the verified core-feature matrix and implementation sequence.

## 0.2.6 - 2026-07-23

### Added

- Added a first-class knowledge canvas shared by the Windows App and Web workspace.
- Added editable text cards, tables, and live references to real Markdown notes.
- Added labeled relationship lines for related, supporting, contradicting, dependent, and reference relationships.
- Added multi-card topic groups, canvas pan/zoom, fit-to-content, card resizing, selection deletion, and undo/redo.
- Added durable canvas metadata at `.knowledge-agent/canvas.json` for writable local knowledge bases.
- Added graph camera controls for fit-to-content, reset, top-level folder clustering, and a live minimap.
- Added docked, floating, hidden, and focus modes for the Agent panel, including automatic idle collapse.
- Added a full Trash workspace with storage location, exact remaining retention time, read-only previews, and guarded restore actions.
- Added an updater trust panel showing the current version, publisher, signature policy, release notes, and automatic-check preference.

### Safety

- Canvas persistence never rewrites existing Markdown note bodies.
- Public GitHub repositories and read-only disk structure sources expose the canvas as read only.
- Browser persistence only begins after the user explicitly grants read/write access to a local folder.
- Pending canvas changes are flushed before switching storage sources so metadata cannot cross between knowledge bases.
- DeepSeek API keys are encrypted for the current Windows user with DPAPI instead of being stored as plaintext JSON.
- API-key rotation replaces the encrypted secret atomically; users can validate or delete the credential and inspect its latest validation time.
- Multi-note rename and move operations are validated first and committed as one native transaction, including Windows case-only renames.
- Deleted Markdown documents remain recoverable for exactly 30 days under the current vault's `.knowledge-agent-trash` directory.

### Improved

- Reduced dense-graph label collisions, kept nodes inside the usable viewport, and exposed hierarchy clustering without changing note contents.
- Localized remaining visible Agent, updater, graph, and credential-state strings across Chinese and English interfaces.
- Kept the main workspace usable while the Agent is hidden or floating, and restored the full-width center workspace in focus mode.

### Fixed

- Fixed credential rotation failing when an encrypted secret already existed on Windows.
- Fixed deleted credentials retaining stale rotation or validation timestamps in settings.
- Fixed persisted credential validation status being lost after an App restart.
- Fixed case-only Markdown renames being skipped on Windows.
- Fixed the offline model identity leaking as `offline:offline` in the Chinese interface.
- Fixed Agent auto-collapse reading its active prompt before that session state was initialized.

### Verification

- Added document-normalization, card-creation, browser persistence, native Rust round-trip, DPAPI, atomic replacement, case-only rename, Trash retention, and desktop-adapter tests.
- Verified all workspace type checks and unit tests, including 87 JavaScript/TypeScript tests and 22 native Rust tests.

## 0.2.5 - 2026-07-20

### Added

- Added editable per-note word clouds backed by the existing tag metadata, with five extraction granularity levels.
- Added local and model-assisted tag extraction that preserves user-confirmed tags and continues to work without a configured model.
- Added a tag-first 3D knowledge map with classification, connection, application, and source domains.
- Added tag detail cards with distribution, connection, application, and source-document evidence.

### Improved

- Separated the file-relationship graph from the new tag-system perspective instead of presenting folder structure as knowledge understanding.
- Added responsive label ranking and center-panel container rules so dense graphs remain readable in narrow desktop windows.
- Added wider three-axis layouts, smoother domain transitions, hover isolation, and evidence-backed relation highlighting.
- Kept each tag's base sphere size and each relation's base brightness stable across domains; domain-specific importance now appears through position and outer-rim emphasis.
- Restored the 3D-to-2D drill-down: clicking a tag sphere now opens its document root map, and returning reliably remounts the 3D canvas.
- Compressed the global sphere-size range and compensated perspective depth so the same tag keeps a comparable on-screen size across domains.

### Verification

- Added parser, tag editing, extraction, relationship-model, and word-cloud interaction tests.
- Verified the shared Web and Desktop builds against the same workspace implementation.

## 0.2.4 - 2026-07-16

### Fixed

- Fixed the Windows updater manifest workflow so multiple release installers can never be concatenated into one invalid download URL.
- Matched the selected installer to the manifest's actual signature instead of relying on ambiguous release asset ordering.
- Repaired the published `v0.2.3` manifest immediately, allowing existing clients to retry without waiting for this release.
- Separated update-check failures from update-installation failures and made installation errors retry the same signed update.
- Preserved string and object error details so the update window reports the real failure instead of a generic fallback.

### Verification

- Added release-manifest regression tests for exact URLs, whitespace rejection, and required signatures.
- Added a desktop updater regression test for installation failure, visible diagnostics, and successful retry.

## 0.2.3 - 2026-07-16

### Added

- Added a complete Chinese/English workspace language system shared by the Web App and Windows App, with browser-language detection, a persistent language switch, and URL overrides through `?lang=en` or `?lang=zh`.
- Added English product documentation and an English user guide while keeping the Chinese and English introductions clearly separated.
- Added localized graph terminology, Agent controls, storage panels, Trash details, safety summaries, live context labels, and desktop update dialogs.
- Added a read-only Web data source for public GitHub Markdown repositories using the repository default branch.
- Added repository URL parsing, GitHub API error handling, safety filtering, bounded concurrent Markdown loading, and browser memory limits.
- Added an optional one-click public example source while preserving the zero-content first-run contract.
- Added an optional repository-side static manifest so public demonstrations remain available when anonymous GitHub API quota is exhausted.
- Added YAML frontmatter tag indexing and explicit `domain` metadata support for authored macro-graph taxonomy.

### Safety

- Public GitHub sources cannot create, edit, rename, delete, apply Agent diffs, or write changes back to the repository.
- Sensitive paths continue to be excluded before Markdown content is fetched.
- Static manifests are validated for version, Markdown-only paths, duplicates, declared sizes, actual response sizes, file count, and total byte limits.
- Private repositories are not requested; authenticated GitHub write access remains outside the current release.

### Verification

- Added localization tests for language priority, browser defaults, static labels, and dynamic graph summaries.
- Added an English Agent interface regression test and a real-browser DOM check for the empty English workspace.

## 0.2.2 - 2026-07-15

### Changed

- Removed the bundled 36-note demonstration vault from the shared workspace package and all App/Web startup paths.
- Replaced Demo fallback behavior with an explicit empty source containing zero notes and zero allowed files.
- Added a focused first-run screen that asks the user to open or create a Markdown folder without implying any bundled content.
- Rebuilt the public README around first-run privacy, real local-folder behavior, graph semantics, Agent permissions, recovery, and App/Web differences.
- Replaced public screenshots with the current interface. Complex graph screenshots use a browser-memory external fixture that is never included in production bundles.

### Fixed

- New desktop installations no longer load fallback documents when no vault is configured or settings cannot be read.
- Unsupported browsers remain empty and show a compatibility message instead of receiving fallback notes.
- Empty startup no longer reports that a knowledge base has already loaded or repeats the disconnected source label.
- API-key onboarding no longer opens before a real knowledge source is connected.

### Verification

- Added Web, shared-workspace, and Desktop adapter tests that require zero bundled notes at startup.
- Public build checks now include source scans for removed Demo loaders and production-bundle scans for synthetic note titles.

## 0.2.1 - 2026-07-15

### Improved

- Unified the Windows App and public Web workspace around one shared 36-note, 12-domain knowledge terrain demo.
- Refined the 3D knowledge terrain with wider angular separation, responsive camera fitting, ink-wash nodes, clearer hover focus, and softer node boundaries.
- Added Cloudflare Pages security headers, immutable asset caching, and a guarded one-command deployment path for the canonical public site.
- Added Web/App release version parity checks so the two product surfaces cannot silently ship different versions.

### Fixed

- Restored desktop settings and model-secret loading when Windows writes UTF-8 JSON with a byte-order mark.
- Removed the stale three-note desktop fallback and the mismatched Web-only demo that caused App/Web graph drift.
- Locked the public demo baseline to 36 notes, 12 domains, 36 cross-domain relations, and zero excluded synthetic files.
- Added a post-publish UTF-8 manifest check and stable installer URL so signed in-app updates are verified before a release is considered complete.

### Privacy

- Cloud deployments fail before upload if the generated Web bundle contains an API key, private key marker, Windows user path, or the private F-drive demo path.
- Local visual artifacts, OMX state, vault content, API keys, and updater signing material remain excluded from source control.

## 0.2.0 - 2026-07-14

### Added

- Knowledge terrain experiment: a semantic 3D overview plus rooted role maps for questions, evidence, decisions, outputs, and supporting notes.
- Independent numbered Agent conversations with left-click switching and right-click deletion.
- Signed Windows in-app updates backed by GitHub Releases, including release notes, download progress, six-hour snooze, and automatic periodic checks.
- One-command Windows release tooling with version synchronization, signed NSIS packaging, GitHub Release upload, and `latest.json` generation.

### Preserved

- The original whole-vault file relationship graph remains available as a separate view.
- Local vault contents, DeepSeek API keys, updater private keys, and local project memory are excluded from public releases and source control.

### Upgrade note

Versions before `0.2.0` did not include the updater and must install `0.2.0` manually once. Later releases can be discovered and installed from inside the App.
