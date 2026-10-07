# 光影写手源码接手摘要

更新时间：2026-10-07；当前源码版本号 `1.3.0-alpha.18.10`，另有未发布的自由板第2稿、进度栏外观和快捷输入候选改动。本轮不覆盖现用应用，未打包、安装或发布这些改动。具体测试、安装与发布状态以本次交付记录和 Git 状态为准，本文不是实机验收证明。

## 2026-10-07 恢复、落盘、派生与原生验收（当前本地候选）

本轮四项范围如下，版本号暂保持alpha.18.10。新增独立QA壳不是可分发安装包。源码37套、实际系统剪贴板/关闭、5组真实Electron及实际PDF分层结果见 [RELIABILITY_QA_20261007.md](RELIABILITY_QA_20261007.md)，真实macOS输入法/独立壳文件对话框等仍待验；尚未打包或发布新安装包。下方此前日志的验证数量/未运行状态只描述其当时轮次。

1. **自动恢复与关闭**：`src/app/autosaveStorage.ts`、`autosaveSubscription.ts`、`recoveryStatus.ts` 提供单份最新恢复点、约900ms trailing/30秒最长等待、读写/容量失败反馈和坏raw保留。自动恢复不等于磁盘保存，不清dirty、不增加撤销历史；保留坏载荷失败或槽冲突时不得覆盖原载荷。App关闭检查dirty、未确认工程草稿、保存进行中与恢复flush失败；原生主进程提示默认继续写作。
2. **工程落盘**：`electron/projectSave.js` 为 `.zhsp` 同目录独占临时写入、文件fsync、上一版 `.guangying-backup` 与rename，按规范化目标排队并检查目标/备份身份，失败只清本次临时文件。保存IPC等待真实结果；已有快照/epoch/in-flight规则继续有效。保留普通mode但不保留全部ACL/xattr，不承诺跨进程锁或任意文件系统断电保证；目标已替换后目录sync失败报告耐久性warning，不假报保存失败。
3. **派生复用**：`src/model/flow.ts` 共用不可变元素数组的索引/CONT'D投影；`src/model/smarttype.ts` 根据实际候选来源字段复用解析，改名、类型/顺序/删除/撤销、活动段排除与文档边界须正确更新。仅减少重复推导，不改 Tab、智能引号、候选接受、分页测量、字体等待、PDF或工程格式，缓存不持久化。
4. **独立原生验收载具**：固定QA manifest与白名单launcher、临时userData、合成稿；editing/input/pdf/search/image夹具在当前构建React挂载前seed，恢复检查同入口/partition且无二次seed。夹具destroy只是测试清理，不是关闭验收，也不绕过产品guard。系统剪贴板、真实中文输入法、菜单、真实PDF和长稿性能分别报告，不能把CDP/内存事件推广为系统层通过。

当前 `npm run test:core` 列出37套源码专项，新增 `autosave-recovery-test.cjs`、`project-save-test.cjs`、`project-save-ipc-test.cjs`、`writing-derivation-test.cjs`，runner与两条CI需同步维护。交付前运行typecheck/build/完整core，并另核对实际原生/PDF输出；本文记录范围与保护约定，不代替当次执行结果。工程最终rename失败时备份可能与当前工程同版本，不能宣传无限历史或失败后必保留更早版本。维护入口仍为 [MAINTENANCE.md](MAINTENANCE.md) 和 [CORE_FEATURES.md](CORE_FEATURES.md)。

## 2026-10-07 智能双引号修复（后续独立本地候选）

