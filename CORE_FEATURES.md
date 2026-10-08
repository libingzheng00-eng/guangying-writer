# 光影写手：核心功能与维护红线

这份清单用于每次更新前的回归核对。以下能力不是可随意精简的 UI，而是用户创作流程与工程兼容性的组成部分。

## 一、工程与隐私

- `.zhsp` 必须向后兼容；新增字段必须可选，旧工程打开、保存、重开后不能丢失已知内容。
- 首次启动模板保持空白；仓库、测试、发布包不得含用户剧本、自动保存、导出稿或真实人物资料。
- 保存、另存为、打开、导入文本/FDX，导出 PDF/FDX/文本/Markdown/HTML 都必须可用。
- 保存使用不可变快照和文档epoch校验：保存中有新输入仍dirty，切稿后旧结果不绑定新稿；重复保存不得并发。新建/打开重置文档历史，保存不清历史。打开替换前必须确认丢弃未保存修改，包括对话框等待时的新输入；取消/过期结果保留工程及历史。FDX/TXT/MD导入后第一次保存选新zhsp路径，不能覆盖源文件为另一格式；异步图片不得落入后来打开的同ID文档。另存为后的新路径须写入自动保存，不推迟已挂起的正文保存。专项：file-commands / autosave-path / history / zhsp-compat。
- 自动保存和重启恢复必须保留正文、卡片和文件关联；手动保存继续写入兼容 `.zhsp`。当前 `guangying:autosave` 兼容同一数据目录中的旧 `mojiang:autosave`；这不等于跨应用数据目录已自动迁移。更改应用名称/标识/数据目录前必须单独设计迁移并验证，不得使旧草稿“消失”。
- **自动恢复与关闭红线（2026-10-07）**：自动恢复只保存一份最新快照，不等于成功保存磁盘 `.zhsp`，也不能清 dirty 或撤销历史。保持约900ms停笔调度，连续修改最长约30秒触发一次写入；文件关联变化不得推迟已挂起任务。恢复点状态独立于工程，容量/读取/写入失败必须明确提示，不伪装成功。坏载荷必须先保留原始字符串再允许替换；保留失败或保留槽已含另一份坏载荷时，不得覆盖原载荷。恢复可用工程后保守标 dirty；未确认工程草稿、dirty、保存进行中或恢复写入失败均须保护关闭，默认继续写作。该保护不能被自动化脚本移除来制造绿灯。专项：autosave-recovery / autosave-path / file-commands / 实际关闭与恢复。
- **工程落盘红线（2026-10-07）**：`.zhsp` 在目标同目录独占创建临时文件，写入与文件 fsync 完成后再 rename；已有工程先生成一份上一版备份，不能先截断或删除原稿。保存队列、目标/备份身份校验及失败清理只作用于本次创建的临时文件。保留普通 POSIX mode，不承诺保留 ACL/xattr，不声称跨进程锁或任意文件系统断电保证。rename 已完成但目录同步失败时，须报告耐久性警告而非假报“未保存”；备份为同目录 `<文件名>.guangying-backup`，不是无限历史。专项：project-save / project-save-ipc / file-commands；取消/失败不清 dirty，不把异常中的工程或路径内容回显。

## 二、写作是第一优先级

