# TypeWords 随正式 App 自动启动：0.2.15 验收

日期：2026-09-19。

## 发布与安装

- 源码提交：`c8eeb144da71263079e27f3eaa141af0112a297b`，标签 `app-v0.2.15`。
- [发布页](https://github.com/yrupeechalco-cell/personal-knowledge-agent-generic-agent-base/releases/tag/app-v0.2.15)。
- [Windows 构建及测试](https://github.com/yrupeechalco-cell/personal-knowledge-agent-generic-agent-base/actions/runs/35449169869)。
- 安装包：`Agent_0.2.15_x64-setup.exe`，4,148,700 字节。
- 下载后 SHA-256 与 GitHub 发布摘要一致：`4f6d1f320662988fb56f9f5181caa660f3b7d9602558cbaf597119391c222867`。
- 本机安装退出码为 0；安装后 EXE 的 FileVersion 与 ProductVersion 均为 `0.2.15`。

## 自动检查

- JavaScript 测试 176 项通过，包括启用偏好、后台准备、连接等待、原生失败恢复及重复启动合并。
- Rust 原生测试 36 项通过，1 项既有外部联网测试忽略。新增测试覆盖本机服务识别、空闲端口、错误服务、构建目录校验、中文与 UNC 路径转换。
- 类型检查、Web 与 Desktop 前端构建通过。
- TypeWords 来源快照 326 个文件校验通过；第三方源码未修改。
- 与上一个已安装版本 0.2.11 比较，Cargo.lock 仅更新应用自身版本，没有升级第三方依赖。

## 正式 App 实测

本机复用用户已有的 TypeWords 3.0.7 生产构建，并预先登记其目录。测试没有改变词典、练习记录或笔记。

1. 初始状态：知识库未运行，5567 端口没有监听服务。
2. 仅打开正式知识库 App，尚未点击英语学习时，5567 已出现 `node.exe` 监听；父进程为当前知识库，监听地址为 `127.0.0.1`。
3. 点击左侧英语学习，原生 WebView 显示 TypeWords 单词页、选择词典、学习统计和我的词典。
4. 通过知识库窗口关闭按钮正常退出。确认知识库进程数为 0，5567 监听数为 0。
5. 再次打开正式 App，TypeWords 再次自动启动，父进程属于新启动的知识库。
6. 将正式 App 留在英语学习入口，供继续使用。

本轮未手工验证新增词典、打字练习、发音、学习记录跨浏览器迁移。停用偏好、错误恢复由自动化测试覆盖；外部服务复用的身份检查有原生自动测试，外部进程保留未另做整套 UI 测试。

## 使用

以后打开知识库即可自动准备已启用的 TypeWords，点击英语学习进入；不用再单独运行启动脚本。停用插件后，下次启动不自动准备。换电脑或移动 TypeWords 目录时，可在插件页重新选择已构建的目录。

安装版仍依赖本机 Node 和 TypeWords 生产构建。网页预览无法替代原生 App 启动本机服务。详细说明见 [TypeWords 插件文档](TYPEWORDS_PLUGIN.md)。
