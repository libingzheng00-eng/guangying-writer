# 光影写手 · Guangying Writer

面向中文编剧的开源桌面创作工具：写作、故事结构、自由板与原位图文参考，在同一份工程里完成。

采用 [MIT License](LICENSE)。这是源码仓库；普通用户请到 [GitHub Releases 下载已公开的安装附件](https://github.com/libingzheng00-eng/guangying-writer/releases)。下载源码 ZIP 不等于下载桌面应用。目前公开包的系统、架构和签名状态以对应 Release 说明为准。

## alpha.18.15 启动工作区与旧工程兼容

`alpha.18.15` 汇集启动页、最近项目和写作位置恢复，并修复旧工程关系线字段导致整份工程无法打开的问题。阅读滚动位置优先于旧光标，自由板平移、缩放及关系备注继续保留。使用与数据保护说明见 [启动工作区](STARTUP_WORKSPACE.md)；实际预发布状态、附件、来源与跨平台验收以对应 GitHub Release 为准。

保留此前安全升级的 Electron 44.7.0、工程 HTML 净化、显示/导出与原生 IPC 文件权限。最低要求为 macOS 13+ Apple Silicon / Windows 10+ x64；发布不会自动替换用户安装。安全边界、剩余依赖告警和验收分层见 [安全升级说明](SECURITY_UPGRADE.md)。下方 alpha.18.12 的 Release 记录保留为历史交付。

## 主要能力

- 九类剧本元素与 Tab / Shift+Tab 闭环切换，新空段跨类型 SmartType 与人物/场景/镜头/转场分字段补全，双列对白及同人物续说提示。
- 正文富文本编辑、多步撤销/重做、剪切粘贴、跨段选择、段中分行，以及只读全文查找。
- 导航与大纲整场排序，故事板幕管理、多选、移至未归幕和可撤销的整场删除。
- 自由板场景、灵感、声音与图片卡：可缩放、关系线与备注、网格、可选磁吸及独立板面布局。
- 写作面板直接拖入图片并保留参考位置；打字机指针进度、目标页数、场景篇幅色带及定位。
- 统计页的幕/场景、人物、地点/时段分析，角色改名同步正文人物元素。
- `.zhsp` 工程保存/恢复，文本/FDX 导入，PDF/FDX/文本/Markdown/HTML 导出及日夜主题。

PDF 有两个独立出口：**创作版**保留写作画布上正文与素材的实际位置；**A4 纯文本**用于标准纸张打印，不带素材。不能把所有图片移到文末来代替原位导出。

## 已发布 alpha.18.12 的历史记录

已发布的 `1.3.0-alpha.18.12` 在alpha.18.11基线上完成2026-10-08 SmartType升级。普通用户请到 [本版安装包下载页](https://github.com/libingzheng00-eng/guangying-writer/releases/tag/v1.3.0-alpha.18.12) 选择DMG，不要把源码ZIP当作安装包。macOS Apple Silicon应用、DMG和ZIP完成本地核验；桌面独立安装alpha.18.12，不强制退出旧用户应用或删除用户资料。GitHub main与公开附件是两项独立交付，实际状态分别以仓库和对应Release为准。该 macOS Release 仍是alpha测试版，不是正式1.3.0；Release发布不会自动替换他人已安装应用。

在新空段直接输入“特”可推荐“特写 · 镜头”，输入“小明”可同时选择“小明 · 人物”“小明妈妈 · 人物”；明确选中才一起补全文字并修改属性。**第一次 Enter 确认并留在同段，第二次 Enter 再切段**；未新输入不反复弹候选。旧正文、粘贴、拆行尾文和双列不启用新跨类型识别，原同类型字段补全保留；九类Tab、组合输入安全及一次撤销保护不变。此新规则覆盖旧版“Enter接受后立即下一段”，不影响PDF、卡片、归幕或工程格式。维护者以 [核心契约](CORE_FEATURES.md) 为准，不能将历史日志中的旧规则恢复回来。

本版另加入恢复点成功/失败反馈与关闭提示、单份自动恢复、工程临时落盘和上一版备份，以及只读写作派生/快捷输入目录复用。自动恢复约900ms停笔写入、连续修改最长约30秒更新，**不等于保存磁盘 `.zhsp`**；恢复失败或坏载荷有保护，关闭前仍应明确保存。成功保存时文件备份为替换前工程；最终替换失败时备份可能与当前工程同版本，不是无限历史。普通文件mode可保留，不承诺全部ACL/xattr或任何文件系统断电无损。性能改动没有重写分页/PDF或改变写作快捷键。

既有 macOS alpha.18.12 发布时，37套源码专项全部退出0，SmartType模型132项、UI511项通过，独立发布安全675项通过；最终源码六组真实Electron SmartType/editing/input/search/image/PDF专项退出0。完整保存模型和可见正文快照确认拖图不改正文。实际PDF核对第五场旁图片/声音卡原位、A4与短对白；长稿250及双列170个唯一标签均恰好一次，逐页目视范围详见 [SmartType验收记录](SMARTTYPE_QA_20261008.md)，不把代表页检查描述成所有长稿逐页验收。包白名单、独立空白首次启动与签名完整性通过，附件说明见 [alpha.18.12交付记录](RELEASE_ALPHA_18_12.md)。真实macOS中文输入法、跨机器安装、Windows与其他架构没有因此得到验证。

自动化、真实浏览器、真实Electron、原生剪贴板和实际PDF是不同验收层，不承诺所有平台均已稳定。2026-10-07历史证据保留在 [编辑验收记录](EDITING_QA_20261007.md)、[界面验收记录](design-qa.md) 与 [恢复及原生验收记录](RELIABILITY_QA_20261007.md)，不能当作本轮所有项目均已重新实测。发布包空白启动、生产资源、签名与实际下载附件也须分别核对。

## Windows x64 候选

本分支加入 Windows x64 免安装包、专用 Windows CI 与隔离原生验收。下载方式、构建命令、保存路径及未验证项见 [Windows 说明](WINDOWS.md)。产物随提交上传为 Actions artifact，不替换以上 macOS Release；是否通过以目标提交的 Windows CI 为准。

## 开发与维护

使用 Node.js 22.13+（CI 为 Node 22），依赖以 `package-lock.json` 为准。Electron 42+ 的 npm ci 不下载二进制；源码检查可直接运行：

```bash
npm ci
npm run typecheck
npm run build
npm run test:core
npm run dev
```

当前47套源码回归的统一入口是 `test:core`，包含启动页、最近项目、写作位置、恢复、工程落盘、保存IPC、写作派生，模态焦点、文件菜单、设置读写一致性及工程/显示/IPC安全专项。它不启动原生 Electron，不读取用户剧本或系统剪贴板；原生验收须独立进行。

维护前请依次阅读：

1. [AGENTS.md](AGENTS.md)：协作与隐私约束。
2. [CORE_FEATURES.md](CORE_FEATURES.md)：核心功能与不可擅改的行为契约。
3. [MAINTENANCE.md](MAINTENANCE.md)：当前模块关系、历史事务、剪贴板、异步保存、验证与发布流程。
4. [DEVELOPER_HANDOFF.md](DEVELOPER_HANDOFF.md) / [CHANGELOG.md](CHANGELOG.md)：交接与版本记录。
5. [MIGRATION.md](MIGRATION.md)：回迁背景与历史兼容说明。

运行或打包前，`node scripts/prepare-electron.cjs` 显式下载已锁定的 Electron。候选 Mac 包使用 `node scripts/package-macos.cjs <新目录>`，额外生成提交清单、SHA-256和签名报告；底层仍使用 `package.sh`；macOS 发布流水线另生成 DMG。ad-hoc 签名不等于 Apple 签名/公证，本机能打开也不等于其他电脑都能打开。不要修改系统安全设置来绕过测试失败。

贡献时请使用合成稿，不提交用户剧本、自动保存或私人图片；不要删除核心断言或降低 CI 来掩盖回归。已安装应用、个人文档与他人已有工作区变更不在一般代码优化的修改范围内。

## 反馈

可提交 [GitHub Issue](https://github.com/libingzheng00-eng/guangying-writer/issues)，附版本、系统、最小复现步骤和脱敏截图。请不要上传真实剧本。公开联系邮箱：libingzheng00@gmail.com。
