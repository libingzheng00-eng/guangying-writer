# 更新记录

## v1.3.0-alpha.18.3

- 自由板场景卡上方只显示场景标题，下方改为可编辑的故事信息；空信息不再重复场景标题，并与大纲、故事板同步。文本输入、双击、滚动及 Delete/Backspace 不会误拖卡、跳回写作、缩放画布或删除场景。
- 大纲支持拖住场号排序：放到目标卡片上/下半部即可将整场正文移动到前/后，支持撤销与重做；双击场号定位正文，Alt+↑/↓ 相邻移动。标题和故事信息继续可编辑。
- 场景卡长信息只在文本框内滚动，场号与操作按钮不再被卡片内部滚动遮挡；补齐故事板分组的稳定 React key。
- 更新日夜外观、默认正文颜色与场景色带的回归检查；新增大纲排序和场景信息专项测试，并纳入 GitHub 自动检查。

## v1.3.0-alpha.18.2

- PDF 分为「创作版（原位卡片）」与「A4 纯文本」：创作版冻结写作画布中的正文、图片和声音卡坐标，第五场旁的参考图仍在第五场旁，废除文末素材附页；A4 版独立分页且不含卡片。
- 修正打印预览把段前留白算进行数裁剪窗导致场次标题、段尾内容被裁掉的问题；导出等待当前纸型分页、字体和图片解码就绪，不修改工程纸型和素材位置。
- 统一长对白、长动作与双列对白的分页裁剪，续页不再重复完整双列；修复 MORE/CONT'D 行高预算、超长段落截断及场次标题孤悬。真实 PDF 分别核对 250 行单列与 170 行双列标记完整且不重复。
- 新增独立临时用户目录的真实 PDF 回归，核对图文坐标、A4 尺寸与导出后原布局；仅使用合成剧本。
- 核心行为维护红线与 CI 回归检查纳入仓库；打包仅拷贝运行代码，拒绝覆盖旧产物，不包含剧本或自动保存数据。

## v1.3.0-alpha.18.1（本地修复，待发布）

- 修复写作图片被声音隐藏开关一起隐藏，以及右边缘拖入后图片卡超出画布的问题。
- 支持一次拖入多张本地图片，以及缺少 MIME 信息但扩展名有效的图片；损坏或不支持的图片明确提示，不残留空卡。
- 读取、解码完成后一次创建完整图片卡，单次撤销可完整移除；切换工程后不接收上一工程尚在读取的图片。
- 新增真实 Electron 文件拖放专项回归：正文不受污染、滚动与边缘落点、隐藏声音、多图、损坏文件、撤销/重做、保存重开；PDF 断言在 alpha.18.2 更新为原位卡片输出。
- 桌面旧安装包缺少上一轮拖图修复；本次交付须核对安装包资源与构建产物一致，不能只更新源码。

## 未发布

- 统一对外名称为「光影写手 / Guangying Writer」：npm 元数据、浏览器标题、错误提示、开发启动器、测试临时文件、发布工作流和文档不再使用旧名称。
- 自动保存与外观偏好迁移至 `guangying:*` 命名空间，同时只读兼容旧键，升级后不丢本地草稿或主题。
- GitHub Actions 的发布附件统一为 `GuangyingWriter`，并可向网页先创建的预发布补传 ZIP 与 DMG，避免重名 release 导致流水线失败。
- 移除会关闭 Gatekeeper 或修改系统安全设置的旧启动流程；新的开发脚本只构建并运行当前源码。

## v1.3.0-alpha.18

- 正式更名为「光影写手」，新增墨水笔尖与胶片光束应用图标；保留内部项目标识和本地工程格式，已有 `.zhsp` 与本地草稿不需迁移。
- 写作多选支持直接 Shift 点击正文段落连续选择；普通编辑、光标与 Tab 九类循环不受影响。
- 修复故事板卡片拖入归幕框时的重复 drop 冒泡，场景现在可稳定归入目标幕。
- 移除重复的「写作图」卡体系；旧工程 `wimg` 自动归并为自由板唯一的图片卡，不丢图片、标题、备注、位置或尺寸。
- PDF 预览与导出新增声音卡、图片卡素材附页；导出前等待图片解码，避免卡片内容丢失。
- 补齐日间模式文件菜单配色，并清理自由板 resize 的重复 DOM 写入。

## v1.3.0-alpha.17（R14）

