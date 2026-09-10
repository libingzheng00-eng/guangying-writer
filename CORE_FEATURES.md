# 光影写手：核心功能与维护红线

这份清单用于每次更新前的回归核对。以下能力不是可随意精简的 UI，而是用户创作流程与工程兼容性的组成部分。

## 一、工程与隐私

- `.zhsp` 必须向后兼容；新增字段必须可选，旧工程打开、保存、重开后不能丢失已知内容。
- 首次启动模板保持空白；仓库、测试、发布包不得含用户剧本、自动保存、导出稿或真实人物资料。
- 保存、另存为、打开、导入文本/FDX，导出 PDF/FDX/文本/Markdown/HTML 都必须可用。
- 自动保存和重启恢复必须保留正文、卡片和文件关联；手动保存继续写入兼容 `.zhsp`。当前 `guangying:autosave` 兼容同一数据目录中的旧 `mojiang:autosave`；这不等于跨应用数据目录已自动迁移。更改应用名称/标识/数据目录前必须单独设计迁移并验证，不得使旧草稿“消失”。

## 二、写作是第一优先级

- 九类元素的 `Tab` / `Shift+Tab` 循环必须闭环：只改当前段落类型，永远不跳到文件名、缩放或其他界面控件，也不自动新建段落。
- 固定正向顺序为：动作 → 人物 → 括号提示 → 对白 → 转场 → 镜头 → 场次标题 → 常规文本 → 备忘 → 动作；Shift+Tab 反向。`⌘/Ctrl+Shift+N` 在备忘与该段上次非备忘类型间往返，不能篡改正文。
- 回车节奏：场次标题后为动作；动作后仍为动作；人物后为对白；对白后为人物。
- 智能识别、自动补全、双列对白、场号、同一人物再次说话的 `(CONT'D)` 视觉提示保持正常。
- 写作多选模式下：普通点击可选择段落；Shift 点击正文或复选框可按正文顺序连续选择；删除只删除选中段落；普通写作模式绝不能被这套逻辑干扰。
- `⌘/Ctrl+Z` 撤销与 `⌘/Ctrl+Shift+Z` 重做须支持多步恢复正文、卡片、关系线；输入及同一卡片连续移动/缩放可按既有规则合并，不得跨不相关操作误合并，批量删除必须一次完整撤回。
- 输入性能：`setText` 仅不可变更新当前段落与元素列表，不能按每个字 JSON 复制/比较整个含图工程；未改对象可共享引用，但严禁直接修改当前工程或撤销快照。它与通用 `mutate` 必须共用同一历史提交规则。无变化/无效 ID 保留 redo、dirty、version 并切断合并窗口。自动保存保持约 900ms 停笔后保存最新正文/路径，订阅不能导致 App 整树随字重渲染。专项：`input-performance-test.cjs`；实际组合输入与重载恢复：`input-electron.cjs`。

## 三、创作素材与 PDF 导出

- 自由板提供灵感卡、声音卡、图片卡；图片只有一套 `image` 卡，不再新增重复的“写作图”类型。**写作面板必须继续支持把本地照片直接拖入，生成这同一套 `image` 卡；删除重复按钮不等于删除拖入入口。**
- 旧工程的 `wimg` 必须读取为 `image`，并保留图片、标题、备注、位置、尺寸。
- 图片拖入必须接管正文上的文件 drop，不能将图片插入正文元素；关闭声音卡不能隐藏图片。读取失败不创建空卡，读取成功后一次撤销能完整移除新卡；滚动后落点与画布右边缘必须实测。专项脚本：`scripts/image-drop-electron.cjs`（独立临时用户目录，真实 Electron 文件拖放测试）。
- **PDF 红线（用户明确纠正）**：创作版必须所见即所得，按写作画布的实际位置保留正文、图片、声音卡；第五场旁边的参考图仍在第五场旁边。禁止统一移动到文末、生成独立素材附页或另行配对。创作版采用数字画布尺寸，不强制 A4；超长画布切页不可切断卡片或重排其与正文的位置关系。
- **纯文本打印版**独立按 A4 分页，保留剧本格式且不包含素材卡。导出不得改变工程纸型、卡片坐标、正文内容或撤销栈。
- 两种导出均等字体与排版就绪；创作版还须等图片解码。缺少 MIME 但可解码的图片也必须保留；损坏图片至少保留原位卡片标题和备注，不得静默丢卡。专项脚本：`scripts/pdf-layout-electron.cjs`，需实际输出 PDF 后检查第五场图文位置和 A4 纸型。