- 用户仅批准智能引号方向，不批准双列跨栏语义改造。运行代码限定新 `utils/smartQuotes.ts`、Editor 输入 metadata/组合快照接入和 ScriptBlock 传 native event；未改分页、PDF、保存格式、双列范围校验或现用安装包。
- 旧正则按 HTML offset 奇偶替换全文，会把 `"ABC"` 配错且误处理属性。新 helper 用 inert template 的文本节点投影，BR=1 / UTF-16 与编辑器一致；只在原文前后缀、data、光标/原选区全部匹配时改新增 ASCII 双引号。
- 已有未闭合开引号优先闭合，包括冒号/括号/破折号结尾；无 opener 时按明确开启上下文判断，不明确则保留。只做单层自动配向，不自动嵌套或补配对；已有直引号、弯引号、单引号、复制内容、尺寸/转义字面值不全文改写。
- IME 组合期只同步原文、不改 DOM；组合开始捕获 id/epoch/原 HTML/选区，结束时按最终 data、当前设置和 epoch 校验新增部分，转换与原输入共用事务。未知 metadata 不猜测；真实中文输入法仍需独立验收。
- `npm run test:quotes` / `smartquotes-test.cjs` 已纳入统一 33 套回归与两条 CI。自动与浏览器证据见 [SMART_QUOTES_QA_20261007.md](SMART_QUOTES_QA_20261007.md)，版本号未变，不代表已提交、推送、打包、安装或发布。

## 2026-10-07 编辑历史与维护梳理（当前本地候选）

- 当前统一维护入口为 [MAINTENANCE.md](MAINTENANCE.md)，验收事实为 [EDITING_QA_20261007.md](EDITING_QA_20261007.md)。下方历史段落保留，但不得把旧发布/验证状态当作本轮结论。版本号未变，现用应用未替换，未提交/推送/打包/发布。
- `runEditHistory` 统一键盘/工具栏/菜单/beforeinput，正文不再用原生DOM撤销；只对明确标记的UI草稿用native history。快照弱引用书签恢复Enter重做后的新段与光标，不写工程。筛选/搜索/外观草稿不得误撤销正文。
- 文字合并保持1500ms idle并加5000ms绝对组上限，120个独立事务上限不变。点击、导航、IME起止和格式操作切断合并；复制/空粘贴/无变化不消耗历史或抹掉redo。
- 内部剪贴板版本1仅type/html；多段保留类型与基础格式，单段保留目标类型，一次事务；非法payload回退纯文本，格式白名单无属性。范围修改清理SceneMeta.id及旧标题ID两种关联，保留素材本体。异常跨栏范围拒绝并提示，不放松安全校验。
- `documentEpoch` 防止同ID重载的旧保存/图片回调写错工程；保存快照有新输入则仍dirty，外部FDX/TXT/MD无zhsp文件绑定。打开未保存修改须确认，过期/并发结果不得替换新稿。另存为的文件关联也须更新自动保存，已有正文timer不得被路径变化推迟。
- 低风险优化限于场景/人物/计数派生、单一格式转换、文本转义及独立smoke壳；未重写分页、PDF、数据目录或幕管理。
- 新统一入口：typecheck、build、`npm run test:core`。新增 clipboard-format/UI、writing-range-integrity、file-commands、source-integrity、autosave-path、native-draft-history，两条CI同步。原生Electron/系统剪贴板/IME/实际PDF不得据此宣称通过。

## 2026-10-07 自由板第2稿（本地候选）