- 修复自由板删除回归：恢复“删除整场”按钮；场景卡删除会移除该场的正文区间、场景元数据和孤儿关系线，关联到该场的灵感卡保留但解除场景关联，全部操作可撤销。
- 修复自由板多选删除：⌘/Ctrl 多选、Shift 范围选和框选现在可同时删除场景与灵感卡，工具栏显示选中数量并提供“删除所选”。
- 修复进度条场景条跳转：点击场景色条会将对应场景标题精确滚动到固定进度栏下方，并保持平滑定位。
- 修正仓库版本元数据：`package.json`、`package-lock.json` 与 R14 版本号一致。

## v1.3.0-alpha.16

- 修复自由板工具栏被工作区背景层遮住的问题：总览 / 场景板 / 灵感板，以及颜色切换条现在始终可见；颜色按钮补全了键盘焦点与无障碍名称。
- 打字机指针在停止输入约 0.26 秒后静止；动效状态改为局部 DOM 更新，输入时不再触发整个编辑器重绘。
- 统一深色与日间模式的控制色、文字对比与面板层次；日间模式停用不必要的背景动画和毛玻璃，降低视觉噪点与渲染负担。
- 清理未使用的汽车 / 钥匙进度主题资源和旧样式；修复自由板批量删除对真实 `beat:` 选中标识的兼容。

## v1.3.0-alpha.15

- 自由板日间工具栏把「总览 / 场景板 / 灵感板」改为显式分段按钮，修复只有颜色圆点、分区文字不可见的问题；颜色栏仍居中。
- 快捷输入候选改为紧贴当前输入行右侧的浅色浮层，不再从稿纸左上角错误定位；候选使用真实按钮，鼠标、空格、Tab 可确认当前行，Enter 确认后直接进入符合剧本节奏的下一元素。
- 回车规则明确为：场次标题 → 动作（画面描述）、动作 → 动作、人物 → 对白、对白 → 人物。Tab / Shift+Tab 只改当前行类型，循环到末尾也绝不自动新建行。
- 写作时打字机指针启用低幅度节奏微动，停键 560ms 后静止；尊重系统“减少动态效果”偏好，且不写入工程文件。

## v1.3.0-alpha.14

- 修复自由板卡片的选中 ID 不一致：单击选中、⌘/Ctrl 多选、Shift 范围选、框选与颜色按钮统一使用同一套 `scene:` / `beat:` 标识；选中后颜色栏立即可用，旧的内存中无前缀选中值也能安全兼容。
- 自由板工具栏重新压缩为三列：左侧稳定显示「总览 / 场景板 / 灵感板」，中间居中显示颜色栏，右侧保留加卡与缩放操作；日间模式增加明确的按钮底色、文字对比与选中态。
- 修复侧栏收起把手被 flex 布局占位的问题：导航 / 大纲 / 属性标签不再被上方 42px 的空白挤开，和主区域顶部对齐；收起后把手仍留在边缘。
- 补齐日间模式的顶栏与统计页对比度：主视图切换、撤销/重做、保存/文件/设置、统计数字、表格和角色名称均使用可读的深色文字与一致的浅色反馈。

## v1.3.0-alpha.13

- 进度条当前页改为更醒目的英伦手写风格数字，并在上下两条轨道之间垂直居中，仅显示 `1/100`。
- 自由板恢复「总览 / 场景板 / 灵感板」三分区；卡片颜色控制固定到顶部工具区，未选卡片时保留可见但不可用的提示态。
- 关系线备注改为无边框斜体文字，保留直接编辑与删除关系线能力。
- 自由板卡片内容区扩展到完整卡片宽度，关联选择框不再挤压正文，连接 / 删除按钮移至右上角浮层。
- 故事板场景卡放大到更适合浏览和编辑的尺寸，拖拽、改色、标题与梗概编辑功能保持不变。
- 补齐日间模式下自由板顶部工具栏的文字、按钮和背景对比度。

- 隐私修正：首次启动项目改为空白稿，源码与后续构建不再包含原内置具体剧本内容。
- 文档补充：说明 v1.2.9 成品版与 v1.3.0-alpha 源码版的差异，避免误把 alpha 当稳定版发布。

## v1.3.0-alpha.7

自由板多选 / 框选 / 批量删除（Item 6b）。

