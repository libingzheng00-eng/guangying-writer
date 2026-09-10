# 光影写手源码接手摘要

更新时间：2026-09-09；维护目标 `1.3.0-alpha.18.2`。具体测试、安装与发布状态以本次交付记录和 Git 状态为准，本文不是实机验收证明。

## 版本边界

- 本仓库是“光影写手” `v1.3.0-alpha` 源码，公开仓库为 `libingzheng00-eng/guangying-writer`。不宣称全部平台或跨机器已验证。
- 用户已经淘汰旧 v1.2.9，不要再假定它是现用版本。现用 app 必须实时确认，未经用户同意不得覆盖运行中的应用或改动剧本。
- 旧品牌名称涉及文件兼容、旧存储键的部分须保留；迁移记录仅作历史参考，不得覆盖用户最近明确的设计。

## 已回迁的源码能力

- 统计区块标题层级。
- 统计页角色改名并同步正文人物元素。
- 自由板关系线、可编辑备注和删除。
- 目标页数输入与按目标比例计算的单一打字机式进度条。
- 自由板三分区、统一选择 ID、多选 / 框选 / 场景与卡片批量删除、全卡片缩放与撤销安全。
- Tab 九类元素循环、自动识别、同人物 `(CONT'D)` 视觉标记。
- 日间模式顶栏、设置、统计、自由板与侧栏收起布局。
- 写作 Shift 范围多选、删除整场、故事板归幕；本地图片直接拖入写作画布，与自由板共用 `image` 卡。
- 创作版 PDF 原位保留图文，A4 纯文本独立出口；完整行为契约见 [CORE_FEATURES.md](CORE_FEATURES.md)，维护者/AI 规则见 [AGENTS.md](AGENTS.md)。

## 发布前继续核对

- 以最新 [CORE_FEATURES.md](CORE_FEATURES.md) 为验收清单；[MIGRATION.md](MIGRATION.md) 用于追溯历史，不要重新实现已被用户取消的三主题进度或素材附页。
- 当前真实 PNG 打字机指针位于 `src/assets/typewriter-pointer.png`，由 `ProgressBar.tsx` 使用；不要重新放回 `StatusBar.tsx`。
- 当前维护目标为 `1.3.0-alpha.18.2`；完成全部回归后才能考虑正式 `1.3.0`。
- 新建候选安装包，保留用户当前应用与资料。打包脚本拒绝覆盖已有产物，可显式选择已验证的 `RUNTIME_APP`；这不代表签名/公证或跨机安装已完成。

## 隐私红线

- `src/model/sample.ts` 现在只创建空白“未命名剧本”。
- 不用用户打开的真实剧本做测试；不修改、不上传、不复制进测试样本。所有脚本只能使用明确合成数据和独立临时 userData；合成角色、场景、图像可以保留在测试源码中。
- 禁止提交或打包任何 `.zhsp`、真实人物名、剧情正文、自由板梗概、导出 PDF 或用户自动保存目录。
- 注意：旧 Git 提交可能仍含已删除的旧示例正文。普通提交不会清除历史；如需彻底移除，必须取得用户对历史重写和 force-push 的明确授权。
- 不扫描个人资料目录来找素材。生产应用资源只取 `package.json`、`LICENSE`、`electron/`、`dist-renderer/`；DMG/ZIP/.app 放 Releases，不提交 Git 源码。

## 当前验证

以下命令是当前回归基线：

```bash
node scripts/core-guard.cjs
npm run typecheck
npm run build
node scripts/render-test.cjs
node scripts/writing-test.cjs
node scripts/zhsp-compat-test.cjs
node scripts/history-test.cjs
node scripts/pagination-safety-test.cjs
```

`npm run test:render` 在本机沙箱偶尔会被 SIGTERM 137 终止，使用上面的 `node scripts/render-test.cjs` 直调。所有测试只用合成数据。

`core-checks` CI 同步执行基线。只有管理员另外把它配置为受保护分支的必需状态检查，才能强制阻止失败合并；新增 CI 不等于已配置远端规则。允许修复核心代码，不做阻碍合法修复的哈希锁；改变核心行为需明确用户认可、测试与文档。不得通过删测试“变绿”。

