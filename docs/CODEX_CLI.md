# Codex CLI 通道（Windows 桌面版 0.4.0 起）

## 用途

Codex 从命令行直接操作正在运行的个人知识库。原有内置 Agent、DeepSeek 与 Codex 模型连接独立保留。本通道不调用模型，不要求新的 API Key。

主要链路：**Codex → 随安装包提供的 CLI → 本机认证通道 → 软件现有接口 → 保存结果并刷新界面**。

## 开启和定位

1. 安装 [0.4.1 正式发布版](https://github.com/yrupeechalco-cell/personal-knowledge-agent-generic-agent-base/releases/tag/app-v0.4.1) 或更新版本，打开软件。
2. 设置 → 常规 → Codex CLI → 管理连接 → 允许 Codex 操作软件。
3. 点击「复制命令」，交给 Codex。安装目录下的 `cli/knowledge-cli.cmd` 和 `knowledge-cli.ps1` 即可独立使用，不需要 Node、Python 或 Rust。

默认安装目录的 PowerShell 示例：

```powershell
$cli = Join-Path $env:LOCALAPPDATA '个人知识库 Agent\cli\knowledge-cli.cmd'
& $cli status
& $cli capabilities
& $cli call app.state
```

自定义安装位置时以设置面板显示的路径为准。新安装默认关闭，用户开启后记住偏好；退出 App 后通道退出。显式启动参数 `--enable-local-cli` 可以开启并记住该设置，适用于已授权的安装配置。

## 命令与参数

`capabilities` 返回完整方法清单、参数 JSON Schema、是否修改状态以及是否修改原文件。

| 能力 | 方法 |
|---|---|
| 当前状态、视图、主题 | `app.state`、`app.show`、`app.theme` |
| 指定文件夹、按原目录浏览和预览 | `vault.open`、`files.list`、`files.preview` |
| 笔记读写、打开、删除到回收站、撤销 | `notes.list/read/open/write/delete/undo` |
| 回收站 | `trash.list/read/restore` |
| 图谱与画布 | `graph.read/filter`、`canvas.read/write` |
| 文件知识库 | `library.status/add_folder/scan/update_root/search/read/annotate/configure` |
| 单独修改或恢复原文 | `library.source_write/source_restore/source_open` |
| 知识卡片 | `cards.list/update/export` |
| 英语学习插件 | `typewords.status/start/stop/use_bundled` |
| 内置 Agent 的模型设置 | `settings.model/set_model` |

### 用 JSON 文件传参

为避免 PowerShell 和 cmd 引号差异，推荐 UTF-8 JSON 文件，不在命令行拼长正文。`-Stdin` 也接受标准输入中的 UTF-8 JSON。

```powershell
$arguments = @{ path = 'C:\Users\用户名\Desktop\资料'; mode = 'files' } | ConvertTo-Json
[IO.File]::WriteAllText('.\open-folder.json', $arguments, [Text.UTF8Encoding]::new($false))
& $cli call vault.open -ParamsFile .\open-folder.json
& $cli call files.list
```

`mode=files` 保留只读的原目录浏览与文件分布视图；`mode=notes` 连接可写 Markdown 笔记库。添加资料库监测目录使用 `library.add_folder`，不会马上扫描，需另外调用 `library.scan`。

### 资料标注

1. `library.search` 查找资料 ID。
2. `library.read` 分页读正文，取得 `revision` 和 `metadataVersion`。
3. Codex 生成摘要、多个分类、标签和带原文引用的 tip。
4. `library.annotate` 保存；用户锁定的分类不会被 AI 覆盖。
5. 如用户明确要求更改手动分类，用 `cards.list` 取得卡片版本，再调用 `cards.update`。

标注写入 App 索引，不移动原件。`cards.export` 只返回已标为共享的卡片 JSON，不执行网络上传。`library.configure` 控制的是原有 AI 队列；启动队列可调用用户已经配置的模型，其他 CLI 标注命令本身不调用模型。

### 笔记与画布写入

- 修改前先 `notes.read` / `canvas.read`，提交返回的版本号。新建笔记使用 `expectedRevision: null`，已有同名笔记会拒绝覆盖。
- 笔记改写与画布保存前，旧内容备份到当前知识库 `.knowledge-agent/cli-backups/`。笔记可通过 `notes.undo`、`backupId` 和当前版本恢复。画布备份可取出 document 后通过 `canvas.write` 恢复。
- 删除笔记进入现有三十天回收站，用 `trash.restore` 恢复。
- 界面存在未保存改动时拒绝冲突操作；文件版本变化时要求重新读取。
- Word/PDF 原件编辑、图片识别与音视频转写不会因本通道新增；读取和写入能力仍以原有格式支持为准。

## 任务结果与失败恢复

所有输出为 JSON。`call` 生成请求 UUID，等待任务完成；结果包含 `state`、`result`、`error`、`id`。

- 退出码 `0`：成功；`1`：任务失败/取消；`2`：连接或参数错误；`3`：任务尚未完成。
- 网络中断或超时可能发生在写入之后。先 `job <UUID>` 查询，不要用新编号重复执行写操作。
- 同一次 App 启动中，相同 UUID 和相同参数重复提交只会返回原任务；相同编号配不同参数会被拒绝。
- App 重启后任务内存历史清空。此时先读取真实文件/索引核对，不能直接凭旧编号重试。
- 关闭通道取消尚未领取的任务，已经开始的保存会继续完成。任务日志只记录编号、命令名、结果状态和时间，不记录正文、参数或凭据。

## 权限边界和数据位置

通道只监听 `127.0.0.1` 的随机端口，要求随机令牌，拒绝网页 Origin 和非本机 Host。连接信息由 Windows 当前账户 DPAPI 加密，放在 `%LOCALAPPDATA%\com.personal-knowledge-agent.desktop\local-cli\connection.bin`，不能提交到 GitHub。协议没有任意 shell、任意 Tauri invoke、读取 API Key 或绕过 Codex 沙箱的入口。

这是本机同账户的应用控制权限。它不自动读取整台电脑，也不新增手机文件权限或跨设备正文同步。Codex 自身的执行权限和审批继续有效；文件内容是资料，不能当作操作指令。

TypeWords 目前开放启动、停止、切回内置版与进入页面。它的词典、学习记录和课程内部操作尚无 CLI 接口；本通道不会伪称已开放这些功能。

## 安装、来源和回滚

CLI 与主程序一起由 Tauri NSIS 安装包分发；PowerShell 客户端和桥接代码为本项目新增代码。原 TypeWords 来源与许可证仍见项目已有第三方说明。

改造前回滚标签：`rollback/desktop-before-codex-cli-2026-10-11`（提交 `9530f12`）。安装包与代码回滚不同：0.3.7 未发布，上一份已发布安装包为 0.3.6。关闭 CLI 后再安装旧版；卡片索引格式仍为 v3，CLI 备份单独保留。

Codex 可通过项目说明发现 CLI 的方式参照 [OpenAI 官方 AGENTS.md 文档](https://learn.chatgpt.com/docs/agent-configuration/agents-md)。本通道不是内置 Agent 的模型桥接，也未更改 Codex 产品的权限设置。