- 新增纯函数模块 `src/model/selection.ts`：
  - `toggleSel` / `addSel` / `removeSel` / `clearSel`（选中集用 string[] 表示）
  - `selRange(sortedIds, anchor, target)`（Shift+click 范围选，v1.2.9 selRangeTo 同款语义）
  - `marqueeSel(points, rx, ry, rw, rh, additive, prev)`（框选，按卡片中心点命中，退化框容错）
  - `filterBoardLinksToKeep(links, removedSet)`（批量删除关系线过滤，只清一端在被删集的线）
  - `cardCenters(cards)`（卡片坐标 → 中心点）
- store 新增 `selectedIds` 状态（**不写入 .zhsp**，load/newProject 时清空）+ actions：
  - `setSelectedIds` / `toggleSelection` / `selectRange` / `clearSelection`
  - `deleteSelectedBeats()`：历史兼容接口；R14 已由 `deleteSelectedBoardCards()` 统一处理场景与 beat，`boardLinks` 用 `filterBoardLinksToKeep` 严格清理，**绝不误删未选卡片关联的关系线**
- BoardView 交互：
  - ⌘/Ctrl + 点击 → toggle 选中；Shift + 点击 → 范围选
  - 空白处按下拖动 → 框选（Shift 追加）；虚线 `.board__marquee` 预览
  - ⌫ / Delete 删除选中 beats（排除 input / textarea / contenteditable）
  - `.bcard.is-selected` 高亮；场景卡 / 节拍卡都支持选中态
- 测试：writing-test 新增 30 条断言（toggle/add/remove/clear + selRange + marqueeSel + filterBoardLinksToKeep 关键不变量 + cardCenters）

## v1.3.0-alpha.6.1

补全 alpha.6 的 Item 6a：之前仅覆盖 image / wimg 卡，本版扩到所有自由板卡片。

- `SceneMeta` 新增可选字段 `w? / h?`，`Scene` 派生类型同步透传。`store.resizeSceneMeta(elementId, w, h)` action 用独立 coalesce key `sceneresize:${id}`，与 synopsis / title 编辑不冲突。
- 自由板全部 5 类卡片都可缩放：scene / image / wimg / beat / sound。
  - `RESIZE_LIMITS` 加 scene 项：min 180×110，max 480×400，default 220×110
  - `ResizableKind` 联合类型取代之前的 Beat['kind'] 限定；`sizeLimitFor` / `defaultSize` / `clampSize` / `resizeBy` 全部接受 `ResizableKind`
  - `BeatCard` 移除 `canResize = isMedia` 判断，统一显示 .bcard__resize 手柄；`SceneCard` 也加 .bcard__resize
  - 拖动期间实时更新 DOM，松手时按 kind 分别调 `resizeSceneMeta`（scene）或 `resizeBeat`（其它 kind）
- 关系线连接点（endpoints）改用卡片中心 `(x + w/2, y + h/2)`：resize 后连线从新中心发出，旧工程无 w/h 时按 `FALLBACK_CARD_W=220` / `FALLBACK_SCENE_H=96` / `FALLBACK_BEAT_H=92` 兜底，位置差异极小。
- CSS `.bcard` 改 `display: flex; flex-direction: column`：head / foot `flex: 0 0 auto`、body `flex: 1 1 auto`。最小尺寸下 textarea / 声音图标 / 场景标题仍可见可操作；`.bcard__edit` 去掉 `resize: vertical`（避免与右下角 handle 冲突）；`.bcard__media` / `__media-img` 改 `flex: 1` + `max-height: 100%` + `object-fit: cover` 让图片自适应卡片高度。
- 旧 .zhsp 兼容（用户硬性要求）：
  - `SceneMeta.w / h` 与 `Beat.w / h` 都是可选字段；缺省时 endpoint 用 fallback 值计算
  - `clampSize` 接收 undefined / NaN / Infinity / 字符串 / null 全部兜底回退 default
  - `normalizeSceneMeta` 不需要新加：可选字段旧 .zhsp 加载时自动 undefined，不破坏 round-trip
  - `scripts/writing-test.cjs` 加 15 条断言：scene 区间独立 + 旧 .zhsp fallback
- 渲染测试：`scripts/render-test.cjs` 新增 `allBcardsHaveResize` feature check（在「自由板」视图抓，确保 .bcard__resize 数量 >= .bcard 数量）。
- 新增 15 条断言（177/177 total），跑通：合法 scene 区间、min/max 边界、NaN / Infinity 兜底、resizeBy scene 走独立区间、旧工程 fallback。

## v1.3.0-alpha.6