## 四、故事板与自由板

- 大纲拖动场号把手到目标卡片的上/下半部，必须按稳定场景 ID 移动整场（含正文），一次操作可完整撤销。原位、取消、外部拖入不得新增历史；标题/摘要编辑不能触发跳转或拖动。双击场号定位正文，Alt+↑/↓ 可相邻移动。
- 自由板场景卡上方显示标题，下方直接编辑 `SceneMeta.synopsis`，与大纲、故事板共用一份故事信息。空摘要显示提示语，不重复标题；文本输入、选择、双击和滚动不能误拖卡、跳正文、缩放画布或删除场景。不得因此改变正文、坐标、尺寸或关系线。
- 故事板卡片支持排序、修改标题/梗概/颜色，并能稳定拖入某一幕归幕；一次拖拽只产生一次状态变更与一次撤销记录。
- **故事板归幕红线（用户批准的新方案）**：未归幕置顶；移回未归幕只清除旧 `actId`，无论从菜单还是拖放，都必须保留正文位置。移入正式幕才移动整场正文：卡片左/右半部落点对应前/后插入线，组内空白放在幕末。多选移动保持源场景的正文相对顺序，并一次完整撤销。标题区、折叠幕、空白网格、空组提示区、已有卡片均可接收；拖动期间不得卸载源节点，取消/原位不制造历史。不得删除 `storyboard-drop` / `storyboard-acts` 断言绕过回归。
- 幕可折叠、自由命名，显示场数和当前排版涉及页数（同组同页去重，跨幕共页各计一次，标题页不计）。提供复选框、Shift 可见卡片范围选、⌘/Ctrl 增减选，以及单卡/多卡“移至”菜单。选择不影响正文编辑或自由板选择。
- 删除幕需明确说明保留场景，将所属场景解除归幕；不删正文、素材、关系线，不移动正文位置，单次撤销可恢复幕与归属。允许删除全部幕，显式 `acts: []` 保存重开后保持零幕；仅缺失字段的旧工程补默认幕。新场景默认未归幕。
- 自由板支持场景卡、卡片连接线、可编辑关系备注、卡片缩放与尺寸持久化。
- 自由板支持 ⌘/Ctrl 多选、Shift 范围选、框选、批量删除；删除需同时清理孤儿关系线，但不能误删未选卡片的关系。
- 场景卡的“删除整场”必须存在，并在可撤销的单次操作中处理正文、场景元数据、关系线与关联卡的解除关联。
- 自由板筛选后，连线须两端均可见；Shift 选区、批量改色与删除只影响当前可见卡片。删除涉及整场正文必须先确认，取消不能改选区或撤销栈。网格仅为可关闭的屏幕参考，不吸附、不写回卡片坐标；已保存卡片尺寸不可被新默认值覆盖。专项：`board-polish-test.cjs`。

## 五、结构、统计与界面

- 目标页数、单一打字机指针进度、按场景篇幅的色带与精确跳转保持可用。
- 场景色带未完成目标时必须按实际占目标比例留白，禁止 flex-grow、最小宽度或内边距把短场景撑满；超目标才按当前篇幅归一，提示仍保留目标比例。`progress-bands-test.cjs` 同时保护纯计算及样式契约。
- 写作工具栏在多选时原位替换格式工具，退出即恢复；全选、删除、撤销、完成入口保持可用，不能因按钮挤压折字或更改工具栏高度而影响正文/素材/PDF坐标。窄屏导航可改为等价选择器，但不能删除视图入口。专项：`writing-controls-test.cjs`。
- 统计页角色改名必须同步正文人物元素。
- 统计分析仅使用 `model/reports.ts` 的只读投影与 `styles/reports.css` 的统计页限定样式，不得替换编辑器、底栏、分页或导出共用计算。总量、幕/场景、人物及 CSV 排除省略场景、省略段落与备忘；词字数不是电影时长。正文涉及页数按当前排版有效元素所在页去重，各场涉及页数不能相加。人物只代表人物元素，括号版本合并统计但保留原有精确名称改名入口；拒绝空名/重名时输入须恢复，撤销仍可恢复正文。地点不明时标为未识别。专项：`node scripts/reports-test.cjs`。
- 深色/日间模式都须保证菜单、输入、文字、按钮有足够对比；日间模式不得遗留深色文件菜单。
- 左侧导航可收起且可恢复，不应遮挡正文或工具栏。