- 九类元素的 `Tab` / `Shift+Tab` 循环必须闭环：只改当前段落类型，永远不跳到文件名、缩放或其他界面控件，也不自动新建段落。
- 固定正向顺序为：动作 → 人物 → 括号提示 → 对白 → 转场 → 镜头 → 场次标题 → 常规文本 → 备忘 → 动作；Shift+Tab 反向。`⌘/Ctrl+Shift+N` 在备忘与该段上次非备忘类型间往返，不能篡改正文。
- 回车节奏：场次标题后为动作；动作后仍为动作；人物后为对白；对白后为人物。
- **编辑事务红线（alpha.18.10）**：段中回车必须把尾部移动到下一段，原段不可残留副本；加粗、斜体和软换行处光标偏移同样正确。聚焦中的正文也必须响应撤销/重做与结构变更，不能用“正在聚焦”跳过 DOM 同步；正常输入与组合输入时，内容一致则不得重写 DOM。
- 复制只读取选中文字，不制造历史；剪切、粘贴与跨段选区替换必须是单次可撤销事务，不与前后打字合并，不允许模型已撤销但屏幕仍留旧字。纯文本粘贴须保留 `< > &` 等字面字符与换行，不当作 HTML 执行。不得混用原生插入与 store 更新造成二次写入。专项：`editing-test.cjs`、隔离运行的 `editing-electron.cjs`。
- **撤销/剪贴板路由红线（2026-10-07）**：键盘、工具栏、原生菜单与beforeinput必须共用 `runEditHistory`；正文禁止原生DOM undo，明确标记的未提交UI草稿不得顺带撤销工程。持续同段输入合并有1500ms停顿阈值和5000ms绝对组上限，保留120事务上限；光标移动、IME、格式/结构修改须分组。复制/无变化不清redo。Enter撤销和重做须恢复相应原段/新段与光标。内部多段剪贴板保留类型和基础格式、单片段保留目标类型，载荷仅type/html，不带ID/双列/图片/关系；非法载荷回退字面文本、空载荷不删选区。组合期不得绕过统一路径原生剪切/粘贴；双列视觉与正文顺序不一致的跨栏范围必须拒绝并提示，不能放松连续范围校验误删中间内容。专项：clipboard-format / clipboard-ui / history / editing / writing-range-integrity / native-draft-history。
- 全文查找使用独立面板，可按 ⌘/Ctrl+F 打开、Enter/Shift+Enter 定位上下处、Esc 关闭；覆盖正文九类元素与备忘，支持大小写选项。高亮只能是浏览器绘制，不写入正文 HTML、工程、撤销栈或 PDF；未打开查找时不得运行全文匹配。专项：`search-test.cjs` / `search-ui-test.cjs` / `search-electron.cjs`。
- 智能识别、自动补全、双列对白、场号、同一人物再次说话的 `(CONT'D)` 视觉提示保持正常。
- **智能双引号红线（2026-10-07）**：保持既有“对白 + smartQuotes 开启”的范围，只转换可确认的本次新输入 ASCII 双引号，不按 HTML 字符偏移奇偶配向、不全文改写。反斜杠转义原样保留；已有未闭合开引号时优先闭合（包括引文以冒号/括号/破折号结尾），否则依据段首、空白、冒号/开括号等开启上下文；词内、尺寸或无法确认的孤立引号保留原字符。手动弯引号、已有直引号、单引号、粘贴/历史/替换输入不重整，标签与属性不参与方向判断。DOM UTF-16 偏移与 BR=1 的光标口径保持一致；格式和未选正文不得改变。IME 中间态不重建节点，完成时仅根据原选区、最终 data 与 documentEpoch 校验处理新增部分；转换沿用本次输入事务，不额外制造撤销步骤。只做保守单层自动配向，不自动嵌套或补配对，不改双列范围安全逻辑。专项：`smartquotes-test.cjs`，真实输入法另验。
- **快捷输入红线（2026-10-08，用户明确批准的新契约）**：从新空段开始的连续输入可跨类型推荐人物、镜头、转场、场次前缀，不要求先切换段落属性；候选带类型标记，只有明确确认才将补全文字与目标类型一次提交、一次撤销。输入“特”可选“特写 · 镜头”，输入“小明”仍显示“小明 · 人物”和“小明妈妈 · 人物”，完整匹配优先但不自动接受或强制扩为长词。**有候选时第一次 Enter 仅确认并留在同段；确认后关闭候选，未有新输入不得重新弹出；第二次 Enter 才按原回车节奏切段。**鼠标/右箭头确认同样留在本段；原同类型字段补全的空格行为保留，跨类型意图候选不得抢占空格。无候选或已 Esc 取消时 Enter 正常切段。候选文字不能解释为 HTML，字段补全不能覆盖别的字段。
- **快捷输入安全边界**：旧正文编辑、粘贴、段中拆行携带的尾文不启用新跨类型识别，双列对白不扩展新跨类型语义；没有可匹配跨类型候选时保留原保守识别回退。候选须校验当前段落/类型/文本/光标/文档边界，段中光标、非折叠选区、修饰键、中文组合期及 `keyCode=229` 不得误接受。中文输入法确认汉字不能同时接受软件候选；Esc 仅收起候选并保焦。Tab/Shift+Tab 永远只做九类循环、清除旧候选、保留原光标位置；Shift+Enter 软换行不变。候选会话和缓存不写入 `.zhsp`、自动恢复或历史。**本新契约覆盖2026-10-07“只按当前类型匹配、Enter确认立即下一段”的旧要求**，历史日志不得作为恢复旧语义的依据。专项：`smarttype-test.cjs` / `smarttype-ui-test.cjs`，另需真实浏览器或 Electron 按键、连续 Tab 与输入法分层验收。
- 写作多选模式下：普通点击可选择段落；Shift 点击正文或复选框可按正文顺序连续选择；删除只删除选中段落；普通写作模式绝不能被这套逻辑干扰。
- `⌘/Ctrl+Z` 撤销与 `⌘/Ctrl+Shift+Z` 重做须支持多步恢复正文、卡片、关系线；输入及同一卡片连续移动/缩放可按既有规则合并，不得跨不相关操作误合并，批量删除必须一次完整撤回。
- 输入性能：`setText` 仅不可变更新当前段落与元素列表，不能按每个字 JSON 复制/比较整个含图工程；未改对象可共享引用，但严禁直接修改当前工程或撤销快照。它与通用 `mutate` 必须共用同一历史提交规则。无变化/无效 ID 保留 redo、dirty、version 并切断合并窗口。自动保存保持约 900ms 停笔后保存最新正文/路径，连续修改增加约30秒截止点；订阅不能导致 App 整树随字重渲染。专项：`input-performance-test.cjs` / `autosave-recovery-test.cjs`；实际组合输入与重载恢复：`input-electron.cjs`。
- **写作派生缓存红线（2026-10-07）**：元素索引和同人物续说提示按不可变元素数组共用只读派生；快捷输入目录按人物/场景/镜头/转场实际来源字段复用，动作/对白变化不得重复解析这些来源。改名、类型变更、删除、排序、活动段排除、撤销与文档边界仍须正确失效，设置开关即时生效。缓存不写入 `.zhsp`、自动恢复或历史，不改变 Tab、候选接受、CONT'D 规则；只减少重复推导，不重写分页、隐藏测量、字体等待或 PDF 排版。专项：writing-derivation / smarttype / writing / pagination-safety。