- 自由板（BoardView）图片 / 写作图卡（image / wimg）右下角新增「缩放」手柄 `.bcard__resize`，hover 卡片时显示斜线指示，鼠标拖动调整卡片大小，松开时落位到 `beat.w` / `beat.h`。
- 尺寸约束（v1.2.9 同款）：
  - image / wimg：min 180×140，max 760×680，default 176×140
  - beat / sound：min 220×170，max 720×640，default 220×170
- 拖动期间实时更新 DOM 尺寸（视觉反馈），松手时通过 `resizeBeat(id, w, h)` 一次落位；非法输入（NaN / Infinity / 字符串 / null）由 `clampSize` 兜底回退到该类型 default，min/max 越界则 clamp 到合法区间。
- 撤销合并使用独立 coalesce key `beatresize:${id}`，与 text 编辑 / 移动 / 颜色修改互不干扰；连续 resize 在一条 undo 内完成。
- 新增 `src/model/board.ts`：纯函数 `RESIZE_LIMITS / sizeLimitFor / defaultSize / clampSize / resizeBy`，纯函数测试覆盖：合法区间、min/max 边界、单边越界、负数 / 0、NaN / Infinity / -Infinity、字符串 / null / undefined、浮点 round 收敛、zoom 0 容错（回退到 1）、resizeBy zoom 归一化。
- 新增 36 条纯函数断言。
- CSS：`.bcard__resize` 右下角 18×18，hover 卡片时显示；cursor `nwse-resize`；user-select: none。

## v1.3.0-alpha.5.1

- 目标页数边界兜底：`src/model/progress.ts` 新增 `clampTargetPages`（运行用，0 表示关闭目标页数；>9999 封顶；非数 / 负数 / NaN 收敛到 0）与 `normalizeTargetPages`（加载用，保留 undefined 表示未设）。
- `store.setTargetPages` 改用 `clampTargetPages`，`.zhsp` 加载用 `normalizeTargetPages`，ProgressBar 输入框 value 改为显示真实值（target=0 时显示 0）、placeholder=100、min=0、title 加 0 = 关闭目标 提示。
- 新增 29 条断言。
- 验证：typecheck ✅ / build ✅ / test:render ✅ (10/10) / test:zhsp ✅ (40/40) / test:writing ✅ (126/126，含 29 条新增)。

## v1.3.0-alpha.5

- 新增 `src/model/progress.ts`：`computeSceneBands` 按预计排版行数计算每个场景的占比与调色板色带，跳过 `omit / note / act`，并把 `spaceBefore` 计入行数；`overPages` / `writtenPagesExcludingTitle` / `nextProgressTheme` / `normalizeProgressTheme` 同步抽象，便于纯函数测试。
- 新增 `src/components/ProgressBar.tsx`：完整回迁 v1.2.9 的 Editor 顶部写作进度条：
  - 左侧「当前页 / 目标」实时数值（取自分页 provider 的 `pageOf`）。
  - 主进度条 `__road`：打字机指针 PNG 跟随 `completionPct`（已写页数 / 目标）；里程碑 `[25%, 75%]`（v2.6 已按用户要求移除 50%）。
  - 进度条上方的 `__tip` 浮层根据鼠标位置显示「跳到第 N 页」或「第 N 页尚未写出」提示，72% 之后翻转避免被裁切。
  - 主题切换按钮 `__theme` 点按循环 `cigarette → car → key`；旁边 `__end` 终点图标按主题切换（爱心 / 旗帜 / 宝石）。
  - 场景条带 `__scenes`：每个 scene_heading 一段彩色按钮，调色板循环 10 色（`#78938b` 系列），按场景预计行数分配 `flexBasis`；点击跳转到该场景；超过目标页数时整条加 `is-over-target` 描边并显示「超出目标 X 页」。
  - 右侧 `__goal` 目标页数输入回写 `project.targetPages`（沿用 `setTargetPages`，coalesce 合并连续输入）。