真实专项入口：`scripts/image-drop-electron.cjs`、`scripts/pdf-layout-electron.cjs`，只用独立测试环境。必须检查实际 PDF（原位图文、长对白、标题/段尾、A4 纸型）；不能把 jsdom 或 CSS 推演图当真实 PDF 验收。

候选打包后：`node scripts/core-guard.cjs --package /明确的候选应用路径/Contents/Resources/app`。该检查不访问个人目录，不扫描旧 Git 历史，也不能识别任意文本是否私密；它不替代整个 DMG 隐私核对、空白首次启动、签名与跨机验证。

## 当前写作辅助约定

- 场次标题回车后必须进入「动作」（画面/环境描述）；动作连续回车保持动作；人物回车进对白；对白回车进人物。
- **写作红线——Tab 焦点闭环**：`Tab` / `Shift+Tab` 只在当前行循环九类元素，永远不自动新建行，也绝不能跳到缩放、文件名或其他界面按钮。`scene_heading` 会改变场号包装结构，类型切换后必须通过 `requestFocus` 恢复同一 `contentEditable` 及原光标位置。任何涉及 `Editor.tsx`、`ScriptBlock.tsx` 或场号 DOM 的修改，都必须实测连续按 9 次 Tab 后回到起始类型且焦点仍在原段落。
- 固定顺序：动作 → 人物 → 括号提示 → 对白 → 转场 → 镜头 → 场次标题 → 常规文本 → 备忘。`⌘/Ctrl+Shift+N` 往返备忘与原类型。实测还应继续按第 10/11 次并反向循环，不能只查纯函数。
- 快捷输入候选靠近当前输入行右侧：`Enter` 确认后进入符合上述规则的下一元素；空格或鼠标只确认当前行。Tab 专用于元素类型循环，不得被自动补全截获。contentEditable 聚焦时必须同时更新 DOM 与 store，否则鼠标点击会“看似无反应”。
- `Editor.tsx` 在输入时仅派发 `guangying:typing` 事件；`ProgressBar.tsx` 自己在指针 DOM 上短暂加 `.is-typing`（260ms）。严禁把动效状态保存进 `.zhsp` 或 undo 历史，也不要把它改回 Editor 的 React state，以免每次输入重绘整个编辑器。
- **PDF 红线——原位图文，不是附页**：创作版通过 `Editor.tsx` → `src/io/creativePdf.ts` 冻结实际写作布局 → `useCommands.ts` → `electron/pdf.js` 导出。第五场旁边的图仍在第五场旁边，不能统一放文末或另行配对；不强制 A4。超长画布只允许不切断图文/卡片关系的安全切页。
- **A4 纯文本**：`PreviewView.tsx` / `PaginationProvider.tsx` 独立输出 A4 剧本格式，不含素材，不能因裁剪漏标题或段尾。两种出口都不改变工程纸型、坐标、正文或撤销栈；均等排版字体就绪，创作版另等图片解码，包括缺少 MIME 的有效图片。坏图至少保留原位标题和备注。
- **旧 alpha.18 文档“MaterialPage 素材附页必须保留”的要求已被用户明确否定，不得恢复。**
- **写作 Shift 多选**：仅在写作多选模式下，Shift 点击正文段落或复选框会按正文顺序扩展连续选区；普通编辑模式不得拦截鼠标、光标或键盘输入。
- **保存和撤销**：`⌘/Ctrl+Z`、`⌘/Ctrl+Shift+Z` 多步恢复正文/卡片/关系线；不能跨无关操作合并撤销。`src/App.tsx` 使用 `guangying:autosave` 并兼容同 userData 的 `mojiang:autosave`；这不自动解决跨应用目录迁移，不得随意改 productName、bundle id、数据路径或存储键。

## 开始工作的推荐顺序

### 2026-09-10 外观候选（未打包、未发布）

