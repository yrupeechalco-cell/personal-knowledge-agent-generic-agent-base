# TypeWords 英语学习插件

## Windows 正式版：从 0.3.2 起内置运行

安装包包含 TypeWords 生产构建、页面资源、快照自带的 CET-4 词库 / 新概念文章资源，以及独立的 Node.js 24.14.0 Windows x64 运行环境。其他电脑无需安装 Node、pnpm、下载源码或选择文件夹。

打开知识库时，已启用的英语学习会后台启动；点击左侧书本 A 图标即可进入。它直接切换主区域，不新增顶部功能标签。切到其他功能再返回时保留同一学习页面。

- 默认使用安装目录 `plugins/typewords` 中的内置版本。
- 旧版保存的自定义目录仍有效时继续使用；目录丢失、配置损坏或尚未配置时自动使用内置版本。
- 页面白屏或旧的自定义版本报错时，可点击 **使用内置版本**，随后重新加载。该操作只清除自定义路径设置，不删除学习记录。
- **自定义目录**是可选高级入口，只接受含 `package.json` 和 `.output/server/index.mjs` 的 TypeWords 生产构建；也使用安装包自带的 Node。
- **重新连接**会检查服务并重载页面；当前尚未保存的练习状态可能重置。
- **独立打开**使用系统浏览器打开同一地址。浏览器与桌面 WebView 的学习存储可能不同。
- **停用插件**会卸载学习界面并禁用下次 App 启动时的自动启动，不删除学习记录。

服务仅监听 `127.0.0.1:5567`，保持旧版地址，避免因地址变化导致原 WebView 学习记录不可见。退出知识库仅结束本次由知识库启动的服务。用户原先独立启动的 TypeWords 可继续使用；切换内置版前须先关闭独立服务。端口被无关程序占用时显示错误，不终止该程序。

设置与诊断日志保存在 App 本地数据目录的 `plugins/typewords.json`、`plugins/typewords.log`，不上传 GitHub。学习数据仍由 TypeWords 自己的浏览器存储管理，不同步到知识库、不跨电脑自动同步。

## 验收方法

1. 在未安装 Node、未下载 TypeWords 的 Windows x64 电脑安装 0.3.2 或更新版。
2. 启动知识库，点击左侧英语学习，确认能看到词典选择、今日任务和统计。
3. 选择 CET-4，进入自由练习，输入几个单词；切换到知识库后返回，确认练习页面仍保留。
4. 正常退出 App，再打开，确认能继续加载词典和已保存记录。
5. 旧电脑可点击“使用内置版本”，确认不再依赖以前的 TypeWords 文件夹。
6. 停用后退出重开，确认插件仍停用；启用后应能重新进入。

自带词库及界面可在本地加载；在线词语发音、翻译等外部服务需要网络，不承诺离线发音。跨电脑学习记录需用 TypeWords 自带导出 / 导入功能另行迁移。

## 构建与来源

完整源码位于 `third_party/typewords`，来自用户提供的 `TypeWords-3.0.7` 文件夹；不是已验证的上游版本标签。原作者为 zyronon 及 TypeWords 贡献者，原 GPL-3.0 和声明保留。详见 [第三方来源](../THIRD_PARTY_NOTICES.md)。

在 Windows x64、已安装 Node / npm 的开发环境中：

```powershell
npm ci
npm run typewords:prepare
npm run typewords:check
npm run typewords:smoke
npm run tauri:build
```

`prepare-typewords.ps1` 从 Node 官方地址取得固定 24.14.0 ZIP，校验固定 SHA-256；使用其中的 Node 与固定 pnpm 11.24.0，根据快照锁文件安装依赖并执行 Nuxt 的 `node-server` 构建。源码按 326 文件清单复制到隔离的构建目录，Nuxt 生成文件不会改写第三方原始快照。

构建副本由 `copy-typewords-build-source.mjs` 修正 `LIBS_URL` 的末尾斜杠，避免新手引导等脚本的 `/libs//…` 路径在本机服务返回 404；补丁与原始快照均可从同版本源码获取。

`stage-typewords.mjs` 将生产输出、Node 可执行文件及许可说明放入 Tauri 资源目录，并生成逐文件 SHA-256 清单。正式构建前强制检查资源完整性和应用版本；缺少资源时构建失败，防止再次发布只有入口的安装包。安装包内 `SOURCE.md` 指向同版本 GitHub 源码标签、完整源码 ZIP、锁文件和构建说明。

`typewords:smoke` 将资源复制到含中文和空格的新目录，清空子进程 PATH 并使用全新用户环境，验证 `/words`、入口脚本、全部公共资源和 CET-4 词库。它不使用机器已安装的 Node 或已有 TypeWords 设置。原生测试覆盖无设置、损坏设置、旧目录消失、自定义目录有效及绝对运行时路径。

发布流程另外在全新 Chromium 测试配置中加载具有同样 sandbox 权限的跨来源 iframe，验证首页实际渲染、打开 CET-4 并显示词条，同时检查未处理的脚本错误；测试中阻止外部网络请求。截图保存在工作流的 `typewords-browser-evidence` 附件，便于复核白屏问题。这项测试使用独立测试数据，不访问用户浏览器配置或学习记录。

## 网页预览

浏览器预览不具备桌面端的原生启动能力，仍需先启动本机 TypeWords 服务。可使用仓库中的 `start-knowledge-with-english.cmd` 和 `scripts/start-local-plugins.ps1 -TypeWordsPath <已构建目录>`。网页预览不等于正式 App 更新；正式交付见 [桌面交付说明](DESKTOP_DELIVERY.md)。
