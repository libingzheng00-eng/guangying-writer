# 光影写手源码接手摘要

更新时间：2026-09-10；维护目标 `1.3.0-alpha.18.8`。本轮仅精简自由板卡片外观，不覆盖现用应用。具体测试、安装与发布状态以本次交付记录和 Git 状态为准，本文不是实机验收证明。

## alpha.18.8 自由板外观边界

- 只改 `BoardView.tsx` 的卡片内部排列和视觉标签，以及 `board-polish.css` 屏幕范围；事件处理、store、保存、正文和 PDF 均不变。
- 删除整场现在是垃圾桶图标，必须保留明确 aria-label/title、原生确认及完整撤销。不能因取消文字就丢失危险操作说明。
- 场号与标题同排；图片标签、缩放文字不再显示，但图片、关联、18px手柄与全卡缩放必须保留。不能用 display:none 隐藏整个缩放入口。
- 场景色以日夜不同浓度覆盖整卡，不能重新被白底遮盖；仅为渲染，不写回工程颜色、尺寸或坐标。
- `board-polish-test.cjs` 已按用户批准的图标方案更新语义断言，原连接、筛选、删除确认、撤销断言继续保留。

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

- alpha.18.7 输入热路径：`store.setText` 只复制当前段落与元素列表，`projectChange` 共用旧撤销/合并规则；通用 `mutate` 仍深拷贝防止污染共享快照。`app/autosaveSubscription.ts` 直接订阅版本变化，不让 App 为保存计时器每字重渲染；仍用 900ms 与最新状态。未改 Editor/Tab/分页算法/PDF/统计口径/主题/卡片交互。不要为了优化而延后保存或使用过期分页导出。
- `input-performance-test.cjs` 已接入两条 CI；`--compare-ref a0dc5c3` 可本地只读比较旧 store。计时只代表数据更新，不代表完整输入延迟。`input-electron.cjs` 在独立临时 userData 中检查 300 段连续输入、CDP 中文组合输入与自动保存恢复，不能替代用户实际输入法及长时间写作验收。
- alpha.18.6 本轮变更隔离：幕归属与正文移动仅在 `model/storyboard.ts` / `moveScenesToAct`；既有大纲排序仍用原入口。统计只读投影不替换公共统计或分页；自由板过滤同时限定连线和选择；进度样式/顶栏样式只限屏幕，保留76px进度栏与52px顶栏几何。
- 新增回归：`reports-test`、`storyboard-acts-test`、`storyboard-drop-test`、`board-polish-test`、`writing-controls-test`、`progress-bands-test` 已接入两条 CI。统计重命名、归幕/删除撤销、筛选后隐藏卡片保护都要一起跑，不能只跑自己改的界面。
- 本机英式数字引用 `Snell Roundhand` / `Apple Chancery`，不将系统字体拷贝到仓库或DMG；不同平台没有这些字体时使用书写体回退，不宣称跨平台外观完全相同。
- 运行已打包 app 时，命令行追加测试脚本不保证替换产品入口。验收应使用独立包ID和临时userData的测试壳，明确加载候选 `dist-renderer`；测试壳不分发，不替换已安装应用，不改系统安全设置。

- 以最新 [CORE_FEATURES.md](CORE_FEATURES.md) 为验收清单；[MIGRATION.md](MIGRATION.md) 用于追溯历史，不要重新实现已被用户取消的三主题进度或素材附页。
- 当前真实 PNG 打字机指针位于 `src/assets/typewriter-pointer.png`，由 `ProgressBar.tsx` 使用；不要重新放回 `StatusBar.tsx`。
- 当前维护目标为 `1.3.0-alpha.18.8`；完成全部回归后才能考虑正式 `1.3.0`。
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
node scripts/input-performance-test.cjs
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

### 统计面板专项（未发布，未替换安装应用）

- 用户强调只改统计面板：运行时代码改动严格限定为 `components/ReportsView.tsx`、`model/reports.ts`、`styles/reports.css`；不改共用 stats、store、其他界面、工程字段、分页和导出逻辑。
- 同一只读报告投影提供总量/幕/场景/人物/CSV。省略场景和省略段落、备忘不计；总词字数含标题/人物名，中文单字、英文单词、排除标点。篇幅百分比分母为全文词字数，场前文字单列，不伪装成页数或时长。
- 人物统计归一括号变体，改名依然调用旧精确匹配动作，各实际名称分别提供输入；不改任何其他元素。不根据动作正文猜测人物在场。地点只解析明确场次前缀和时段；未识别单列。
- `reports-test.cjs` 用合成工程核对只读保护、过滤/分母、页数去重、CSV、人物改名与撤销。统计页样式必须保持 `.reports--analysis` 作用域，不可污染其他界面。
- 本轮已跑类型、构建、既有完整基线及统计专项；独立 `5193` 合成页面实测日夜布局、场景翻页、人物筛选、精确改名同步正文12处及撤销、矩阵点击定位第五场标题（实际焦点 s5）、空场/备忘筛选。未访问真实用户工程，未修改其他运行界面代码；未替换安装 app、重新打包或上传 GitHub，不把浏览器验收等同 Electron/PDF 复验。

### 幕分组新方案（alpha.18.5，本地候选）

- 用户明确批准的新语义覆盖 alpha.18.4：未归幕仅解除归属且保持正文位置，不能再把场景移动到剧本末尾。正式幕接受拖入/批量移至，整场跟随、前后落点按稳定 ID 处理；多选保持原正文相对顺序。
- 新 `model/storyboard.ts` 为唯一幕移动核心，`store.moveScenesToAct` 一次 mutate 保证单次撤销；旧 `dropSceneInAct` 保留兼容包装。其他大纲/导航排序入口不改变。
- `CardsView.tsx` 提供未归幕置顶、折叠、实际排版涉及页数、单/多选移至、删幕确认与插入线；独立 `styles/storyboard.css` 仅 screen 的 `.cards` 范围。删除全部幕后的 `acts: []` 必须保存保留，缺失字段才补默认。
- `storyboard-acts-test.cjs` 与 `storyboard-drop-test.cjs` 覆盖模型、真实 store、React 事件和保存兼容，已纳入 CI。核心红线以 CORE_FEATURES 最新规则为准；旧条目中未归幕重排的语义已废止。
- 验证记录：完整基线与两项故事板专项通过；独立 `5192` 合成页面实测拖回未归幕保持场号、Shift多选菜单移幕、两卡拖入折叠幕自动展开、折叠、删除幕保留三场、撤销恢复幕与归属、日夜最终界面。本轮未操作用户工程，未覆盖桌面应用；未重新声称 Electron/PDF 专项验收。

### 故事板未归幕专项修复（alpha.18.4，本地待发布）

- `CardsView.tsx` 拖动期间保持空梗概源节点，场景卡使用稳定正文 ID 作为 key；所有落点阻止重复冒泡。
- `store.dropSceneInAct` 明确清除未归幕的 `actId`，按拖动前插入边界和稳定 ID 移动整场，修复向后落到目标卡片后方的偏移；不改其他排序入口。一个动作只产生一次撤销记录。
- `scripts/storyboard-drop-test.cjs` 用合成工程覆盖空梗概节点保持、归幕往返、不同落点、排序、取消、保存和撤销；已加入核心与发布 CI。真实鼠标验收须单独记录，不能把 React 事件测试当作实机结果。
- 本轮既有完整自动基线及新增专项通过；独立 `5192` 合成浏览器页面实测了拖入空未归幕区、未归幕标题落点、重新归幕及撤销/重做。未操作用户剧本或替换桌面旧应用；不宣称已复现用户现用应用的全部失败条件。

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
