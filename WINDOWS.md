# Windows x64 测试版

当前候选为 **`1.3.0-alpha.18.16` / Electron `44.7.0`**，目标为 **Windows 10 及以上、x64**。交付形式是免安装便携 ZIP，未做 Authenticode 签名。改稿工作台的功能与旧版回存限制见 [REVISION_WORKSPACE.md](REVISION_WORKSPACE.md)。

[Windows 工作流](.github/workflows/windows.yml)按目标提交构建并验收，在 Actions 中保留候选包和证据，不创建 GitHub Release。本文说明当前配置与验收范围；本轮 Windows CI 是否通过，须核对最终提交对应的运行结果，不能沿用较早提交或 macOS 本地结果。

## 获取与使用

Windows CI 成功后，在对应 [Actions 运行](https://github.com/libingzheng00-eng/guangying-writer/actions/workflows/windows.yml) 下载 `GuangyingWriter-Windows-x64-<完整提交SHA>` artifact。先解开 artifact，再解开里面的 `GuangyingWriter-Windows-x64-v<版本>.zip`，运行 `GuangyingWriter-win32-x64/GuangyingWriter.exe`。须保留整个目录，不能只复制 exe；可把完整目录放在普通用户可写的位置。

便携包不安装注册表项、不关联 `.zhsp`，也不设置自动更新。系统可能显示未识别发布者或 SmartScreen 提示；不要关闭系统安全功能。Windows Server 2022 x64 runner 的结果不等于 Windows 10/11 消费电脑均已验收；ARM64、32 位、网络盘、OneDrive 同步冲突及长路径也不在本轮验证范围内。

在 PowerShell 中可用 `Get-FileHash -Algorithm SHA256 <ZIP路径>` 与同一 artifact 的 `SHA256SUMS.txt` 比较。`build-manifest.json` 记录源码提交、Electron 版本及全部运行时文件的大小/SHA-256，ZIP 解压后的所有文件也由 CI 回读核验。GitHub artifact 默认保留 30 天；过期后需从对应提交重新构建。

工程通过软件内“文件 → 打开”选择 `.zhsp`。Windows 快捷键使用 Ctrl，重做为 **Ctrl+Shift+Z**；Tab/Shift+Tab 仍在当前正文段落内循环九种类型。保存会保留同目录的上一版 `<文件名>.guangying-backup`；自动恢复仍是单份快照，不等于成功保存工程。数据目录使用原 Electron 应用身份的系统默认位置，未改应用标识、存储键或旧工程格式。Windows 不能确认目录 fsync 时保留既有耐久性限制，不承诺断电无损。

试用改稿功能请使用工程副本。alpha.18.15 及更早版本不识别新增改稿记录，旧版再次保存会丢失版本库、暂存、批注及交稿忽略记录；不要用旧版覆盖回存已在新版修改的工程。

## 开发与构建

在 Windows x64 上安装 Node.js 22.13+ 与 Git，检出目标提交后运行源码与打包命令。下面包含完整 CI 验收顺序；其中 `windows-launch.cjs` 仅允许在一次性的 GitHub 托管 runner 执行，不能在个人桌面运行或伪造 CI 环境变量绕过保护。

```powershell
npm ci
npm run typecheck
npm run build
npm run test:core
node scripts/release-assets-test.cjs
node scripts/dev-watch-test.cjs
npm run test:windows-package
node scripts/package-windows.cjs
node scripts/windows-launch.cjs --app release/windows/GuangyingWriter-win32-x64 --output release/windows/launch-evidence --manifest release/windows/build-manifest.json
node scripts/windows-smoke.cjs --app release/windows/GuangyingWriter-win32-x64 --output release/windows/evidence --manifest release/windows/build-manifest.json
node scripts/prepare-electron.cjs
node scripts/legacy-links-native.cjs --output (Join-Path $PWD 'release/windows/legacy-links')
node scripts/review-native.cjs --output (Join-Path $PWD 'release/windows/review-evidence')
```

`npm run pack:win` 会先构建 renderer 再打包；`package-windows.cjs` 只接受 Windows x64，源码必须已提交且工作树干净，已有输出目录会拒绝覆盖。重试可传新的输出目录，例如 `node scripts/package-windows.cjs release/windows-candidate-2`，并相应调整后续命令。各验收输出目录也必须是新目录。CI 还会压缩包、生成校验值、解压回读，并对解压后的程序运行原始入口与隔离副本验收；上述本地命令不替代这一步。

打包使用锁定的 `@electron/packager` 和 Electron **44.7.0**。生产应用资源只包含 `package.json`、`LICENSE`、`electron/` 和 `dist-renderer/`，不包含测试脚本、项目的 `node_modules`、用户文件或自动恢复；Electron 运行时随包交付。Windows 图标取自现有 ICNS 的 256px PNG；exe 属性使用 Windows 数字版本 `1.3.0.0`，软件内部、manifest 和 ZIP 文件名保留完整 alpha 版本。

Electron 44 的 npm 包不会在 `npm ci` 时自动准备原生二进制。`prepare-electron.cjs` 显式调用已安装包的下载入口，按锁定版本及官方校验值准备运行时；已有有效运行时会复用。`review-native.cjs` 自身不安装或下载，运行前必须完成准备。工作流把这一步放在旧连线和改稿原生专项之前。

运行时升级与审计背景见 [SECURITY_UPGRADE.md](SECURITY_UPGRADE.md)。当次依赖状态以候选 artifact 的 `dependency-audit.json` 为准；功能回归通过不代表没有依赖告警。

## 验证范围

| 层级 | 内容 | 证据边界 |
| --- | --- | --- |
| 本地源码 | 类型、renderer 构建、统一 53 套核心回归（含六套改稿专项）、发布安全、watcher、包验证器 | 非 Windows 环境的结果不能证明 Windows 原生行为 |
| Windows CI 源码 | 同一完整基线、大小写路径队列、中文空格路径、Windows 权限及 junction | Windows Node/文件系统验证，仍不是用户实机操作 |
| Windows 打包 | x64 PE、名称/图标、生产白名单、源码匹配、全部文件哈希、ZIP 解压回读 | 未签名，不是安装程序或 SmartScreen 验证 |
| Windows 原始入口 | 在一次性 GitHub Windows runner 直接启动未经修改的交付 exe，以独立临时 userData 验证原 manifest/main、空白启动、版本、错误及正常关闭 | 使用 Electron 调试协议观测；包文件前后哈希一致，不覆盖个人配置 |
| Windows 原生载具 | 已打包 exe 的独立副本，执行原生产 main/preload/renderer；首次启动、恢复、自动继续三个阶段，以及 Ctrl/Tab、CDP 组合事件、保存/备份、关闭保护和实际 PDF 生成 | QA 副本仅改 manifest 入口并加测试壳，生产资源哈希前后匹配；文件选择和关闭按钮响应由测试替身提供 |
| Windows 模态与菜单 | 同一隔离载具检查标题页/设置焦点、Tab/Shift+Tab/Esc、背景 inert、原生查找与视图命令边界、正文选区恢复、文件菜单键盘与点击命中；日夜两种窗口尺寸保留截图 | Chromium输入与实际绘制；原生 MenuItem 回调由脚本调用，不等于人工操作系统菜单或真实输入法 |
| 旧连线兼容 | 独立隐藏入口执行生产 main/preload/构建后 renderer；打开、重复保存、上一版备份、独立重启、恢复与最近工程重开；拒绝无效工程 | 合成工程和独立临时数据；选择对话框由测试替身提供，不是人工打开用户工程 |
| 改稿工作台 | `review-native.cjs` 用现有运行时和构建后 React/preload，验证选区、版本/暂存/批注、取回与撤销、恢复重载、场景字段/排序、日夜布局及两类 PDF 生成 | 从创建时隐藏窗口；使用合成 DOM 输入，场景字段必要时模拟 DOM focusin/focusout，不取得操作系统焦点；该入口不执行生产 main 的完整文件生命周期 |

原生载具使用新建合成数据及临时 userData，不访问现用应用或真实剧本；既有 SmartType 专项继续检查候选、第一次 Enter 原位确认、原子撤销重做及第二次 Enter 切段。证据 artifact 中的 JSON、日志、截图和 PDF 都来自合成内容。工作流在任一验收失败时不上传候选 ZIP，并保留已产生的证据；实际结果须以目标提交的 CI 为准。

改稿专项会上传固定白名单证据，包括 `summary.json`、原始结果、隐藏窗口记录、截图、创作/A4 PDF 及 `expected-pdf-markers.json`。摘要记录平台、架构、运行时版本及 HTML/JS/CSS 哈希，并验证这些构建文件运行前后未变。**专项成功仅证明实际 PDF 已生成，尚需对 Windows 输出独立提取文字，核对正文标记完整且七个内部记录标记均未出现，并检查实际渲染。** 不得把 macOS PDF 的提取或目视结果直接当作 Windows 通过记录。

尚需人工验证：微软拼音/第三方中文输入法候选确认与 SmartType、真实原生打开/保存/覆盖/取消对话框、系统关闭按钮/Alt+F4、跨应用剪贴板、图片鼠标拖放、故事板与自由板拖拽、不同 DPI/字体/显示器及中文 PDF 视觉布局、长时间写作恢复。自动化 PDF 生成和 CDP 组合事件不能替代这些项目。正式面向用户发布前，应另行完成这些验收并评估代码签名。

## 平台适配历史

- **alpha.18.12（2026-10-08）**：从 `main` 的 `dcc097bc324dc081a68c5120a9260530e2278a33` 开始 Windows x64 适配，沿用当时 Electron 31.7.7，包含 PR #11 SmartType 和 PR #12 watcher 隔离。随后加入模态与菜单专项，当时源码基线增至 39 套。该阶段没有重打、替换或移动已有 macOS Release 附件。
- **alpha.18.13**：独立安全升级将 Electron 固定到 44.7.0，并补充工程输入、主进程导航、IPC/文件授权和两平台候选校验；详见 [安全升级记录](SECURITY_UPGRADE.md)。
- 旧 [Windows 依赖审计](DEPENDENCY_AUDIT_WINDOWS.md)记录的是升级前 10 个受影响包，不代表当前依赖状态。旧版本、套件数量和当时交付状态仅用于追溯；当前构建及验证入口以上文和 [Windows 工作流](.github/workflows/windows.yml)为准。
