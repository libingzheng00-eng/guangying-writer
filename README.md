# 墨场 · 中文编剧 — 开发者说明文档

> 开源许可证：[MIT](LICENSE)。稳定版本会发布在 GitHub 的 **Releases** 页面；请从 Releases 下载最新版 DMG 或 ZIP，不要从源码页面下载自动生成的源码压缩包。

> 当前状态（2026-09-06）：源码仍是 `v1.3.0-alpha` 回迁分支，不能替代完整稳定版。用户本机可用的最新成品是独立安装的 v1.2.9。详见 [MIGRATION.md](MIGRATION.md) 和 [DEVELOPER_HANDOFF.md](DEVELOPER_HANDOFF.md)。首次启动模板必须保持为空白，仓库和发布包禁止包含用户剧本。

## 公开发布方式

仓库推送形如 `v1.3.0` 的版本标签后，GitHub Actions 会自动检查源码、构建 macOS arm64 应用、生成 DMG，并将 DMG 与 ZIP 附加到对应 GitHub Release。仓库首页的 Releases 区域会显示最新版本。

未购买 Apple Developer ID 的版本仍是 ad-hoc 签名，首次在另一台 Mac 上打开可能需要用户在“隐私与安全性”中手动确认；它不是已公证的正式签名应用。

> 一款对标 Final Draft 的**中文剧本创作软件**。Electron 31 + React 18 + Zustand + Vite + TypeScript（arm64 / Apple Silicon 原生），纯本地存储，无后端、无账号体系。

本文件面向**日后维护与二次开发**，覆盖：环境搭建、开发与调试、构建、打包发布、整体架构、数据模型、主题系统、扩展方式、测试与已知坑。

---

## 0. 快速导航

| 你想做的事 | 看哪里 |
| --- | --- |
| 安装依赖、跑起来 | §3、§4 |
| 改完代码看效果 | §4 开发与调试 |
| 生成一个可分发安装包 | §6 打包与发布 |
| 理解整体架构 / 进程模型 | §7 |
| 改剧本元素、版式、快捷键 | §9、§14.1 |
| 改主题 / 背景 / 配色 | §12 |
| 加一个视图 / 导入导出格式 | §13、§14.2 |
| 解决 macOS 「已损坏 / 无法打开」 | §6.3、§16.1 |

---

## 1. 技术栈

| 层 | 技术 | 说明 |
| --- | --- | --- |
| 运行环境 | Electron 31.7.7（arm64） | 主进程 + 渲染进程；已适配 Apple Silicon |
| 渲染视图 | React 18.3 + TypeScript 5.5 | 全部 UI 用 React 函数组件 + Hook |
| 状态管理 | Zustand 4.5 | 单一 `useStore`，含撤销/重做历史栈 |
| 构建 | Vite 5.4 | 仅构建**渲染进程**到 `dist-renderer/` |
| 测试 | jsdom 30 | 无头挂载 React 做冒烟测试 |
| 打包 | 手动组装（`package.sh`） | 见 §6；`electron-packager` 在本机有兼容问题，故未直接用 |

> 依赖镜像已在 `.npmrc` 配置（`registry.npmmirror.com` + `electron_mirror`），国内安装更稳定。

---

## 2. 目录结构

```
zh-screenwriter/
├── package.json            # 入口配置：main=electron/main.js、scripts、依赖
├── package.sh              # ★ 打包脚本（手动组装成 .app + .zip）
├── 修复并启动.sh            # 旧版本地辅助脚本（不会用于分发；不得关闭 Gatekeeper）
├── 启动墨场.command         # 双击调用上面的脚本（macOS）
├── vite.config.ts          # 渲染进程构建配置（outDir=dist-renderer, base='./'）
├── tsconfig.json           # TypeScript 配置（含 @/* 别名）
├── index.html              # Vite 入口 HTML
├── .npmrc                  # npm / electron 镜像
├── .gitignore
│
├── electron/               # 【主进程】Node 代码
│   ├── main.js             # 窗口创建、菜单、IPC（文件对话框 / PDF / 最近文件）
│   └── preload.js          # 上下文桥：把安全 API 暴露到 window.api
│
├── src/                    # 【渲染进程】React 源码
│   ├── main.tsx            # React 挂载点
│   ├── App.tsx             # 顶层组件：视图路由 + 菜单/快捷键分发 + 自动保存
│   ├── app/
│   │   └── useCommands.ts  # 文件新建/打开/保存/导入/导出 的统一入口
│   ├── store/
│   │   └── store.ts        # ★ Zustand 全局状态（project / 视图 / 撤销重做 / 各动作）
│   ├── model/              # 纯数据与逻辑（不依赖 React）
│   │   ├── types.ts        # ★ 全部类型定义（ScriptProject / Element / Beat …）
│   │   ├── elements.ts     # 元素元信息、版式、字体预设、修订色
│   │   ├── flow.ts         # Tab/回车 元素流转、双列对白、纯文本智能识别
│   │   ├── project.ts      # 创建/克隆/默认设置/场次派生
│   │   ├── sample.ts       # 示例剧本（首次启动展示）
│   │   └── stats.ts        # 字数/页数统计
│   ├── components/         # React 视图与组件
│   │   ├── Editor.tsx      # ★ 写作视图（contentEditable 元素化编辑）
│   │   ├── ScriptBlock.tsx # 单个剧本块的渲染与输入处理
│   │   ├── CardsView.tsx   # 故事板卡片视图
│   │   ├── BoardView.tsx   # ★ 自由画布（Beat Board，灵感卡 + 场景卡）
│   │   ├── PreviewView.tsx # 分页预览
│   │   ├── ReportsView.tsx # 统计报表
│   │   ├── Sidebar.tsx     # 左侧导航/大纲/检视
│   │   ├── Toolbar.tsx     # 顶栏
│   │   ├── StatusBar.tsx   # 底栏
│   │   └── Dialogs.tsx     # 设置 / 标题页 对话框
│   └── ErrorBoundary.tsx # ★ 渲染进程顶层错误边界（防白屏、可恢复）
│   ├── hooks/
│   │   └── PaginationProvider.tsx  # 实时分页引擎（测量 + 虚拟分页）
│   ├── io/                 # 文件读写
│   │   ├── zhsp.ts         # ★ 原生工程格式（JSON）序列化/解析
│   │   ├── fdx.ts          # Final Draft (.fdx) 导入
│   │   ├── textscript.ts   # 纯文本导入（智能识别元素）
│   │   └── native.ts       # 与主进程的桥接（api 调用 / 菜单监听）
│   ├── utils/              # id / text / dom / color 工具（color：字体颜色派生 hexToRgba）
│   ├── styles/
│   │   └── app.css         # ★ 全部样式 + 设计令牌（东京夜景主题）
│   └── assets/
│       └── tokyo-rainy-night.png  # 写作区背景图
│
├── scripts/               # 测试与诊断
│   ├── render-test.cjs     # jsdom 挂载全应用，验证首屏 + 五视图无报错
│   ├── smoke.js           # 无头启动截图 + 收集 console 错误
│   └── integration-test.cjs # ★ 真实 Electron 集成测试（见 §15）：PDF 有内容 / 预览深色字 / 自由板可拖 / 故事板拖入幕 / 幕标题中文数字 / 拖后一步撤销 / 字体颜色设置 / 防回归静态检查（共 17 项断言）
│
├── dist-renderer/         # 【构建产物】Vite 输出（被 .gitignore 忽略，勿手改）
└── release/               # 【打包产物】Mochang.app + .zip（被 .gitignore 忽略）
```