## 六、每次提交前至少验证

```bash
npm run typecheck
npm run build
node scripts/core-guard.cjs
node scripts/render-test.cjs
node scripts/writing-test.cjs
node scripts/zhsp-compat-test.cjs
node scripts/history-test.cjs
node scripts/input-performance-test.cjs
node scripts/pagination-safety-test.cjs
node scripts/outline-reorder-test.cjs
node scripts/scene-notes-test.cjs
node scripts/storyboard-drop-test.cjs
node scripts/storyboard-acts-test.cjs
node scripts/reports-test.cjs
node scripts/board-polish-test.cjs
node scripts/writing-controls-test.cjs
node scripts/progress-bands-test.cjs
```

涉及写作交互、导出、拖拽或主题时，还要在真实浏览器或 Electron 中做一次人工验证；自动测试通过不等于视觉与鼠标手势已经验收。

## 七、保护入口与变更要求

| 行为契约 | 关键实现位置 | 回归入口 |
| --- | --- | --- |
| Tab 焦点闭环、备忘往返、正文 Shift 多选 | `src/model/flow.ts`、`Editor.tsx`、`ScriptBlock.tsx` | writing / render / 实机连续 Tab |
| 拖入图片、原位卡片创作 PDF、A4 纯文本 | `Editor.tsx`、`src/io/creativePdf.ts`、`useCommands.ts`、`PreviewView.tsx`、`PaginationProvider.tsx`、`electron/pdf.js` | image-drop-electron / pdf-layout-electron / pagination-safety / PDF 渲染检查 |
| 选择、归幕、删除、撤销重做 | `store.ts`、`selection.ts`、`board.ts`、`BoardView.tsx`、`CardsView.tsx` | history / writing / render / 实机拖放 |
| 大纲整场拖动、场景故事信息同步编辑 | `outline.ts`、`Sidebar.tsx`、`BoardView.tsx`、`CardsView.tsx` | outline-reorder / scene-notes / 实机拖放与输入 |
| 工程兼容、空白启动、保存恢复 | `src/io/zhsp.ts`、`src/model/sample.ts`、`src/App.tsx`、`electron/main.js` | zhsp-compat / core-guard / 隔离用户目录启动保存重开 |
| 场景进度与跳转、角色改名同步 | `ProgressBar.tsx`、`progress.ts`、`ReportsView.tsx`、`store.ts` | writing / render / history / 实机跳转 |

表中未写完整路径的组件位于 `src/components/`，模型位于 `src/model/`，`store.ts` 位于 `src/store/`，`useCommands.ts` 位于 `src/app/`。测试入口名称对应 `scripts/` 中同名 `*-test.cjs` 或 `*-electron.cjs` 文件。

这些代码不是只读文件，也不做哈希“锁死”：修复错误必须可以改。任何改变上述行为的设计决定，须先征得用户明确认可；维护者不得靠删断言或关 CI 来掩盖回归。`AGENTS.md` 给 AI 明确约束，`core-checks` CI 自动运行基线；必须由管理员另外设为受保护分支的必需检查，才能强制阻止未通过检查的合并。

`core-guard` 检查 Git 跟踪路径中的工程/导出/自动保存/大文件风险，并实测空白模板和 Tab 类型契约。可对明确的 `Contents/Resources/app` 打包目录附加检查；不会读取个人目录，也不会扫描旧 Git 历史。它不能识别任意字符串是否为用户剧情，不能代替人工源码/产物隐私审查。测试源码允许合成场景、角色与图像；用户真实剧本任何部分都不能当测试夹具。