- 用户已选择紧凑单行标题、选中卡片附近颜色/关联工具、底部选择/连线/缩放方案。顶栏保留三分区，将四类新增和视图设置收进两个下拉菜单；没有删除创建、关联、改色或缩放能力。素材标题双击/F2/Enter 编辑，Enter/失焦提交、Esc 回滚，普通点击标题仍支持拖动与多选。
- `BoardView` 的连线模式显式由 L/底部入口开启，点两卡后退出；线/卡选区互斥，Delete 删除当前对象，整场正文仍需确认并可完整撤销。关系说明普通状态不显示输入框，编辑草稿不提前写历史，组合期间 Enter 不提交。编辑控件必须阻止画布鼠标事件；快捷键也须检查文本目标与组合状态。
- 新 `model/boardWorkspace.ts` 只定义板面位置投影与28单位网格磁吸。`Beat.boardX/boardY` 为可选字段，缺省显示回退原写作 `x/y`，仅实际自由板移动时写独立字段。`zhsp` 保留有限值；旧工程打开、保存和切板不主动补坐标。
- 新 `store.moveBoardCards` / `resizeBoardCard` / `setBoardCardColors` / `addBoardScene` 是板面独立原子事务；旧写作 `moveBeat`、旧 resize 入口及故事板移动不替换。拖动和尺寸预览只用本地 React 状态，鼠标释放一次提交；独立手势不依赖1500ms合并键。场景创建保留正文、默认未归幕，不切写作视图。
- 完成标题/备注用 `commitBoardCardTitle` / `commitBoardLinkNote` 独立提交，不与上一次正文或另一次确认合并；草稿仅在组件里。画布使用 `overflow:clip`，禁止焦点原生滚动使网格/pan错位；附近工具按实际画布宽高夹限。
- 删除场景时同时识别规范 `Beat.sceneId = SceneMeta.id` 和旧 heading ID，未选场景关联保持；本轮仅修正自由板共用整场删除 action，不扩大到其他正文删除流程。
- `board-polish.css` 全部仅 screen/board--polished 范围；默认尺寸仅显示，保存尺寸仍优先。网格显示默认开启、磁吸默认关闭，切换不排布旧卡；Alt 暂停磁吸，组拖动共用一个位移；空格/中键平移，空白拖动框选。
- 专项：`board-workspace-model-test.cjs`（真实 store/兼容/历史）和 `board-workspace-ui-test.cjs`（合成 jsdom 事件），同时保留 board-polish/scene-notes/render 语义覆盖，已接入两条 CI 与 `npm run test:board`。真实浏览器外观、鼠标与剩余边界见 `design-qa.md`；Node 测试不能表述为 Electron/PDF/原生输入法已验收。
- 旧 alpha.18.8 图标按钮和 alpha.18.6 “网格仅参考、不吸附”是历史记录，本轮经用户批准的新交互覆盖其界面入口；原删除确认、保存兼容、正文/PDF位置及撤销红线继续生效。不得通过回迁旧条目恢复常驻按钮或让自由板重新使用写作坐标。
- 验证：typecheck/build退出0，完整25条Node回归退出0（模型113、UI116、board-polish46）；浏览器已测连线/备注/删线、Shift三卡选择、群组拖动及一次撤销、缩放及撤销、磁吸、日夜和820px窗口。三轮比较与未验证边界见 `design-qa.md`。Electron/原生输入法/实际PDF未跑，不能宣布安装包已完成。


## 2026-10-07 快捷输入修复（本地候选）