★ = 改动最频繁、最需要理解的核心文件。

---

## 3. 环境要求与安装

- **Node.js ≥ 18.20**（推荐 20.x）。包管理器用 `npm`。
- **操作系统**：macOS 11+，Apple Silicon（arm64）。Intel Mac 见 §6.4。
- **注意 Electron 二进制**：`npm install` 会通过 `.npmrc` 镜像下载 Electron。若 `node_modules/electron/dist/Electron.app` 缺失或损坏（常见于网络中断 / 被杀毒软件隔离），运行 `bash 修复并启动.sh` 会自动从 `/tmp/electron.zip` 恢复；若无该 zip，需手动从 `https://npmmirror.com/mirrors/electron/` 下载对应版本 arm64 包，解压到 `node_modules/electron/dist/`，并写入 `node_modules/electron/path.txt` 内容为 `Electron.app/Contents/MacOS/Electron`。

```bash
# 安装依赖
npm install

# 类型检查（应零错误）
npm run typecheck
```

---

## 4. 开发与调试

本软件有两种运行模式，由 `electron/main.js` 中的 `ZS_DEV` 环境变量决定加载方式：

| 模式 | 命令 | 加载内容 | 热更新 |
| --- | --- | --- | --- |
| 开发（推荐） | `ZS_DEV=1 npx electron .` | Vite Dev Server (`localhost:5178`) | ✅ 改源码即刷新 |
| 生产 | `npm run build && npx electron .` | 已构建的 `dist-renderer/index.html` | ❌ 需重新 build |

日常改代码可先执行 `npm run build`，再用浏览器打开构建结果进行 UI 验证。Electron 若被 macOS 拦截，不要关闭 Gatekeeper、删除安全属性或执行全局放行命令；应使用经过签名/公证的测试包，或在另一台可信开发机上验证。

### 快捷键速查（写作视图内）

| 操作 | 快捷键 |
| --- | --- |
| 切换元素类型 | `⌘1`~`⌘8`（场次/动作/人物/括号/对白/转场/镜头/幕） |
| 在元素间 Tab 循环 | `Tab` / `Shift+Tab` |
| 确认快捷输入候选 | `Enter`（确认并进入下一元素）/ `空格` 或鼠标（只确认当前行） |
| 新建场景 | `⌘↩` |
| 双列对白 | `⌘D` |
| 省略 / 恢复 | 菜单「元素 → 省略/恢复」 |
| 视图切换 | `⌘⌥1`~`⌘⌥4`（写作/卡片/预览/统计），自由板在工具栏 |
| 保存 / 打开 / 新建 | `⌘S` / `⌘O` / `⌘N` |
| 导出 PDF | `⌘P` |

完整菜单定义在 `electron/main.js` 的 `buildMenu()`。

写作时，进度条的打字机指针会在连续输入期间作低幅度节奏微动；停止输入约 0.56 秒后静止。系统开启“减少动态效果”时，该动效自动关闭。

---

## 5. 构建（仅渲染进程）

```bash
npm run build        # → 生成 dist-renderer/（html/css/js + assets）
```

Vite 配置见 `vite.config.ts`：
- `base: './'`：产物用相对路径，便于塞进 Electron `file://` 协议；
- `build.outDir: 'dist-renderer'`：主进程 `electron/main.js` 固定从这里 `loadFile`；
- `@` 别名指向 `src/`。

主进程代码（`electron/`）**不参与 Vite 构建**，它直接被 Electron 执行。

---

## 6. 打包与发布（重点）

> ⚠️ 本项目**没有使用 `electron-builder` 或 `electron-packager` 的自动流程**。原因：`electron-packager` 在本机 macOS 打包时会报 `Brokered file token refused: modify backup failed`（Electron 二进制拷贝被系统拦截）。因此改用 `package.sh` **手动组装** `.app`，过程透明、易维护，也是本仓库的推荐方式。

