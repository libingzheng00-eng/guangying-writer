# Windows x64 测试版

本轮从 `main` 的 `dcc097bc324dc081a68c5120a9260530e2278a33` 开发，应用版本仍为 `1.3.0-alpha.18.12`。这包含 PR #11 的 SmartType 新行为和 PR #12 的开发 watcher 隔离；不是从旧 alpha.18.11 分叉。现有 macOS Release 和附件没有重打、替换或移动。

## 获取与使用

Windows CI 成功后，在对应 [Actions 运行](https://github.com/libingzheng00-eng/guangying-writer/actions/workflows/windows.yml) 下载 `GuangyingWriter-Windows-x64-<完整提交SHA>` artifact。先解开 artifact，再解开里面的 `GuangyingWriter-Windows-x64-v1.3.0-alpha.18.12.zip`，运行 `GuangyingWriter-win32-x64/GuangyingWriter.exe`。须保留整个目录，不能只复制 exe；可把完整目录放在普通用户可写的位置。

这是免安装、未做 Authenticode 签名的 alpha 候选，不写注册表、不关联 `.zhsp`、不设置自动更新，也不创建正式 Release。系统可能显示未识别发布者或 SmartScreen 提示；不要关闭系统安全功能。未验证 Windows 10/11 消费电脑、ARM64、32 位、网络盘、OneDrive 同步冲突及长路径。Windows Server 2022 x64 runner 的运行结果不等于这些系统都已验收。

在 PowerShell 中可用 `Get-FileHash -Algorithm SHA256 <ZIP路径>` 与同一 artifact 的 `SHA256SUMS.txt` 比较。`build-manifest.json` 记录源码提交、Electron 版本及全部运行时文件的大小/SHA-256，ZIP 解压后的所有文件也由 CI 回读核验。GitHub artifact 默认保留 30 天；过期后需从对应提交重新构建。

工程通过软件内“文件 → 打开”选择 `.zhsp`。Windows 快捷键使用 Ctrl，重做为 **Ctrl+Shift+Z**；Tab/Shift+Tab 仍在当前正文段落内循环九种类型。保存会保留同目录的上一版 `<文件名>.guangying-backup`；自动恢复仍是单份快照，不等于成功保存工程。数据目录使用原 Electron 应用身份的系统默认位置，未改应用标识、存储键或旧工程格式。Windows 不能确认目录 fsync 时保留既有耐久性限制，不承诺断电无损。

## 开发与构建

在 Windows x64 上安装 Node.js 22.13+ 与 Git，检出目标提交后运行：

```powershell
npm ci
npm run typecheck
npm run build
npm run test:core
node scripts/release-assets-test.cjs
node scripts/dev-watch-test.cjs
npm run test:windows-package
node scripts/package-windows.cjs
node scripts/windows-smoke.cjs --app release/windows/GuangyingWriter-win32-x64 --output release/windows/evidence
```

`npm run pack:win` 会先构建 renderer 再打包；`package-windows.cjs` 只接受 Windows x64，源码必须已提交且工作树干净，已有输出目录会拒绝覆盖。重试可传新的输出目录，例如 `node scripts/package-windows.cjs release/windows-candidate-2`。macOS 继续使用原 `package.sh`，Windows 流程没有发布权限。

打包使用锁定的 `@electron/packager`，沿用源码锁定的 Electron `31.7.7`，没有在平台适配中混入 Electron 大版本升级。生产 app 只包含 `package.json`、`LICENSE`、`electron/` 和 `dist-renderer/`，不包含测试、node_modules、用户文件或自动恢复。Windows 图标取自现有 ICNS 的 256px PNG；exe 属性使用 Windows 数字版本 `1.3.0.0`，软件内部、manifest 和 ZIP 文件名保留完整 alpha 版本。旧运行时及依赖升级应作为独立回归工作，不把本候选称作正式稳定版。

2026-10-08 的[有界依赖审计](DEPENDENCY_AUDIT_WINDOWS.md)发现 10 个受影响包（5 high / 5 moderate），均继承自基线，新增打包依赖没有新增受影响节点。Electron 本身随程序交付，存在已知运行时风险；正式推广前应优先升级并完成两平台回归。功能 CI 通过不等于这些风险已经修复。

## 验证范围

| 层级 | 内容 | 证据边界 |
| --- | --- | --- |
| Mac 本地源码 | 类型、renderer 构建、37 套核心回归、发布安全、watcher、包验证器 | 不能证明 Windows 原生行为 |
| Windows CI 源码 | 同一完整基线、大小写路径队列、中文空格路径、Windows 权限及 junction | 真 Windows Node/文件系统，仍不是用户实机操作 |
| Windows 打包 | x64 PE、名称/图标、生产白名单、源码匹配、全部文件哈希、ZIP 解压回读 | 未签名，不是安装程序或 SmartScreen 验证 |
| Windows 原始入口 | 在一次性 GitHub Windows runner 直接启动未经修改的交付 exe，以独立临时 userData 验证原 manifest/main、空白启动、版本、错误及正常关闭 | 使用 Electron 调试协议观测；包文件前后哈希一致，不覆盖个人配置 |
| Windows 原生载具 | 已打包 exe 的独立副本，执行原生产 main/preload/renderer；两次进程启动、Ctrl/Tab、CDP 组合事件、保存/备份/恢复、关闭保护、实际 PDF 生成 | QA 副本仅改 manifest 入口并加测试壳，生产资源哈希前后匹配；文件选择和关闭按钮响应由 stub 提供 |

原生载具使用新建合成数据及临时 userData，不访问现用应用或真实剧本；另实测 SmartType 的候选、第一次 Enter 原位确认、原子撤销重做及第二次 Enter 切段。证据 artifact 中的 JSON、日志、截图和 PDF 都来自合成内容。测试失败会保留证据且不上传候选 ZIP；不能把脚本已写好称为已通过，实际结果须以目标提交的 CI 为准。

尚需人工验证：微软拼音/第三方中文输入法候选确认与 SmartType、真实原生打开/保存/覆盖/取消对话框、系统关闭按钮/Alt+F4、跨应用剪贴板、图片鼠标拖放、故事板与自由板拖拽、不同 DPI/字体/显示器及中文 PDF 视觉布局、长时间写作恢复。自动化 PDF 生成和 CDP 组合事件不能替代这些项目。正式面向用户发布前，应另行完成这些验收并评估代码签名。

## 实施阶段

1. 基线核实与审计：已确认最新 main、alpha.18.12 Release 和原工作树干净；独立分支实现。
2. 平台适配：原生窗框、Windows 建议文件名、大小写保存队列、Ctrl 提示和测试可移植性。
3. 构建/验收：专用 Windows runner、便携包、解压校验、独立原生载具。每次提交的实际结果见 Actions。
4. 交付：隔离分支和 draft PR；不合并 main，不发布或替换现有 Release。