## 三、创作素材与 PDF 导出

- 自由板提供灵感卡、声音卡、图片卡；图片只有一套 `image` 卡，不再新增重复的“写作图”类型。**写作面板必须继续支持把本地照片直接拖入，生成这同一套 `image` 卡；删除重复按钮不等于删除拖入入口。**
- 旧工程的 `wimg` 必须读取为 `image`，并保留图片、标题、备注、位置、尺寸。
- 图片拖入必须接管正文上的文件 drop，不能将图片插入正文元素；关闭声音卡不能隐藏图片。读取失败不创建空卡，读取成功后一次撤销能完整移除新卡；滚动后落点与画布右边缘必须实测。专项脚本：`scripts/image-drop-electron.cjs`（独立临时用户目录，真实 Electron 文件拖放测试）。
- **PDF 红线（用户明确纠正）**：创作版必须所见即所得，按写作画布的实际位置保留正文、图片、声音卡；第五场旁边的参考图仍在第五场旁边。禁止统一移动到文末、生成独立素材附页或另行配对。创作版采用数字画布尺寸，不强制 A4；超长画布切页不可切断卡片或重排其与正文的位置关系。
- **纯文本打印版**独立按 A4 分页，保留剧本格式且不包含素材卡。导出不得改变工程纸型、卡片坐标、正文内容或撤销栈。
- **导出回归红线（alpha.18.9）**：人物/括号跟随约束在一组完整短对白结束后停止，不能为了凑两行把后续多组对白整批挪页。图文 HTML 不得拼入巨型 `data:` 页面地址；多 MB 图片必须通过短地址的隔离加载路径导出，失败信息不能包含剧本文本或内嵌图片数据。`pdf-transport-test.cjs` 与实际 `pdf-layout-electron.cjs` 大图用例共同保护。
- 两种导出均等字体与排版就绪；创作版还须等图片解码。缺少 MIME 但可解码的图片也必须保留；损坏图片至少保留原位卡片标题和备注，不得静默丢卡。专项脚本：`scripts/pdf-layout-electron.cjs`，需实际输出 PDF 后检查第五场图文位置和 A4 纸型。

## 四、故事板与自由板