### 6.1 一键打包

```bash
bash package.sh
# 等价：npm run pack:mac
```

产物位于 `release/`：
- `release/Mochang.app` —— 独立应用（自带 Electron 运行时，约 228MB，**无需** Node/npm 即可运行）；
- `release/Mochang-macOS-arm64.zip` —— 可分发的压缩包。

`package.sh` 的 6 个步骤（与代码一一对应，便于排错）：
1. `vite build` → 生成 `dist-renderer`；
2. `cp -R node_modules/electron/dist/Electron.app release/Mochang.app` —— 复制 Electron 骨架；
3. 重命名可执行文件 `Electron → Mochang`，并清理默认欢迎页 `default_app.asar`；
4. 用 `PlistBuddy` 写入 `Info.plist`（`CFBundleName` / `CFBundleDisplayName` / `CFBundleExecutable` / `CFBundleIdentifier` / 版本）；
5. 把 `electron/` + `dist-renderer/` + `package.json` 拷入 `Contents/Resources/app`；
6. 进行 ad-hoc 自签名 `codesign --force --deep --sign -` 并压缩成 zip；该签名不是 Apple 公证。

### 6.2 自定义产物

| 想改什么 | 改 `package.sh` 哪里 |
| --- | --- |
| 磁盘文件名（.app 名） | `APP_NAME="Mochang"`（保持 ASCII，避免中文路径坑） |
| 在 Finder/Launchpad 显示的中文名 | `DISPLAY_NAME="墨场 · 中文编剧"`（写入 `CFBundleDisplayName`） |
| Bundle 标识符 | `BUNDLE_ID="com.workbuddy.mochang"` |
| 架构（Intel Mac） | `ARCH="x64"`（需先 `npm install` 对应的 electron x64 二进制） |
| 应用图标 | 准备 `.icns`，在 Step 4 加 `set_or_add ":CFBundleIconFile" "icon"` 并 `cp icon.icns` 到 `Contents/Resources/` |

### 6.3 ⚠️ macOS Gatekeeper / 未签名（M1 用户必读）

未购买 Apple Developer ID 并完成公证的版本，可能会被 Gatekeeper/XProtect 拦截，表现为：

- 弹出「「Mochang」已损坏，无法打开」；或
- 直接被丢进废纸篓；或
- 双击瞬间消失（`zsh: killed`）。

**本机或换机器**：若出现系统安全拦截，不要关闭 Gatekeeper 或执行 `sudo spctl --master-disable`。保留提示信息，改用经 Apple 签名并公证的安装包；普通未签名包仅适合受控开发环境。

> 想做**正式分发 + 自动更新 + 公证（Notarization）**，需购买 `Developer ID Application` 证书，改用 `electron-builder` 并配置 `mac.certificate` 与 `notarize`。本仓库已预置 `electron_builder_binaries_mirror` 镜像，迁移成本很低，详见 §16.5。

### 6.4 跨架构 / 多平台

- **x64（Intel）**：`ARCH="x64"` 并确保 Electron 为 x64 二进制（可装两个 Electron 或用 `electron-packager` 的 `--arch` 下载对应包）。
- **Windows / Linux**：手动组装思路一致，但可执行文件名、`Info.plist` 改为各平台清单（`*.exe` / `AppImage`）。当前 `package.sh` 仅覆盖 macOS。

---

## 7. 架构总览

### 7.1 进程模型

```
┌─────────────────────────────────────────────┐
│ 主进程 (electron/main.js, Node.js)            │
│  · 创建 BrowserWindow                         │
│  · 构建原生菜单 (buildMenu)                   │
│  · IPC: 文件对话框 / PDF 导出 / 最近文件      │
│  · ipcMain.handle('dialog:open'|'pdf:export'…)│
└───────────────┬─────────────────────────────┘
                │ preload.js (contextBridge)
                │   window.api = { openProject, saveProject, exportPdf, onMenu … }
                ▼
┌─────────────────────────────────────────────┐
│ 渲染进程 (React, src/)                         │
│  · App.tsx 路由 5 个视图                       │
│  · Zustand store 持有 project 与全部状态       │
│  · Editor / Cards / Board / Preview / Reports │
└─────────────────────────────────────────────┘
```

### 7.2 菜单 → 应用 的命令流

1. 用户在原生菜单点某项 → `electron/main.js` 调 `send('file:save')` → `win.webContents.send('menu:action','file:save')`；
2. 渲染进程 `src/io/native.ts` 的 `onMenuAction(cb)` 监听该事件；
3. `App.tsx` 的 `useEffect` 里把 `action` 字符串映射到 `useCommands` 的具体函数或 `store` 动作（见 `App.tsx` 的 `switch`）；
4. 浏览器环境（非 Electron，纯调试）下无菜单，改用 `window.addEventListener('keydown')` 模拟同样动作。

### 7.3 状态管理（Zustand）

唯一状态源在 `src/store/store.ts` 的 `useStore`：

- `project: ScriptProject` —— 当前剧本全部数据（元素数组 + 卡片 + 设置）；
- 视图/侧栏：`view`、`sidebar`、`sidebarOpen`、`zoom`、`activeId`；
- 历史：`past[]` / `future[]` 两个 `ScriptProject` 快照栈，实现撤销/重做；
- 所有修改都走 `mutate(fn, {coalesce})`：深拷贝 project → 执行修改 → push 历史（同一 `coalesce` key 在 1.5s 内的连续输入合并为一条撤销记录，打字不爆栈）。

