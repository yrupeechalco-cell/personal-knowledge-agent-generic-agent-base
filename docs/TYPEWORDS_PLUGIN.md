# TypeWords 本地插件

## 正式 Windows App：0.2.13 自动启动

打开知识库 App 时，已启用的 TypeWords 插件会在后台自动启动本机服务；点击左侧“英语学习”即可进入。服务就绪前显示等待状态，不弹出终端，不切换当前笔记标签。

- 首次使用时点击“选择 TypeWords 文件夹”，选择包含 `package.json` 和 `.output/server/index.mjs` 的已构建 TypeWords 根目录。目录只需选择一次，重启和升级后保留。
- 本机需要 Node.js 22 可通过 PATH 找到；缺失、构建不存在、端口冲突或启动失败时，插件页显示原因，可修复后点击“重新连接”。
- 先检查本机 5567 端口，验证 TypeWords 页面后复用已有服务；发现其他服务时不会关闭它。新服务仅绑定 `127.0.0.1`。
- 停用插件后，下次启动知识库不会自动启动 TypeWords；重新启用会启动并连接。停用界面不会删除学习记录，也不会立即终止仍可能被独立页面使用的服务。
- 退出知识库会结束本次由知识库启动的 TypeWords 进程；原先由用户独立启动的服务继续运行。因此若要在关闭知识库后继续独立学习，可使用原有 TypeWords 启动器。
- 插件目录设置与诊断日志位于 Windows App 本地数据目录的 `plugins/typewords.json`、`plugins/typewords.log`，不上传到 GitHub。
- TypeWords 生产构建和 Node.js 仍复用本机安装，不打入知识库安装包；换电脑需要重新安装并选择目录。

验收方法：选择目录后退出知识库，确认本次启动的服务退出；重新双击正式 App，在点击“英语学习”之前服务就应已启动；进入后显示学习页面。再停用插件、退出重开，服务应保持关闭，点击“启用插件”才启动。

## 网页预览与源码启动方式

完成以下构建后，双击仓库根目录的 `start-knowledge-with-english.cmd`。它会在后台启动 TypeWords 构建及知识库本地预览，然后打开 `http://127.0.0.1:5174/?plugin=typewords`。两个服务均只监听 127.0.0.1。

### 首次从源码构建

准备 Node.js 22 和 pnpm。在仓库根目录执行：

```powershell
npm ci
npm run source:check
npm run build:web
Push-Location third_party/typewords
pnpm install --frozen-lockfile
pnpm run build
Pop-Location
.\start-knowledge-with-english.cmd
```

第三方源码使用自己的 pnpm 锁文件和依赖环境，不加入知识库 npm workspace。首次安装/构建需要网络；学习界面中的在线词库、发音等功能也可能使用外部服务。本轮运行验证使用的是用户已有 TypeWords 生产构建，尚未在干净环境重新构建第三方应用。

也可以运行 `scripts/start-local-plugins.ps1 -TypeWordsPath <已有TypeWords目录>`，复用已有构建。不传目录时默认使用仓库内的 `third_party/typewords`。当前约定端口：知识库 5174，TypeWords 5567。端口上若有非预期应用，启动器报错，不会结束该应用。

在左侧工具栏点击“英语学习”，直接进入 TypeWords 单词页。未连接知识库时也可以学习；窄窗口自动收起文件侧栏，可用原侧栏按钮展开。

- 切换知识库标签页：保留内嵌页面，避免重载练习。
- 关闭英语学习标签页或停用：卸载页面，不删除学习存储。
- 重新连接：检查本机服务并重新打开页面，当前未保存的页面状态可能重置。
- 独立打开：在单独页面打开同一 TypeWords 地址。
- 服务未启动：显示启动方式与重试按钮。

## 当前边界

这是隔离网页形式的本地插件适配，不是通用第三方插件市场。TypeWords 原目录及源码未修改；根据用户后续要求，将源码快照整理进 `third_party/typewords`，但不复制到知识库安装包。来源、作者、原许可证及精确来源限制见 [第三方说明](../THIRD_PARTY_NOTICES.md)。插件清单和组件位于 `packages/workspace/src/plugins/`。

学习记录由 TypeWords 自身的浏览器存储管理，本轮不导入、不删除、不向知识库同步。不同浏览器、桌面 WebView 或内嵌页面的存储隔离可能导致看不到以前的学习记录；不承诺自动迁移。此前浏览器中的 TypeWords 可继续独立使用。

0.2.8 将共享插件组件纳入 Windows 正式安装版。安装版通过带签名的 GitHub Release 更新；仅修改源码、推送分支或打开 Web 预览不会改变已安装 App。正式发布及本机更新流程见 [桌面交付说明](DESKTOP_DELIVERY.md)。Web 试用版沿用原有 Web 能力，不具备桌面端原生文件写回与模型凭证存储。

网页预览的停用插件仅卸载界面，不停止本机服务。由脚本启动的服务进程随用户会话运行，重启电脑后需再次运行启动脚本；未设置开机自启。正式 App 的进程生命周期见上文。

## 验证

自动化覆盖：连接失败恢复、启停状态保存、iframe 边界、无知识库时打开、切换标签时保留同一 iframe。类型检查、Web 与桌面前端构建通过。

浏览器实测：单词页成功嵌入，显示词典选择、今日任务、复习、自由练习和统计；启停及知识库标签切换成功。自动化浏览器对 iframe 内部点击返回目标不可用，因此没有宣称已完成词典选择、打字、发音和学习记录持久化的端到端验收，需要实际试用确认。

日志：`.local-plugin-logs/`（仅本地运行诊断）。源测试结果：`typewords-tests.log`。
