# 0.3.2 交付验证（2026-09-24）

## 修复范围

- Windows 安装包内置 TypeWords 生产构建、资源与固定 Node 24.14.0，启动不依赖系统 PATH。
- 新电脑无配置、配置损坏或旧外部目录失效时回退到内置版本；支持手动“使用内置版本”。有效的用户自定义目录继续保留。
- 修复本地脚本 URL 重复斜杠导致的新手引导 404，以及在线音频播放 Promise 未处理异常。
- 原始 TypeWords 326 文件快照不变；两处构建适配补丁、修改日期、许可证与来源均明确记录。

## 已通过检查

- 186 项 Vitest 测试与 3 项发布清单测试，共 189 项。
- 所有 workspace 类型检查、桌面前端构建、版本同步和无示例笔记检查。
- 326 个第三方来源文件 SHA-256 完整性。
- Windows 原生测试：45 通过，0 失败，1 个原有忽略项。
- 模拟新电脑启动：子进程 PATH 为空、独立用户环境、中文和空格路径；内置 Node 启动 TypeWords，并逐字节验证 185 个公共资源和 2,607 个 CET-4 词条。
- 2 项 Chromium 页面测试：同 sandbox 权限的 iframe 首页、选择 CET-4、显示词条、进入练习，以及无预置学习记录的首次引导。测试阻止外部网络请求，并要求没有未处理的页面脚本异常。

页面截图见 [正式工作流](https://github.com/yrupeechalco-cell/personal-knowledge-agent-generic-agent-base/actions/runs/36001567393) 的 `typewords-browser-evidence` 附件。

## 正式发布

- [Release app-v0.3.2](https://github.com/yrupeechalco-cell/personal-knowledge-agent-generic-agent-base/releases/tag/app-v0.3.2)。
- 标签对应提交：`5b85b67ec2c8a2ccd8335a3376b59b475c9e795d`。
- 发布分支：`codex/typewords-plugin-foundations`；未声称已合并 master。
- 工作流 `36001567393` 全部成功，包括资源检查、浏览器检查、原生测试、签名安装包及更新清单检查。
- 安装包：`Agent_0.3.2_x64-setup.exe`，44,168,797 字节。
- SHA-256：`a3bcfadc5d2f335f6d6ee3712cf2b629f2bcbc970feaf68868712868a7a22268`，与 GitHub Release 资产摘要一致。
- `latest.json` 版本为 0.3.2，所有 Windows 平台下载地址指向同一正式安装包；清单内签名值与 `.exe.sig` 文件一致。

## 本机正式安装验证

- 使用上述同一安装包覆盖安装，安装程序退出码为 0。
- 已安装 `knowledge-agent-desktop.exe` 的 ProductVersion 为 **0.3.2**。
- 安装目录 `plugins/typewords` 中的 **3,236 个文件**逐一通过随包清单 SHA-256 校验。
- 将实际安装目录中的插件复制到隔离目录，再次以空 PATH / 独立用户环境启动；185 个公共资源和 CET-4 词库检查全部通过。
- 未迁移或清除实际用户的 TypeWords 学习存储。

## 验证边界及另一台电脑的检查方法

本机 Computer Use 因无法可靠识别浏览器 URL 而中止，之后未继续本机界面操作。页面交互使用 GitHub 独立 Windows / Chromium 环境验证，不访问用户真实浏览器配置或学习数据。没有把它描述为已在用户另一台物理电脑完成验收，也未宣称完成真实发音、打完整次练习或跨电脑学习记录迁移。

另一台电脑更新到 0.3.2 后：

1. 打开英语学习；如果此前选择过外部 TypeWords 目录，可点击“使用内置版本”。
2. 选择 CET-4，进入学习并试着输入单词。
3. 切换到其他功能再返回，随后正常退出 / 重开，检查已保存的学习状态。

词库和页面可本地加载。在线发音仍依赖网络或系统可用的语音合成；学习记录不会因为升级而自动同步到另一台电脑。