> **扩展时务必通过 store 提供的动作改数据**，不要直接改 `project` 对象，否则不会触发渲染与历史记录。

---

## 8. 剧本数据模型（`src/model/types.ts`）

核心对象 `ScriptProject`：

```ts
interface ScriptProject {
  id: string; name: string;
  createdAt: number; updatedAt: number;
  titlePage: TitlePage;          // 标题页
  elements: ScriptElement[];     // ★ 剧本正文，按顺序排列的「块」数组
  sceneMeta: SceneMeta[];        // 场景卡元数据（不存正文，避免场号与正文脱节）
  beats: Beat[];                 // 自由画布上的灵感卡（不绑定场次）
  acts: Act[];                   // 幕 / 分集
  revisions: Revision[];         // 修订集（A/B/C 色）
  settings: ScriptSettings;      // 字体/页边距/版式/分页等所有偏好
  trash?: ScriptElement[];
}
```

关键设计：
- **一个剧本 = 一段有序的 `ScriptElement[]`**。每个块是 `type`（元素类型）+ `text`（正文，可含 `<b>/<i>/<u>` 行内标记）。
- **场景由 `scene_heading` 元素派生**（`project.ts` 的 `deriveScenes`）：扫描 `elements`，遇到 `scene_heading` 就切出一个场景。这样「场号」永远和正文同步，不会出现手抄序号与自动编号叠加成 `11.` 的历史 bug（该 bug 已在 `utils/text.ts` 的 `stripSceneNumber` + 派生时清洗修复）。
- `SceneMeta` 只保存卡片上的额外信息（摘要、颜色、画布坐标），通过 `elementId` 回指场次标题元素。
- `Beat` 是完全独立的灵感卡，可自由摆放，也可 `sceneId` 关联到某个场景。

类型清单：`act / scene_heading / action / character / parenthetical / dialogue / transition / shot / general / note`。其中 `note` 不参与排版、统计与打印。

---

## 9. 中文剧本元素引擎

### 9.1 元素元信息（`src/model/elements.ts`）

- `ELEMENT_META`：每种元素的显示名、占位提示、状态栏缩写、快捷键；
- `DEFAULT_INDENT`：默认版式，**缩进单位用「全角字符数」**（1 = 一个汉字宽度），例如 `character: { left: 13, right: 0 }` 表示人物名向右缩进 13 字宽；
- `FONT_PRESETS`：仿宋/宋体/楷体/黑体/苹方等中文剧本常用字体栈；
- `CARD_COLORS` / `REVISION_COLORS`：卡片与修订配色板。

### 9.2 元素流转（`src/model/flow.ts`）

| 函数 | 作用 |
| --- | --- |
| `nextTypeOnTab(cur, shift)` | `Tab` 在 9 种常用元素间循环（Final Draft 风格，不自动新建行） |
| `nextTypeOnEnter(cur, isEmpty)` | 回车后新块的类型（如 人物→对白、对白→人物、动作→动作） |
| `dualAfterEnter(cur, next)` | 双列对白：左侧对白后自动切到右侧人物，结束再归位 |
| `guessType(line, prev)` | **纯文本导入**时按正则/上下文猜测元素类型 |
| `keepWithNext / canSplit` | 分页引擎用：场次标题至少带 2 行、长动作段可跨页拆分 |

回车流转规则速查：

| 当前元素 | 回车后（有内容） | 空块回车 |
| --- | --- | --- |
| 场次标题 | 动作（先描述画面） | 动作 |
| 动作 | 动作 | 动作 |
| 人物 | 对白 | 对白(若双列) / 动作 |
| 括号 | 对白 | 动作 |
| 对白 | 人物 | 动作 |
| 转场 | 场次标题 | 动作 |
| 镜头 | 动作 | 动作 |

---

## 10. 实时分页（`src/hooks/PaginationProvider.tsx`）

- 渲染进程在隐藏的「测量层」(`.sc-measure`) 渲染同样内容，量出每个块高度；
- 按 `settings` 的纸张/页边距计算每页容量，超出则插入分页点；
- 跨页对白自动补 `(MORE)`（续）标记，下页开头补 `(CONT'D)`（续）；文案分别在 `ScriptSettings.moreText` / `contdText`；
- 写作视图右侧的「分页」玻璃标签由 `.page-break-line::after` 渲染（`app.css` 中已改为半透明药丸，不再是黑块）。

---

## 11. 导入 / 导出（`src/io/`）

| 格式 | 文件 | 说明 |
| --- | --- | --- |
| 墨场工程 `.zhsp` | `zhsp.ts` | **原生格式**：就是带版本号的 `ScriptProject` JSON，`serializeProject` / `parseProject`（容错，兼容旧字段） |
| Final Draft `.fdx` | `fdx.ts` | 导入：解析 FDX XML → 元素数组；导出走菜单 `file:exportFdx` |
| 纯文本 `.txt` | `textscript.ts` | 导入时用 `guessType` 智能识别场次/人物/对白/转场 |
| Markdown `.md` | 同上体系 | 导出为带结构的 Markdown |
| PDF | 主进程 `pdf:export` | `win.webContents.printToPDF`，`@media print` 保证白底黑字 |

所有菜单命令统一入口在 `src/app/useCommands.ts`（`newFile / open / save / saveAs / importAny / exportPdf / exportAs`），新增格式请在这里接线。

---

## 12. 主题系统（`src/styles/app.css`）

整站采用**东京夜景霓虹**暗色主题，所有颜色集中为 `:root` 设计令牌，改主题只动这一处：