- `src/styles/studio.css` 是集中式屏幕外观层，由 `src/main.tsx` 在旧样式之后载入。日间暖灰、夜间石墨、鼠尾草绿强调色；移除装饰斜纹和发光。`App.tsx` 仅同步背景色，`model/progress.ts` 仅更换十色调色板。
- 不改正文的字体/行高/宽度、稿纸尺寸、素材坐标、标尺高度、键盘逻辑、存储字段或 PDF 导出流程。侧栏把手只恢复较高显示层级，避免被旧 `.sidebar > *` 规则压住；不改点击范围和位置。
- 新增 `node scripts/studio-theme-test.cjs`：检查 screen 隔离、受保护几何声明和静态色值对比。此测试**不证明**真实浏览器级联、拖拽或 PDF 呈现，不能替代既有基线和专项实机验证。
- 用户追加默认正文要求：`model/appearance.ts` 的 `auto` 偏好按日间纯黑 / 夜间纯白解析；设置中“随主题（默认）”和“恢复默认”使用该模式。旧 HEX 自定义颜色保留，不自动改写；不会进入 `.zhsp`、自动保存的 project 或撤销栈。`node scripts/appearance-test.cjs` 专项验证此契约。只在 `.editor` 应用正文颜色，A4 预览保持独立黑字。
- 本轮独立浏览器预览只用合成内容；检查了日夜主题、菜单、Tab/Shift+Tab 焦点闭环、Shift 多选/删除/撤销、场景条跳转和侧栏折叠。既有八项自动基线通过。没有更新用户已安装应用、DMG 或 GitHub；没有用真实剧本做测试。重新打包前仍须复验 Electron 图文 PDF 和拖放专项。

### 2026-09-10 大纲拖动与场景故事信息（同一未发布候选）

- `Sidebar.tsx` 的大纲原来没有拖放处理。现在拖场号把手到目标卡片上/下半部即可放在其前/后，双击场号定位正文，Alt+↑/↓ 相邻移动；标题和摘要仍可直接编辑。`model/outline.ts` 按稳定场景 ID 重新定位，整场正文一起移动，原位/取消不写历史，一次拖动可一次撤销。
- `BoardView.tsx` 的场景卡不再把空摘要回退成重复标题。下方直接编辑既有 `SceneMeta.synopsis`，与大纲和故事板双向同步；没有新增工程字段，不改场景正文、外卡默认尺寸或关系线。编辑框拦住鼠标拖动、双击和滚轮的冒泡，Delete/Backspace 继续由文本框处理。
- `app.css` 保留场景卡 96px 默认高度，使用 `overflow: clip` 防止摘要聚焦引起整卡内部滚动，遮住场号和操作按钮；长信息只在 textarea 内滚动，拉大卡片后显示更多内容。`CardsView.tsx` 仅补分组 section 的稳定 key，消除本轮联动测试暴露的旧 React 告警。
- 验证：既有八项基线、外观/默认字体两项专项、大纲 17 组和场景信息 50 条均通过。独立 `5190` 浏览器只使用合成数据，实际拖动验证了首尾双向排序、撤销/重做、信息编辑与大纲同步、卡片拖动/缩放、日夜显示；长文本滚轮实测卡片 scrollTop=0、编辑框单独滚动、画布仍 scale(1)。这不等于 Electron / PDF 已重新验收。
- 未改用户已安装应用、DMG、真实工程或用户 `5189` 预览数据；未提交、推送或发布。
- 额外待审：旧 `store.moveSceneTo` / `moveSceneBlock` 在删除源场景后仍沿用旧目标下标，向后移动可能偏一场。大纲此次使用独立 ID helper 不经过该入口；其他排序入口本次未改，后续须用合成三场以上工程复核，不能宣称所有排序路径已修复。

### 工作流程

1. 阅读核心契约、`AGENTS.md`、`README.md`、当前 `CHANGELOG.md`，历史迁移文档仅作追溯。
2. 查看 `git status`，保留用户和前任留下的未提交改动。
3. 核对现用版本与合成测试环境，不把用户窗口当测试夹具。
4. 小步回迁，每项都做类型检查、构建、渲染测试和最终画面检查。
5. 发布前扫描剧本文本和工程文件，并验证全新用户目录首次启动为空白稿。
6. 遇到 `Operation not permitted` / `sandbox initialization failed` / git 提交失败等本环境特有报错，先看 [ENVIRONMENT_PITFALLS.md](ENVIRONMENT_PITFALLS.md)。