- 三套主题图标全部用 inline SVG 渲染（来自 twemoji 15.1.0，CC-BY 4.0，github.com/jdecked/twemoji）；不引入额外图片资源，与 v1.2.9 视觉一致。
- `src/components/StatusBar.tsx` 移除 alpha.1 占位的「目标页数输入 + 打字机进度」控件（已迁到 ProgressBar）；状态栏回归 v1.2.9 的「字数 / 页数 / 时长 / 场数 / 人物数 / 修订模式 / 缩放」纯统计形态。
- `src/components/Editor.tsx` 在 `<TitlePageCard>` 之前插入 `<ProgressBar />`，与 v1.2.9 真实形态对齐。
- `src/components/Dialogs.tsx` 在「外观」tab 加「写作进度条主题」segmented control（香烟 / 汽车 / 钥匙），按钮旁 inline SVG 图标，hint 文案沿用 v1.2.9 原句。
- `src/styles/app.css` 新增 `.write-progress*` 全套样式（标签 / 主条 / 里程碑 / 提示浮层 / 指针 / 终点 / 主题按钮 / 场景条带 / 目标输入），并补 `fog-ico` SVG 容器样式；移除 `alpha.1` 的 `.target-pages / .typewriter-progress*` 等占位规则。
- `settings.progressTheme` 新增可选字段 `'cigarette' | 'car' | 'key'`，旧 `.zhsp` 工程缺省视为 cigarette。
- `scripts/writing-test.cjs` 新增 24 条进度条相关断言：三套主题循环、`overPages` / `writtenPagesExcludingTitle` 边界、`computeSceneBands` 跳过 omit/note/act + scene_heading 也折行 + 调色板循环 + 不修改 project。

## v1.3.0-alpha.4

- 自由板卡片（BoardView）现在区分四种 kind：`beat` / `sound` / `image` / `wimg`：
  - 灵感（beat）：原有 textarea 编辑区
  - 声音（sound）：标题输入 + 音频图标 ♪，默认色 `#ccb887`
  - 图片（image）：`<img>` 缩略图 + 标题输入
  - 写作图片（wimg）：同 image，但归入写作页素材面板
- 自由板工具条增加 **「＋ 灵感卡 / ＋ 声音 / ＋ 图片 / ＋ 写作图」** 一组按钮，图片类卡点击后弹出系统文件选择器，`FileReader.readAsDataURL` 写入 `Beat.img`
- 写作页（Editor）顶部新增 **素材面板**：
  - 空状态：仅显示「＋ 声音 / ＋ 写作图片」按钮与说明（声音与写作图片归入此处，不计入正文页数）
  - 有素材时按类型分两区：声音卡（含标题编辑、删除）、写作图片（缩略图 + 标题 + 删除）
- 数据层：`addBeat(x, y, text, kind?)` 新增可选第四参数 `kind`，与 v1.2.9 同款默认色（sound 用 `#ccb887`）；其它 kind 默认黄
- 卡片按钮条统一在 BoardView 和 Editor 可见，操作语义一致
- `BeatCardProps.onChange` 现在接受 `Partial<Pick<Beat, 'text'|'color'|'title'|'img'|'w'|'h'>>`，支持新字段就地编辑

## v1.3.0-alpha.3