```css
:root {
  --bg: #0b0e14;          /* 夜空 / 湿沥青 */
  --panel: #141922;       /* 混凝土立面 */
  --text: #c9d1d9;        /* 路灯冷白 */
  --accent: #58a6ff;      /* 霓虹青蓝 */
  --warm: #ffb347;        /* 琥珀黄 */
  --danger: #f85149;      /* 霓虹红 */
  --neon-yellow: #e9ff3a; /* ★ 写作区荧光黄字 */
  --glass-bg: rgba(20,25,34,0.75);
  --glass-border: rgba(88,166,255,0.1);
  /* 发光令牌 */ --glow-cyan / --glow-cyan-strong / --glow-warm / --glow-red
}
```

要点：
- **写作背景图**：`src/assets/tokyo-rainy-night.png`，由 `.write-bg` 层 `position: fixed` 铺满，滚动文稿时窗景不动；其上叠了 CSS 的 bokeh 光点与雨雾漂移动画。
- **玻璃稿纸**：`.script-flow`（写作区）与 `.preview__page`（预览页）默认纯白；写作视图里 `.script-flow` 被改成磨砂玻璃（`backdrop-filter: blur` + 半透明），窗外夜景透出。
- **荧光黄字体**：`.sc-el` 在写作视图用 `--neon-yellow` 并带柔光。
- **打印隔离**：`@media print` 强制白底黑字，确保 PDF/打印不受暗色主题与荧光黄影响。具体做法：`.preview__page` 显式 `color:#14181f`，`.preview__page .sc-el { color:inherit }` 防止继承暗色主题 `--text` 浅色，且 `@media print` 再强制 `color:#000 !important`。**切勿把预览/打印文字改回浅色**——否则白底浅字会让导出的 PDF 看似空白（详见 §16.7）。

### 常见主题改动
| 需求 | 做法 |
| --- | --- |
| 换写作背景图 | 替换 `src/assets/tokyo-rainy-night.png`（或改 `Editor.tsx` 的 import），注意大图会增大 `dist-renderer` 体积 |
| 调荧光黄亮度 | 改 `:root` 的 `--neon-yellow` |
| 换主色调 | 改 `--accent` / `--warm` / `--danger` |
| 背景再暗一点让字更跳 | 调 `.write-bg` 的 `background-color`（当前 `#05070b`） |
| 关闭雨雾动效 | 注释 `app.css` 中 `@keyframes tokyo-fog-pulse` / `tokyo-drift` 相关 `animation` |

---

## 13. 五大视图与新增视图

| 视图 | 组件 | 入口 key |
| --- | --- | --- |
| 写作 | `Editor.tsx` | `write` |
| 故事板卡片 | `CardsView.tsx` | `cards` |
| 自由画布（Beat Board） | `BoardView.tsx` | `board` |
| 分页预览 | `PreviewView.tsx` | `preview` |
| 统计报表 | `ReportsView.tsx` | `reports` |

视图路由在 `App.tsx` 的 `switch(view)`；切换由 `store.setView()` 控制，菜单/快捷键在 `App.tsx` 里映射为 `view:write` 等 action。

**新增一个视图的步骤**：
1. `src/store/store.ts` 的 `ViewMode` 联合类型加一项；
2. 新建 `src/components/MyView.tsx`；
3. `App.tsx` 的 `import` + `switch` 增加分支；
4. 在 `Toolbar.tsx` 加切换按钮，`electron/main.js` 菜单模板加对应 `view:myview` 项。

---

## 14. 扩展指南

### 14.1 新增一种剧本元素类型
1. `types.ts`：`ElementType` 联合类型加项；`ScriptElement` 无需改（共用字段）；如需要新版式在 `ElementFormat` 说明。
2. `elements.ts`：`ELEMENT_META` 加该类型的 `{label, placeholder, short, hint}`；`DEFAULT_INDENT` 加默认缩进；如需进元素面板，更新 `ELEMENT_ORDER`。
3. `flow.ts`：`nextTypeOnTab` / `nextTypeOnEnter` 决定它前后如何流转；若参与纯文本导入，更新 `guessType`。
4. `Editor.tsx` / `ScriptBlock.tsx`：确认该类型的渲染与输入处理（占位、对齐、是否可编辑）。
5. 若参与排版：`elements.ts` 的 `PRINTABLE` 加入；分页相关 `keepWithNext/canSplit` 视情况更新。

### 14.2 新增导入 / 导出格式
1. `src/io/` 下新建解析/序列化函数（参考 `fdx.ts` / `textscript.ts`）；
2. `src/app/useCommands.ts` 的 `importAny` / `exportAs` 增加分支；
3. `electron/main.js` 的「文件」菜单加对应菜单项（如需新对话框，`ipcMain.handle` 加一个）。

### 14.3 新增菜单项 / 快捷键
- 菜单：编辑 `electron/main.js` 的 `buildMenu()` 模板，点击回调 `send('your:action')`；
- 渲染端：在 `App.tsx` 的 `switch(action)` 增加 `case 'your:action'`，调用 `commands` 或 `store`；
- 浏览器调试快捷键：在 `App.tsx` 非 Electron 分支的 `map` 里加键位。

---

## 15. 测试

