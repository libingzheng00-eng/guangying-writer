# 更新记录

## 未发布

- 隐私修正：首次启动项目改为空白稿，源码与后续构建不再包含原内置具体剧本内容。
- 文档补充：说明 v1.2.9 成品版与 v1.3.0-alpha 源码版的差异，避免误把 alpha 当稳定版发布。

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

- 从提供的 `zh-screenwriter` 原始 React / Electron 工程建立独立迁移副本。
- 修复缺失的示例背景资源，使生产构建不再依赖未随源码交付的图片。
- 为渲染测试补齐 `jsdom` 开发依赖，并让测试自行生成和清理临时执行包。
- 增加 Git 忽略规则和功能回迁清单。

此版本只是回迁起点，尚未等价于稳定发布版 v1.2.8，不能替代后者使用。
