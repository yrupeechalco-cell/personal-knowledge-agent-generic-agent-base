# 0.6.0 画布升级与安装版验收

验证日期：2026-10-14。本记录不包含用户资料正文、个人文件路径、模型凭据或个人知识库截图。

## 版本与产物

- 构建提交：`98e6cb45ed910af520530c492356ac9fafa4ce1b`。
- [GitHub Windows 完整构建](https://github.com/yrupeechalco-cell/personal-knowledge-agent-generic-agent-base/actions/runs/38550273440)：成功。
- [公开发布 app-v0.6.0](https://github.com/yrupeechalco-cell/personal-knowledge-agent-generic-agent-base/releases/tag/app-v0.6.0)：已发布并标为最新版本。
- 安装包：`Agent_0.6.0_x64-setup.exe`，44,959,631 字节。
- SHA-256：`ea16da1b11778f2f7d4f2a9be6f21cad3c0a981fd59753feb6ca8d11678f2508`。
- 安装包、自动更新签名文件和 `latest.json` 的文件大小与 SHA-256 均与 GitHub 附件摘要一致。更新清单指向同一安装包，签名与配套签名文件一致。
- 公开发布后，匿名安装包请求最终返回 HTTP 200；匿名下载的最新更新清单与验收文件逐字节一致，版本为 0.6.0。发布标签指向上述构建提交。

## 自动化检查

| 检查 | 实际结果 |
|---|---|
| TypeScript / React 单元与交互测试 | 222 通过 |
| 更新清单 Node 测试 | 3 通过 |
| Rust 原生测试 | 69 通过，1 项忽略 |
| 画布浏览器操作 | 4 通过 |
| TypeWords 全新浏览器环境 | 2 通过 |
| 跨文件检索离线流程 | 1 通过 |
| 手机端 Chromium 回归 | 9 通过 |
| Typecheck、前端与 Windows 安装包构建 | 通过 |
| 预置内容、独立客户端资源检查 | 通过 |

画布使用隔离的合成样本，覆盖旧 v1 数据载入、文本编辑、卡片拖动与缩放、连线与关系编辑、分组移动、多选与框选、网格排列、吸附、平移缩放、撤销重做、笔记拖入、打开来源、重新载入及只读行为。额外检查框选单张卡片不会选中背景分组或移动、删除其他成员。检查期间阻止对外请求，并核对深色、浅色和窄窗口截图。测试样本不会装入用户知识库。

## 正式安装版

1. 在本机关闭已保存的旧版后，执行经过校验的公开发布安装包。
2. Windows 文件版本和已安装 CLI `status` 均返回 0.6.0；通道已就绪。
3. 已安装 CLI 仍提供原有 41 个方法，方法名称与升级前一致。
4. 通过 `canvas.read` 对比升级前后完整画布文档，内容一致、仍为 version 1，且没有未保存改动。
5. 安装目录内 React Flow 及依赖许可与源码许可文件的哈希一致；TypeWords 本体清单及 Node 运行环境存在。
6. 实际点击左侧「知识画布」，确认新工具栏、网格背景、小地图、缩放控件及操作提示显示正常；点击「平移」，再切回「选择」。操作后再次通过 CLI 确认原画布未变。

正式版此次界面点测使用既有空画布；带卡片的完整交互验证在上述隔离浏览器样本中完成，不将两者混称。验收未触发资料扫描、模型调用或原文修改。

## 使用、独立运行与回滚

- [画布使用说明及边界](CANVAS_0.6.0.md)。此次升级使用 React Flow 12.12.0，来源及许可证见 [第三方说明](../THIRD_PARTY_NOTICES.md)。
- 画布代码和样式在正式安装包内，不需要开发服务器、Node、Python、Codex 或自建服务器；Windows 的 WebView2 环境要求沿用原安装方式。TypeWords 使用随包提供的独立运行环境。
- 构建已在 GitHub 的独立 Windows 环境完成，本机已实际安装和点测；尚未在另一台实体电脑上人工验收。不宣称已交付 macOS、Linux 或原生 iOS 安装包。
- 当前支持文本、表格和知识库笔记卡片；整理布局是网格排列。Word/PDF/视频直接嵌入、自动推断关系、多人协作及账户云同步未包含在本次升级中。
- 回滚源码标签：`rollback/before-react-flow-2026-10-14`，对应 `8cccff54ef04afec70a3da0bb657b5dcc963c36d`。上一正式安装包 [0.5.0](https://github.com/yrupeechalco-cell/personal-knowledge-agent-generic-agent-base/releases/tag/app-v0.5.0) 保留；画布格式和 CLI 合约未改变。