| 命令 | 作用 |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit`，应有零错误 |
| `npm run test:render` | `scripts/render-test.cjs`：用 jsdom 真实挂载 App，验证首屏 + 切 5 视图无 `console.error`，并打印元素数/卡片数 |
| `npm run smoke` | `scripts/smoke.js`：用 Electron 无头启动、截图到 `/tmp`、收集 console 错误 |
| `scripts/integration-test.cjs` | **真实 Electron 集成测试**：加载已构建的 `dist-renderer`，在真实渲染进程里验证 ① 预览/PDF 文字为深色且 PDF 非空 ② 自由板场景卡/灵感卡可拖动 ③ 故事板卡片可拖入指定幕 ④ 新增幕标题为中文数字。结果写 `/tmp/mochang-test-result.json`（通过 X/总 Y）与 `/tmp/mochang-test-log.txt` |

`render-test.cjs` 默认加载 `.tmp-app.cjs`（一次性构建的渲染包）；若缺失，先 `npx vite build` 并自行用 esbuild 打包 `src/main.tsx` 为 `.tmp-app.cjs`，或按需调整 `APP_BUNDLE` 环境变量指向 `dist-renderer` 的 bundle。

### 15.1 如何运行集成测试（关键：让它以「主进程」身份运行）

`integration-test.cjs` 自身是 Electron **主进程**脚本（顶部 `require('electron')` 用到 `app`）。**不能**用 `electron scripts/integration-test.cjs` 直接跑——CLI 会把 `.cjs` 当普通 Node 脚本加载，`require('electron').app` 为 `undefined`；也**不能**靠 `electron .` 传参（dev 二进制会把目录当成 Node 入口，同样报 `whenReady of undefined`）。可靠做法（一次性，测试完务必还原 `package.json` 的 `main`）：

```bash
# 0) 先构建渲染产物
npm run build

# 1) 临时把 main 指向测试脚本
#    package.json: "main": "scripts/integration-test.cjs"

# 2) 在 dev Electron 的 Resources 下建 app 软链，使其优先于 default_app.asar 被加载
RES="$(pwd)/node_modules/electron/dist/Electron.app/Contents/Resources"
ln -sfn "$(pwd)" "$RES/app"

# 3) 用 open -a 启动（不要用 `electron .`，否则会跑成 default_app）
#    ⚠️ 启动前必须先清掉残留的 Electron 主进程：open -a 会复用已运行的实例，
#       那只会切回旧窗口 / 旧入口，测试根本不会跑（表现：结果文件一直不生成）。
pkill -9 -f "zh-screenwriter.*MacOS/Electron"   # ⚠️ 务必带项目路径
open -a "$(pwd)/node_modules/electron/dist/Electron.app"
#    等待 ~15s（脚本内有多处 sleep，完整跑完 17 项约 15s），读结果：
cat /tmp/mochang-test-result.json

# 4) 还原（很重要，否则正常启动会跑测试而非软件）
rm -f "$RES/app"
#    package.json 改回 "main": "electron/main.js"
```

测试通过后会 `process.exit(0)`；任一项失败则 `exit(1)` 并在 `/tmp/mochang-test-log.txt` 给出逐条 ✅/❌。

> **⚠️ 运行环境坑（本机必看）**：若启动时报 `Cannot read properties of undefined (reading 'handle')`（即 `ipcMain` 为 `undefined`），是 `require('electron')` 解析到了 npm 包而非运行时模块。根因是环境里预设了 `ELECTRON_RUN_AS_NODE=1`，让 Electron 以纯 Node 模式启动（`process.type` 为 `undefined`）。**解决**：运行前 `unset` 该变量：
> ```bash
> env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/Electron.app/Contents/MacOS/Electron scripts/integration-test.cjs
> # 或：env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron scripts/integration-test.cjs
> ```
> 这样 `require('electron')` 才会返回真正的运行时模块（`app` / `ipcMain` / `BrowserWindow` 均可用）。

建议提交前至少跑 `npm run typecheck` + `npm run test:render`；涉及故事板/自由板/导出 PDF 的改动，再补一轮 `integration-test.cjs`。

---

## 16. 已知问题与坑

### 16.1 Gatekeeper / 未签名（最重要）
见 §6.3。未公证的包可能在新机器上被拦截；不要通过关闭 Gatekeeper 来规避。面向用户分发前必须完成签名与公证。

### 16.2 中文输入法
`Editor.tsx` 用 `contentEditable` + ` compositionstart/end` 监听处理中文输入法，避免拼音上屏时误触发元素切分。改编辑器输入逻辑时务必保留 composition 守卫。

### 16.3 场景编号重复（`11.` bug，已修复）
早期手写「1.」与自动编号叠加会变成 `11.`。修复点：`utils/text.ts` 的 `stripSceneNumber`（显示前剥离手写序号）、`project.ts` 的 `deriveScenes` 清洗、`sample.ts` 去手写序号、`Editor.tsx` 失焦清理。新增涉及场号的代码时要注意复用既有清洗逻辑。

### 16.4 背景图体积
`src/assets/tokyo-rainy-night.png` 约 2.4MB，会原样进 `dist-renderer/assets`。如需瘦身，可压缩为 WebP 或在 `vite.config.ts` 加图片压缩插件。

### 16.5 electron-packager 在本机报错
`Brokered file token refused: modify backup failed` —— Electron 二进制拷贝被系统拦截。本仓库已改用 `package.sh` 手动组装绕过（§6）。如日后想在 CI 用 `electron-builder` 出 DMG 并公证，需配 `Developer ID` 证书与 `notarize`。

### 16.6 自动保存在 localStorage
`App.tsx` 每 ~900ms 把 `project` 写入 `localStorage`（`mojiang:autosave`）。容量上限约 5MB，超长剧本可能写入失败（已 try/catch 忽略）。正式持久化请养成 `⌘S` 存 `.zhsp` 文件的习惯。

### 16.7 故事板分组 / 自由板拖拽 / 预览 PDF 文字（一批已修复，留作维护提醒）

这几处都是「改的时候容易忽略的隐性约束」，回归会导致用户报过的 bug 复现，改动相关代码务必对照：

- **故事板卡片必须「拖入某幕」才会归入该幕，而且要一次成型**。`CardsView.tsx` 的 `dropBefore`/`dropInSection` 统一调用 store 的 `dropSceneInAct(from, to, elementId, actId)`：它在**一次 `mutate` 内**同时完成 `moveSceneBlock`（调整全局顺序）与写入 `sceneMeta.actId`（分组）。两条约束缺一不可：① 只移动不写 `actId`，跨幕拖后卡片会回到原幕；② 若拆成 `moveSceneTo` + `updateSceneMeta` 两次 `mutate`，会产生**两条撤销记录**，用户按一次 ⌘Z 只回退一半（表现为「撤销不了」）。新增任何拖拽落点务必走 `dropSceneInAct`，不要让 UI 层自己拼两次 mutation。

- **幕标题统一用中文数字**。`addAct` 用 `utils/text.ts` 的 `cnNum()` 生成「第一幕/第二幕…」，不要写阿拉伯数字「第2幕」。`loadProject` 已加规范化：把旧数据里的「第N幕」（阿拉伯）自动转成中文数字，避免格式不统一。改到幕标题生成逻辑时务必走 `cnNum`。

- **预览 / PDF 文字颜色**。`app.css` 里 `.preview__page` 显式设 `color:#14181f`（白纸深色字），`.preview__page .sc-el { color:inherit }` 防止继承暗色主题 `--text` 的浅色；`@media print` 还强制 `.preview__page, .sc-el, .title-page, .page__body, .sc-scene-no, .sc-contd, .sc-more { color:#000 !important }`。**原因**：暗色主题下 `body{color:var(--text)}`(#c9d1d9 浅灰) 被剧本元素继承，白底浅字导致 PDF 看似空白。改预览/打印样式时切勿恢复成浅色字。