- 写作辅助快捷键：`Tab` / `Shift+Tab` 现在循环 9 个常用类型（动作 / 人物 / 括号提示 / 对白 / 转场 / 镜头 / 场次标题 / 一般性文本 / 备忘），与 v1.2.9 / Final Draft 主线一致；`act` 通过工具栏切换。
- 新增 `⌘/Ctrl+Shift+N` 备忘切换：在「备忘」与上一次非备忘类型之间来回切换，便于临时打断思路后再恢复。
- 新增 `⌘/Ctrl+A`：一键选中文本编辑区内的全部内容。
- 新增 Final Draft 风格的「正在输入」识别：仅当空块第一次输入时，若新文本符合场次标题、转场、纯大写英文人物、括号提示或镜头等模式，会自动切换类型；识别只在「之前为空 + 新文本非空」时触发，不会影响后续编辑。
- 「（续）」渲染仅在「当前对白块所属人物 === 上一页最末对白块所属人物」时显示「角色名（续）」，否则回退为 `（续）`，避免跨人物 / 跨场次时仍沿用旧角色名。
- 新增「同人物续说」标记 (CONT'D)：在同一场景内，同一人物经动作 / 对白 / 括号提示段后再次说话时，character 元素尾部追加 (CONT'D) 视觉后缀；遇场次标题 / act 截止；正文已写 (CONT'D) 不重复添加；位于双列对白中不参与；受新增设置 `contdCharacter`（缺省开启）控制。后缀为纯视觉（`data-contd` + CSS `::after`），不会进入 innerHTML、统计、导出或 autosave。
- `settings.contdCharacter` 新字段为可选，旧 `.zhsp` 工程缺省视为开启。

## v1.3.0-alpha.2

- `Beat` 接口新增可选字段 `kind` / `title` / `img` / `w` / `h`，为后续声音卡、图片卡、写作页图片卡预留类型空间；所有新字段都是可选的，旧 `.zhsp` 工程可直接打开和保存。
- `.zhsp` 解析新增 `normalizeBeat` 函数：仅对缺失的必填字段做最小兜底，不覆盖原有 `text/color/x/y/sceneId`；可选字段在缺省时保持 `undefined`，序列化时不会写入文件，保证 round-trip 完全无损。
- `sceneNumber` 默认值由 `both` 改为 `left`；旧 `.zhsp` 文件里显式保存的 `both` / `right` / `none` 仍按原值加载。同时为 `sceneNumber` 加入白名单校验，非法值兜底为 `left`，避免垃圾数据让 UI 选中错位。
- 新增 `npm run test:zhsp`（`scripts/zhsp-compat-test.cjs`）：用合成数据覆盖默认值、显式 `both/right/none`、非法值、旧格式 Beat round-trip、新格式 Beat round-trip 和残缺 Beat 解析等场景，不含任何真实剧本内容。

## v1.3.0-alpha.1（源码功能回迁进行中）

- 统计报表的区块标题层次更清晰；人物名称可直接修改，保存时会同步所有同名正文人物元素。
- 自由板新增卡片关系线：依次点击两张卡片右上角的连接按钮即可建立连线；在线旁可直接填写关系备注，也可删除连线。
- 增加可见、可编辑的目标页数输入，旧 `.zhsp` 项目默认使用 100 页目标。
- 进度显示改为打字机纸带与指针样式；指针根据当前页数相对目标页数的位置移动。
- 状态栏打字机进度指针替换为 v1.2.9 正式 PNG 资源（`src/assets/typewriter-pointer.png`），不再使用字符 `⌄`。

## v1.3.0-alpha.0（源码迁移基线）

- 从提供的早期 React / Electron 工程建立独立迁移副本。
- 修复缺失的示例背景资源，使生产构建不再依赖未随源码交付的图片。
- 为渲染测试补齐 `jsdom` 开发依赖，并让测试自行生成和清理临时执行包。
- 增加 Git 忽略规则和功能回迁清单。

此版本只是回迁起点，尚未等价于稳定发布版 v1.2.8，不能替代后者使用。
## v1.3.0-alpha.9（界面收尾）

- 左侧导航收起后保留窄按钮，点击可平滑展开，不再让侧栏突然消失。
- 提高文件菜单层级并增加隔离层，避免被写作区或其它面板遮挡。
- 目标页数输入扩大并右对齐，三位数及异常边界更容易看清。
- 进度条与声音/写作图片素材面板合并为统一工具区，减少大块空隙。
- 写作素材卡改用内嵌色标与统一边框，减弱突兀的蓝色左边线。

## v1.3.0-alpha.8（撤销安全）

- 修复工程切换后沿用上一个工程的连续缩放合并状态问题。
- 没有实际数据变化的输入不再制造撤销点、清空重做栈或误标记工程为已修改。
- 非历史状态更新会切断连续缩放合并边界；连续同卡片缩放仍合并为一次撤销。
- 新增撤销 / 重做安全测试：连续缩放、关系线恢复、批量删除恢复、重做分支和工程切换隔离。
## v1.3.0-alpha.10（单一打字机进度条）

- 删除汽车 / 钥匙进度条主题、主题循环按钮和设置项。
- 统一为单一打字机纸带样式，保留 PNG 指针、场景篇幅色带和目标页数。
- 旧工程中的 `progressTheme` 字段读取时忽略，不影响打开和保存。

## v1.3.0-alpha.11（写作区布局修整）

- 目标页数改为位于右侧素材控制组上方，进度区左右信息垂直居中。
- 场景篇幅色带移除居中的进度提示字，保持与纸带轨道等宽、清爽可读。
- 日间模式补齐侧栏、场景条与底部状态栏的浅色覆盖。
- 收起侧栏按钮缩小并固定在侧栏右侧中部；写作素材卡收紧边距和阴影。
- 自由板场景卡以左侧细色标表示颜色，移除突兀的顶部色线。

## v1.3.0-alpha.12（日间工作台收尾）

- 日间模式覆盖元素类型选择框、自由板关系备注和设置弹窗，不再出现黑色控件。
- 场景篇幅色带换为统一的雾蓝配色；当前页简化为居中的 `1/100`。
- 目标页数改为精确居中于两组素材控制的上方。
