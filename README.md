# 光影写手 · Guangying Writer

面向中文编剧的开源桌面创作工具：写作、故事结构、自由板与原位图文参考，在同一份工程里完成。

采用 [MIT License](LICENSE)。这是源码仓库；普通用户请到 [GitHub Releases 下载已公开的安装附件](https://github.com/libingzheng00-eng/guangying-writer/releases)。下载源码 ZIP 不等于下载桌面应用。目前公开包的系统、架构和签名状态以对应 Release 说明为准。

## 主要能力

- 九类剧本元素与 Tab / Shift+Tab 闭环切换，人物/场景/镜头/转场分字段快捷输入，双列对白及同人物续说提示。
- 正文富文本编辑、多步撤销/重做、剪切粘贴、跨段选择、段中分行，以及只读全文查找。
- 导航与大纲整场排序，故事板幕管理、多选、移至未归幕和可撤销的整场删除。
- 自由板场景、灵感、声音与图片卡：可缩放、关系线与备注、网格、可选磁吸及独立板面布局。
- 写作面板直接拖入图片并保留参考位置；打字机指针进度、目标页数、场景篇幅色带及定位。
- 统计页的幕/场景、人物、地点/时段分析，角色改名同步正文人物元素。
- `.zhsp` 工程保存/恢复，文本/FDX 导入，PDF/FDX/文本/Markdown/HTML 导出及日夜主题。

PDF 有两个独立出口：**创作版**保留写作画布上正文与素材的实际位置；**A4 纯文本**用于标准纸张打印，不带素材。不能把所有图片移到文末来代替原位导出。

## 当前源码状态

`package.json` 版本为 `1.3.0-alpha.18.11`，汇集2026-10-07的进度栏、快捷输入、自由板、编辑历史、智能引号与可靠性改进。安装包的实际发布状态以 [本版下载页](https://github.com/libingzheng00-eng/guangying-writer/releases/tag/v1.3.0-alpha.18.11) 为准；这是 macOS Apple Silicon 测试版，不是正式1.3.0或Windows版。更新源码和发布安装包都不会自动替换用户已安装应用。

本版另加入恢复点成功/失败反馈与关闭提示、单份自动恢复、工程临时落盘和上一版备份，以及只读写作派生/快捷输入目录复用。自动恢复约900ms停笔写入、连续修改最长约30秒更新，**不等于保存磁盘 `.zhsp`**；恢复失败或坏载荷有保护，关闭前仍应明确保存。成功保存时文件备份为替换前工程；最终替换失败时备份可能与当前工程同版本，不是无限历史。普通文件mode可保留，不承诺全部ACL/xattr或任何文件系统断电无损。性能改动没有重写分页/PDF或改变写作快捷键。

自动化、真实浏览器、真实 Electron、原生剪贴板和实际 PDF 是不同验收层。当前证据见 [本轮编辑验收记录](EDITING_QA_20261007.md) 与 [界面验收记录](design-qa.md)，未验证部分明确列出，不承诺所有平台均已稳定。

本轮独立临时用户目录/合成稿的分层验收已记录在 [恢复与原生验收记录](RELIABILITY_QA_20261007.md)：37套源码回归、实际系统剪贴板/关闭操作、5组真实Electron回归及实际PDF检查。真实macOS输入法、独立测试壳文件对话框等边界仍待验证。发布包须另做空白启动、生产资源与签名检查；源码验收不能代替这些检查。

## 开发与维护

使用 Node.js 22.13+（CI 为 Node 22），依赖以 `package-lock.json` 为准。只检查 renderer 和合成测试时，可跳过 Electron 下载：

```bash
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci
npm run typecheck
npm run build
npm run test:core
npm run dev
```

当前37套源码回归的统一入口是 `test:core`，包含恢复、工程落盘、保存IPC和写作派生专项。它不启动原生 Electron，不读取用户剧本或系统剪贴板；原生验收须独立进行。

维护前请依次阅读：

1. [AGENTS.md](AGENTS.md)：协作与隐私约束。
2. [CORE_FEATURES.md](CORE_FEATURES.md)：核心功能与不可擅改的行为契约。
3. [MAINTENANCE.md](MAINTENANCE.md)：当前模块关系、历史事务、剪贴板、异步保存、验证与发布流程。
4. [DEVELOPER_HANDOFF.md](DEVELOPER_HANDOFF.md) / [CHANGELOG.md](CHANGELOG.md)：交接与版本记录。
5. [MIGRATION.md](MIGRATION.md)：回迁背景与历史兼容说明。

正式包使用完整可信的 Electron 运行时与 `package.sh`；macOS 发布流水线另生成 DMG。ad-hoc 签名不等于 Apple 签名/公证，本机能打开也不等于其他电脑都能打开。不要修改系统安全设置来绕过测试失败。

贡献时请使用合成稿，不提交用户剧本、自动保存或私人图片；不要删除核心断言或降低 CI 来掩盖回归。已安装应用、个人文档与他人已有工作区变更不在一般代码优化的修改范围内。

## 反馈

可提交 [GitHub Issue](https://github.com/libingzheng00-eng/guangying-writer/issues)，附版本、系统、最小复现步骤和脱敏截图。请不要上传真实剧本。公开联系邮箱：libingzheng00@gmail.com。