- **自由板场景卡 `data-id` 必须等于 `scene.elementId`**。`BoardView.tsx` 的画布通过 `target.closest('[data-card]')` 识别被拖卡片，再用 `data-id` 作为 `setScenePos`/`moveBeat` 的查找键。场景卡曾误用 `scene.id`（= sceneMeta.id），导致坐标写入「孤儿」meta、卡片拖完弹回（表现为「拖不动」）。场景卡务必 `data-id={scene.elementId}`，灵感卡 `data-id={beat.id}`；两张卡都带 `data-card data-drag` 属性，由画布层统一处理，不要给单卡挂独立 `onDown` 闭包。

> 以上几项的自动化回归见 §15.1 的 `scripts/integration-test.cjs`（17 项断言：PDF 非空、预览深色字、自由板两类卡片可拖 + 拖后一步撤销、故事板拖入幕 + 拖后一步撤销、幕标题中文数字、字体颜色设置生效，外加 3 项静态检查防止已修 bug 回归）。

### 16.8 编辑菜单快捷键与撤销（已修复，勿踩回）

- **菜单项绝不能同时写 `role` 和 `click`**。「编辑 → 撤销 / 重做」曾写成：
  ```js
  { label: '撤销', accelerator: 'CmdOrCtrl+Z', click: () => send('edit:undo'), role: 'undo' }
  ```
  Electron 里 **`role` 优先级更高，`click` 会被直接忽略**，⌘Z 走的是原生 undo（只作用于原生输入框），在故事板 / 自由板这类没有文本焦点的视图中完全无反应，永远到不了 `store.undo()`。现在这两项只保留 `accelerator` + `click`。**凡是自定义了 `click` 的菜单项，都不要再写 `role`**；反过来，纯原生能力（cut/copy/paste/selectAll、toggleDevTools 等）保持只写 `role` 即可。

- **一个用户操作 = 一条撤销记录**。`mutate(fn, { coalesce })` 的 `coalesce` 用于合并 1.5s 内连续的同类修改（拖动卡片时反复触发的 `setScenePos`、连续打字的 `setText`）。但**逻辑上属于同一步的多个不同 mutation 必须合并进一次 `mutate`**（见 §16.7 的 `dropSceneInAct`），否则用户要按两次 ⌘Z 才能回到起点，主观感受就是「撤销坏了」。

- **无历史时的反馈**：`store.undo() / redo()` 在栈空时会 `notify('没有可撤销/可重做的操作')`。排查「快捷键没反应」时，能借此区分是「没送达」还是「真的没历史」。

- **测试要覆盖真实菜单链路**：`integration-test.cjs` 里的窗口必须加载 `electron/preload.js`，否则渲染进程 `isElectron()` 为 false，`App.tsx` 会走浏览器降级分支（本地 keydown），测的根本不是菜单那条路。撤销用例用 `win.webContents.send('menu:action', 'edit:undo')` 触发。

### 16.9 写作字体颜色（外观设置）

- 写作视图正文颜色由 CSS 变量 `--neon-yellow` 控制（默认荧光黄 `#e9ff3a`，见 `app.css` 的 `:root` 与 `.sc-el--editable`）。用户在「设置 → 外观 → 写作字体颜色」选择预设或用取色器自定义。
- 这是 **app 级设置，不写入 `.zhsp`**：存在 `localStorage`（`mojiang:fontColor`），由 `store.fontColor` / `setFontColor` 管理；`App.tsx` 用 `useEffect` 把主色及派生的 `--neon-yellow-soft` / `--neon-yellow-glow` 写到 `document.documentElement.style`。派生色一律走 `utils/color.ts` 的 `hexToRgba()`，**不要在 CSS 里写死**，否则换色后发光/占位符颜色对不上。
- **导出 PDF / 打印始终是黑字**，不受此设置影响（`app.css` 的 `@media print` 强制 `#000`，见 §16.7）。改动此处时别把打印样式一起带进去。