- 大纲拖动场号把手到目标卡片的上/下半部，必须按稳定场景 ID 移动整场（含正文），一次操作可完整撤销。原位、取消、外部拖入不得新增历史；标题/摘要编辑不能触发跳转或拖动。双击场号定位正文，Alt+↑/↓ 可相邻移动。
- 自由板场景卡上方显示标题，下方直接编辑 `SceneMeta.synopsis`，与大纲、故事板共用一份故事信息。空摘要显示提示语，不重复标题；文本输入、选择、双击和滚动不能误拖卡、跳正文、缩放画布或删除场景。不得因此改变正文、坐标、尺寸或关系线。
- 故事板卡片支持排序、修改标题/梗概/颜色，并能稳定拖入某一幕归幕；一次拖拽只产生一次状态变更与一次撤销记录。
- **故事板归幕红线（用户批准的新方案）**：未归幕置顶；移回未归幕只清除旧 `actId`，无论从菜单还是拖放，都必须保留正文位置。移入正式幕才移动整场正文：卡片左/右半部落点对应前/后插入线，组内空白放在幕末。多选移动保持源场景的正文相对顺序，并一次完整撤销。标题区、折叠幕、空白网格、空组提示区、已有卡片均可接收；拖动期间不得卸载源节点，取消/原位不制造历史。不得删除 `storyboard-drop` / `storyboard-acts` 断言绕过回归。
- 幕可折叠、自由命名，显示场数和当前排版涉及页数（同组同页去重，跨幕共页各计一次，标题页不计）。提供复选框、Shift 可见卡片范围选、⌘/Ctrl 增减选，以及单卡/多卡“移至”菜单。选择不影响正文编辑或自由板选择。
- 删除幕需明确说明保留场景，将所属场景解除归幕；不删正文、素材、关系线，不移动正文位置，单次撤销可恢复幕与归属。允许删除全部幕，显式 `acts: []` 保存重开后保持零幕；仅缺失字段的旧工程补默认幕。新场景默认未归幕。
- 自由板支持场景卡、卡片连接线、可编辑关系备注、卡片缩放与尺寸持久化。
- 自由板采用紧凑单行标题和内容优先卡片；常驻连接/删除按钮由底部工具、键盘和明确右键菜单替代。灵感/声音标题普通点击可选择或拖动、双击/F2/Enter 编辑；Esc 取消标题草稿。颜色及单素材的场景关联只在选中卡片附近显示，不能丢失这些能力。隐藏缩放文字不等于隐藏手柄，18px拖动区域保留；渲染默认值不得覆盖已保存尺寸。
- 自由板支持 ⌘/Ctrl 多选、Shift 范围选、框选、批量删除；删除需同时清理孤儿关系线，但不能误删未选卡片的关系。
- 场景卡的“删除整场”必须存在，并在可撤销的单次操作中处理正文、场景元数据、关系线与关联卡的解除关联。
- 自由板筛选后，连线须两端均可见；Shift 选区、批量改色与删除只影响当前可见卡片。删除涉及整场正文必须先确认，取消不能改选区或撤销栈。专项：`board-polish-test.cjs`。
- **自由板交互红线（2026-10-07，第2稿）**：普通点击仅选择/编辑；L 或底部“连线”显式进入连接模式，点 A/B 后退出，Esc 取消，不自连、不重复连接。点线仅选线并清空卡片选区，点卡清空线选区；Delete 只删除当前选中对象。关系说明居中加粗，双击/F2/Enter 编辑，Enter/失焦提交、Esc 回滚；组合输入期间不得提交。所有文字框、关联选择器和嵌套 contenteditable 中，L/空格/Delete 均不能触发画布命令。
- **板面与写作坐标隔离**：自由板素材只写可选 `Beat.boardX/boardY`；缺失时显示回退到原 `x/y`，打开/切板/开网格不能凭空补字段。写作素材和创作 PDF 继续用原 `x/y`，自由板移动不得牵动它们。整场删除须解除规范 `SceneMeta.id` 及旧场次元素 ID 两种素材关联，保留未选场景关联。
- 标题/关系备注每次完成编辑用独立提交入口；不可与此前正文输入或另一次确认误合并撤销。自由板不能因焦点产生原生scrollLeft/scrollTop导航，pan/zoom是唯一画布位移；附近工具必须在窗口改变后仍留在可见画布内。
- 网格显示和磁吸为独立开关，磁吸默认关闭；开启/关闭不得自动排布旧卡。磁吸仅在拖动时作用于28单位网格、按屏幕像素容差，Alt 暂停。组拖动保持相对位置；拖动/缩放过程中仅预览，释放后整组一次写入、一次完整撤销，连续两次独立手势不可误合并；Esc/窗口失焦取消不写工程。空白拖动框选，空格拖动/中键平移；缩放只改变视图。专项：`board-workspace-model-test.cjs` / `board-workspace-ui-test.cjs`，另需真实浏览器鼠标验收。