- 参考 Final Draft 官方 SmartType 的词类/分字段匹配，中文场次分别处理内外景、地点、时段，人物括号扩展单独补齐。词库从本工程实时提取；只解析人物/场次/转场/镜头，按未变化元素引用缓存文本投影，不扫描动作/对白，不新增工程字段或独立历史词库。
- 不照搬 Final Draft 的 Tab 接受候选：用户已明确规定九类循环。空格/右箭头只完成当前字段，Enter 完成并进入既有下一元素，Esc 保焦；候选不匹配当前段落、类型、光标和文本时必须作废。只替换字段文本节点，保留前后文字与格式；既有 `replaceWritingRange` 让完成候选成为独立撤销事务。
- 空动作段逐字输入 INT./EXT./内景可识别，不能在首字 I/IN 时提前抢成“人物”。中文组合期仅同步输入，提交后识别；显式类型与已有正文不被猜测覆盖。候选在切类型、段中光标/选区、组合开始、失焦、滚动、窗口改变时作废；不能恢复旧的延迟 blur 清除跨段候选。
- `ScriptBlock` 的布局同步依赖同时包含文字、类型和场号：场号包装重建时先填回新 DOM 再恢复光标，否则 Tab 到场次标题时偏移会被空节点夹成0。不要只测试焦点 ID，还要检查每次切换后的内容和光标偏移。
- 新增 `smarttype-test.cjs` 与 `smarttype-ui-test.cjs`，两条CI均运行。纯函数与jsdom结果不能代替原生中文输入法、Electron或实际PDF验收。参考：[SmartType官方说明](https://kb.finaldraft.com/hc/en-us/articles/27750003388948-What-is-SmartType-and-how-do-I-use-it)、[官方键位说明](https://kb.finaldraft.com/hc/en-us/articles/27977488282644-What-keyboard-shortcuts-can-I-use-in-Final-Draft)。

## 2026-10-07 进度栏轻薄外观（本地候选）

- 本轮仅改 `styles/progress-bands.css` 的进度栏内部外观：8px 可见轨道由无鼠标事件的伪元素绘制，标尺仍保留30px点击盒、56px指针锚点、76px外栏及原两行网格；场景色带为16px，置于原18px网格行中。
- 保留九类Tab、打字机跳动、25/75%里程碑、目标留白比例、已写页跳转、精确场标题跳转、超目标提示及声音卡控件。目标输入略加宽以容纳四位数，保留原生步进功能；不改进度计算、事件、工程字段、正文排版或PDF。
- `progress-bands-test.cjs` 分别保护外部几何/点击盒与8px绘制规则，允许用户批准的内部色带变薄，不再将所有子元素高度一概视为外栏高度。验证结果以当前交付记录为准，未更新已安装应用或发布包。

## 2026-10-07 本轮验证记录

- `npm run build` 成功；当前核心基线除构建外的22条命令，以及 `studio-theme-test.cjs` / `appearance-test.cjs` 全部退出0，共24条。快捷输入纯函数84/84，编辑器交互254/254；未删减既有断言。
- 在独立 `127.0.0.1:5207` 浏览器预览中，仅用合成工程实测：连续11次Tab与11次Shift+Tab保留当前正文节点、文字和光标偏移；右箭头补人物、撤销回到原前缀、空格补地点后选择时段、Enter进入动作段均通过。
- 日间/夜间及窄窗口外观已看图，四位目标数仍完整显示。截图位于工作区外层 `captures/progress-ui-20261007/`，不是源码或生产资源；构建目录不保留QA种子HTML。
- 本轮未运行原生Electron，未使用真实中文输入法，也未重新生成实际PDF；组合输入与PDF只运行合成事件/mock回归。不能把这些结果表述为上述三项实机验收。未打包、安装、提交、推送或发布。

## alpha.18.10 编辑与查找边界

- `ScriptBlock.tsx` 不能以 activeElement 为理由忽略模型变化：这会使聚焦段落在 split/undo 后仍显示旧文本。使用布局同步，仅在 HTML 不一致时更新，恢复段内选区；正常输入不重写。
- `dom.offsetOf` 使用 Range 前缀与文本/BR 长度，避免嵌套格式边界算错。`writingSelection.ts` 读取真实正文范围，`replaceWritingRange` 将剪切/粘贴/选区回车记成一笔历史；不与打字合并。
- 查找入口：顶栏“查找”或 ⌘/Ctrl+F；只读模型、CSS Highlight、高亮不入 HTML。`FindPanel.tsx` 浮在编辑器外，不能移动原正文/图片几何；关闭后卸载全文匹配订阅。纯查找不加入替换功能。
- `editing-test.cjs` 检查聚焦 DOM 与 store 同步；`editing-electron.cjs` 检查真实 Chromium 按键、菜单撤销及 CDP 组合输入，剪贴板事件使用合成 DataTransfer，不读写系统剪贴板，不等于跨应用剪贴板已实测。
- 用隔离 QA 壳和临时 userData，不读取或修改用户当前剧本。未改变 `.zhsp` 格式、PDF 路径、卡片坐标或归幕行为。

## alpha.18.9 PDF 修复边界

- `PaginationProvider.tsx` 的跟随约束到完整终结段停止，禁止将一行对白后的下一人物继续绑定造成整串挪页；不改变用户行距、字号或正文。
- `electron/pdf.js` 禁止把整份图文 HTML 拼入 `data:` 页面 URL；采用独立内存会话短地址，禁止外网请求，结束后注销处理器；错误不回显 HTML 或内嵌图片。
- `pdf-transport-test.cjs` 覆盖大负载与资源清理；`pdf-layout-electron.cjs` 使用随机合成 PNG 生成大图 PDF，并保留原位图文、长单列/双列及短对白验收。
- 不操作用户现用剧本、自动保存或运行实例。测试包为 alpha.18.9，需用户保存并退出旧版后再切换；公开发布状态以 GitHub Releases 为准。

## alpha.18.8 自由板外观边界（历史记录，入口已由第2稿替代）

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
- 当前源码版本号为 `1.3.0-alpha.18.10`，2026-10-07候选尚未另定发布版本；完成全部回归后才能考虑正式 `1.3.0`。
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