### 16.10 运行稳定性加固（本次优化，维护时勿撤）

目标：让软件在「组件偶发抛错 / 主进程异常 / 文件读写失败 / 重复打开 / 脏偏好值」等情况下**不白屏、不死进程、可恢复**。本轮落地的加固：

- **① 渲染进程错误边界** [`src/components/ErrorBoundary.tsx`，由 `src/main.tsx` 包裹 `<App/>`]：任意组件在渲染期抛出未捕获异常，不再整块白屏，而是展示一张可恢复面板（显示错误信息 + 「重新加载界面」/「整页刷新」）。崩溃被 `componentDidCatch` 打到 `console`，便于定位。样式见 `app.css` 的 `.fatal` 段。**新增顶层组件时，它已自动被边界覆盖，无需额外处理**。

- **② 主进程崩溃兜底** [`electron/main.js` 顶部]：注册 `process.on('uncaughtException')` 与 `process.on('unhandledRejection')`，把未捕获异常/未处理拒绝收拢成 `console.error` +（窗口在时）错误框，避免进程「悄无声息地死掉」。

- **③ 单实例锁** [`electron/main.js` 生命周期]：`app.requestSingleInstanceLock()`。重复双击 `.app` 只聚焦已开窗口（`second-instance` 事件里 `restore + show + focus`），不再起第二个进程抢写同一份 `userData` / 自动保存。非首实例直接 `app.quit()`。

- **④ 向已销毁窗口发消息的崩溃** [`electron/main.js`]：`win.on('closed')` 把 `win` 置 `null`；`send()` 加 `!win.isDestroyed()` 守卫。修复：窗口关闭后若仍有菜单/定时器回调 `send`，原代码会向已销毁 `BrowserWindow` 发 `webContents.send` 而抛错。

- **⑤ IPC 文件读写容错** [`electron/main.js` 的 `dialog:open` / `dialog:save` / `dialog:saveAs`]：文件读取、写入均包 `try/catch`，失败时弹错误框并返回 `null`（上层 `useCommands` 的 `save/open` 已 `try/catch` 兜第二次）。避免磁盘满/无权限/文件被占用时 IPC 拒绝导致界面卡死。

- **⑥ 字体色脏值校验** [`src/store/store.ts` 的 `loadFontColor` + `src/App.tsx` 注入处]：`localStorage` 的 `mojiang:fontColor` 用 `utils/color.ts` 的 `isHexColor` 校验，非法值回退默认 `#e9ff3a`；注入 CSS 变量前再校验一次。防止手动改坏 localStorage 后注入非法 `--neon-yellow`，导致写作区字体颜色异常。

- **⑦ 分页引擎除零兜底** [`src/hooks/PaginationProvider.tsx`]：`contentHeightPx` / `lineHeightPx` 在分页计算前 `Math.max(1, …)`，防止纸张/字号/行高被设成 0 时除法得到 `NaN/Infinity`，引发分页死循环或白屏。

- **⑧ 自动保存 effect 规范化** [`src/App.tsx`]：原 `useEffect(…, [useStore((s) => s.version)])` 在依赖数组里调 hook（不规范且易踩 lint）。改为组件顶部 `const version = useStore((s) => s.version)` 后依赖 `[version]`，行为不变、更稳。

> 以上加固均通过 `npm run typecheck` 零错误 + `integration-test.cjs` 17/17 验证，未引入功能回归。改动错误边界 / 主进程兜底逻辑时，记得补跑一遍 §15.1 的集成测试。

---

## 17. 常见问题 FAQ

**Q：改了源码但界面没变？**
A：开发模式要 `ZS_DEV=1 npx electron .` 且 Vite Dev Server 在跑；生产模式改完需 `npm run build` 再 `npx electron .`。打包产物来自 `release/`，和 `npm run dev` 无关。

**Q：打包后 `.app` 打开闪退 / 被丢废纸篓？**
A：见 §6.3。不要通过关闭 Gatekeeper 或清除安全属性来绕过拦截；请使用经签名和公证的发布包。

**Q：想换 app 图标？**
A：准备 `.icns`（可用 `iconutil` 或在线工具生成），在 `package.sh` Step 4 写入 `CFBundleIconFile` 并 `cp` 到 `Contents/Resources/`。

**Q：导出 PDF 字体/排版不对？**
A：检查 `settings.fontKey` 与 `DEFAULT_INDENT`；PDF 走系统打印，`@media print` 在 `app.css` 末尾强制白底黑字。

**Q：能否做成 Windows 版？**
A：逻辑层（model/io/store）跨平台，只需替换 `package.sh` 的组装为目标平台的 `.exe` 清单，并适配 `electron/main.js` 的窗口/菜单（当前为中文 macOS 优化）。

---

## 18. 维护速查清单

- **日常改功能**：编辑 `src/` → 跑 `npm run typecheck` → 用 `ZS_DEV=1 npx electron .` 看效果。
- **出可安装包**：`bash package.sh` → 得到 `release/Mochang.app` + `.zip`。
- **M1 启动被拦**：`bash 修复并启动.sh`。
- **加元素类型**：`types.ts` → `elements.ts` → `flow.ts` → `Editor/ScriptBlock`。
- **加导入导出**：`io/` → `useCommands.ts` → `main.js` 菜单。
- **换主题/背景**：`src/styles/app.css` 的 `:root` 令牌；背景图在 `src/assets/`。
- **加视图**：`store.ts` 的 `ViewMode` → 新组件 → `App.tsx` 路由 → `Toolbar`/菜单。

---

*文档维护者：开发团队。架构如有重大调整，请同步更新本文件 §7–§13。*