## 五、结构、统计与界面

- 目标页数、单一打字机指针进度、按场景篇幅的色带与精确跳转保持可用。
- 场景色带未完成目标时必须按实际占目标比例留白，禁止 flex-grow、最小宽度或内边距把短场景撑满；超目标才按当前篇幅归一，提示仍保留目标比例。`progress-bands-test.cjs` 同时保护纯计算及样式契约。
- 进度栏可见轨道可收细，鼠标点击盒仍为30px、外栏仍为76px，两行网格保持30px/18px；绘制伪元素不得拦截跳页、遮挡提示或改变56px打字机指针的锚点。场景条变薄不能更改比例、场号及跳转语义。
- 写作工具栏在多选时原位替换格式工具，退出即恢复；全选、删除、撤销、完成入口保持可用，不能因按钮挤压折字或更改工具栏高度而影响正文/素材/PDF坐标。窄屏导航可改为等价选择器，但不能删除视图入口。专项：`writing-controls-test.cjs`。
- 统计页角色改名必须同步正文人物元素。
- 统计分析仅使用 `model/reports.ts` 的只读投影与 `styles/reports.css` 的统计页限定样式，不得替换编辑器、底栏、分页或导出共用计算。总量、幕/场景、人物及 CSV 排除省略场景、省略段落与备忘；词字数不是电影时长。正文涉及页数按当前排版有效元素所在页去重，各场涉及页数不能相加。人物只代表人物元素，括号版本合并统计但保留原有精确名称改名入口；拒绝空名/重名时输入须恢复，撤销仍可恢复正文。地点不明时标为未识别。专项：`node scripts/reports-test.cjs`。
- 深色/日间模式都须保证菜单、输入、文字、按钮有足够对比；日间模式不得遗留深色文件菜单。
- 标题页与设置打开后须把焦点移入对话框，Tab/Shift+Tab 在可用控件内闭环并将焦点控件滚入对话框可视区域，Esc 关闭；背景工具栏、正文和底栏暂时 inert，原生查找/视图命令不能偷走焦点。关闭后恢复仍有效的触发控件或原正文选区，不把旧文档选区套到新工程。对话框会话内的撤销不越过打开边界，保留工程保存、恢复与既有历史语义。文件菜单须支持方向键/Home/End、Esc、Tab/Shift+Tab及稳定焦点交接，并在外点、窗口失焦、视图或工程切换后关闭；普通菜单键不能泄漏到板面删除/连线命令。专项：`modal-ui-test.cjs` / `menu-ui-test.cjs`；真实绘制与系统输入仍另验。
- 左侧导航可收起且可恢复，不应遮挡正文或工具栏。

## 六、每次提交前至少验证

```bash
npm run typecheck
npm run build
npm run test:core
```

`test:core` 当前统一运行43套源码专项，runner与各平台CI必须同步更新；这不等于原生验收通过。单项定位可运行：

```bash
node scripts/core-guard.cjs
node scripts/render-test.cjs
node scripts/writing-test.cjs
node scripts/editing-test.cjs
node scripts/smartquotes-test.cjs
node scripts/smarttype-test.cjs
node scripts/smarttype-ui-test.cjs
node scripts/search-test.cjs
node scripts/search-ui-test.cjs
node scripts/modal-ui-test.cjs
node scripts/menu-ui-test.cjs
node scripts/zhsp-compat-test.cjs
node scripts/history-test.cjs
node scripts/input-performance-test.cjs
node scripts/autosave-recovery-test.cjs
node scripts/project-save-test.cjs
node scripts/project-save-ipc-test.cjs
node scripts/electron-security-test.cjs
node scripts/project-html-security-test.cjs
node scripts/display-security-test.cjs
node scripts/display-values-test.cjs
node scripts/writing-derivation-test.cjs
node scripts/pagination-safety-test.cjs
node scripts/pdf-transport-test.cjs
node scripts/outline-reorder-test.cjs
node scripts/scene-notes-test.cjs
node scripts/storyboard-drop-test.cjs
node scripts/storyboard-acts-test.cjs
node scripts/reports-test.cjs
node scripts/board-polish-test.cjs
node scripts/board-workspace-model-test.cjs
node scripts/board-workspace-ui-test.cjs
node scripts/writing-controls-test.cjs
node scripts/progress-bands-test.cjs
```

涉及写作交互、导出、拖拽或主题时，还要在真实浏览器或 Electron 中做一次人工验证；自动测试通过不等于视觉与鼠标手势已经验收。

## 七、保护入口与变更要求

| 行为契约 | 关键实现位置 | 回归入口 |
| --- | --- | --- |
| Tab 焦点闭环、备忘往返、正文 Shift 多选 | `src/model/flow.ts`、`Editor.tsx`、`ScriptBlock.tsx` | writing / render / 实机连续 Tab |
| 空段跨类型/分字段快捷输入、两次 Enter、候选生命周期与原子撤销 | `src/model/smarttype.ts`、`Editor.tsx`、`ScriptBlock.tsx`、`store.ts` | smarttype / smarttype-ui / 实机候选与连续 Tab |
| 回车移动尾部、剪切粘贴原子撤销、只读全文查找 | `Editor.tsx`、`ScriptBlock.tsx`、`store.ts`、`src/utils/dom.ts`、`FindPanel.tsx`、`search.ts` | editing / search / search-ui / editing-electron / search-electron |
| 拖入图片、原位卡片创作 PDF、A4 纯文本 | `Editor.tsx`、`src/io/creativePdf.ts`、`useCommands.ts`、`PreviewView.tsx`、`PaginationProvider.tsx`、`electron/pdf.js` | image-drop-electron / pdf-layout-electron / pagination-safety / PDF 渲染检查 |
| 选择、归幕、删除、撤销重做 | `store.ts`、`selection.ts`、`board.ts`、`BoardView.tsx`、`CardsView.tsx` | history / writing / render / 实机拖放 |
| 自由板独立坐标、组拖动磁吸、显式连线与线/卡互斥删除 | `boardWorkspace.ts`、`BoardView.tsx`、`store.ts`、`zhsp.ts` | board-workspace-model / board-workspace-ui / board-polish / 真实鼠标 |
| 大纲整场拖动、场景故事信息同步编辑 | `outline.ts`、`Sidebar.tsx`、`BoardView.tsx`、`CardsView.tsx` | outline-reorder / scene-notes / 实机拖放与输入 |
| 工程兼容、空白启动、保存恢复 | `src/io/zhsp.ts`、`src/model/sample.ts`、`src/App.tsx`、`electron/main.js` | zhsp-compat / core-guard / 隔离用户目录启动保存重开 |
| 单快照恢复、坏载荷保护、恢复失败与关闭提示 | `src/app/autosaveStorage.ts`、`autosaveSubscription.ts`、`recoveryStatus.ts`、`src/App.tsx`、`StatusBar.tsx`、`electron/main.js` | autosave-recovery / autosave-path / 真机关闭与恢复 |
| 工程临时落盘、上一版备份、原子替换与 IPC 结果 | `electron/projectSave.js`、`electron/main.js`、`src/app/useCommands.ts` | project-save / project-save-ipc / file-commands / 独立临时工程实测 |
| 只读元素/续说派生与快捷输入目录复用 | `src/model/flow.ts`、`src/model/smarttype.ts`、`Editor.tsx`、`PaginationProvider.tsx` | writing-derivation / smarttype / writing / 长稿与原生输入 |
| 场景进度与跳转、角色改名同步 | `ProgressBar.tsx`、`progress.ts`、`ReportsView.tsx`、`store.ts` | writing / render / history / 实机跳转 |

表中未写完整路径的组件位于 `src/components/`，模型位于 `src/model/`，`store.ts` 位于 `src/store/`，`useCommands.ts` 位于 `src/app/`。测试入口名称对应 `scripts/` 中同名 `*-test.cjs` 或 `*-electron.cjs` 文件。

这些代码不是只读文件，也不做哈希“锁死”：修复错误必须可以改。任何改变上述行为的设计决定，须先征得用户明确认可；维护者不得靠删断言或关 CI 来掩盖回归。`AGENTS.md` 给 AI 明确约束，`core-checks` CI 自动运行基线；必须由管理员另外设为受保护分支的必需检查，才能强制阻止未通过检查的合并。

`core-guard` 检查 Git 跟踪路径中的工程/导出/自动保存/大文件风险，并实测空白模板和 Tab 类型契约。可对明确的 `Contents/Resources/app` 打包目录附加检查；不会读取个人目录，也不会扫描旧 Git 历史。它不能识别任意字符串是否为用户剧情，不能代替人工源码/产物隐私审查。测试源码允许合成场景、角色与图像；用户真实剧本任何部分都不能当测试夹具。
