# 光影写手源码维护手册

更新：2026-10-08。适用于当前 `1.3.0-alpha.18.13` 安全候选源码；安全边界见 [SECURITY_UPGRADE.md](SECURITY_UPGRADE.md)。版本号不代表推送、main合并或公开发布已经完成；实际安装附件以对应 GitHub Release 为准。

这是当前维护入口；历史版本记录保留在 `CHANGELOG.md` / `DEVELOPER_HANDOFF.md`，不要把旧日志中的状态当作当前交付事实。行为契约以 [CORE_FEATURES.md](CORE_FEATURES.md) 为准，本轮SmartType与交付证据见 [SMARTTYPE_QA_20261008.md](SMARTTYPE_QA_20261008.md) / [RELEASE_ALPHA_18_12.md](RELEASE_ALPHA_18_12.md)，历史/剪贴板及智能引号边界见 [EDITING_QA_20261007.md](EDITING_QA_20261007.md) / [SMART_QUOTES_QA_20261007.md](SMART_QUOTES_QA_20261007.md)。

## 1. 开工与交付规则

- 先读 `AGENTS.md`、核心契约和本手册，查看 `git status`；他人已有修改不撤回、不覆盖。
- 用合成工程测试。不得读取、改写或上传用户剧本、自动保存和个人素材；空白模板不能换成演示剧情。
- 现用应用、源码、测试用户目录、打包产物是不同对象。修改源码不等于更新已安装软件。
- 不直接改打包后的 bundle 修功能；改源码、补回归、构建后再按获准范围交付。
- 新建/打开是文档边界；保存不是删除历史的理由。工程修改必须进入 store 事务，不直接改引用或 DOM 充当持久化。
- 类型检查、自动集成、真实浏览器、真实 Electron、实际 PDF、已发布附件分别报告。不能用其中一项代替其他五项。
- 提交、推送、合并、打包、安装、公开发布需要对应任务授权；不因为“优化”就自动发布。

## 2. 安装与完整基线

CI 使用 Node.js 22。`jsdom` 当前锁定版本要求较新的 Node，建议 Node 22.13+；不要只写“Node 18+”。纯源码测试不需要下载 Electron 二进制：

```bash
npm ci
npm run typecheck
npm run build
npm run test:core
```

`test:core` 当前顺序执行43套源码专项，包含恢复、工程落盘、保存 IPC、写作派生、模态/菜单与工程/显示/IPC安全检查；任一异常退出、被信号终止或超时立即失败。它不包含原生 Electron 或系统剪贴板实测。两条 CI 也列出这些检查。新增核心测试时同步维护 runner 和两条 CI，不只写在文档里。

快速定位可分别运行：

```bash
npm run test:editing
npm run test:quotes
npm run test:clipboard
npm run test:history
npm run test:input
npm run test:files
npm run test:smarttype
npm run test:search
npm run test:board
node scripts/autosave-recovery-test.cjs
node scripts/project-save-test.cjs
node scripts/project-save-ipc-test.cjs
node scripts/writing-derivation-test.cjs
```

不要通过修改旧断言、减少样本、关闭检查来使失败消失。新增测试若预期有误，应解释依据、保留真实行为，不宣称修复了不存在的运行错误。

## 3. 数据流和模块边界

```text
键盘/选区/菜单/卡片手势
          ↓
Editor / ScriptBlock / useCommands / 各视图
          ↓
store：不可变修改 → 历史事务 → project + version + dirty
          ├─ 编辑 DOM 与稳定 ID/光标恢复
          ├─ 派生场景/人物、按需统计与分页
          └─ 自动保存 / 文件序列化 / 导出
```

工程模型是事实来源；DOM 是正在编辑的投影，必须与模型一致。普通输入及 IME 中内容已相同就不要重写 DOM；结构修改、撤销和重做后即使正文仍聚焦也必须同步。

| 职责 | 主要位置 | 不应承担的职责 |
| --- | --- | --- |
| 状态、历史、不可变写入 | `src/store/store.ts` | 原生 DOM 历史、实际文件 I/O |
| 元素/场景/人物派生 | `src/model/project.ts` | 卡片 UI 状态、直接改正文 |
| 编辑事件、选区操作 | `Editor.tsx`、`ScriptBlock.tsx` | 另建历史栈、绕过事务写 DOM |
| SmartType候选与明确接受 | `src/model/smarttype.ts`、`Editor.tsx`、`store.commitSmartType` | 首字擅自改类型、确认顺便切段、逐次setText/setType制造两次撤销 |
| 智能双引号输入投影 | `src/utils/smartQuotes.ts` | 全文标点校正、HTML 属性替换、重整粘贴/手动引号 |
| 统一撤销入口、临时光标书签 | `src/utils/editHistory.ts` | 记录用户内容到外部、序列化焦点 |
| 剪贴板投影/安全内部格式 | `writingSelection.ts`、`writingClipboard.ts` | 复制 ID、素材、关系和修订元数据 |
| 文字/光标偏移 | `src/utils/dom.ts`、`src/model/search.ts` | 偷换统计和分页的文本口径 |
| 文件命令、保存协调 | `src/app/useCommands.ts` | 把外部 FDX/TXT 原文件覆盖为 zhsp |
| 最新恢复点与独立反馈 | `src/app/autosaveStorage.ts`、`autosaveSubscription.ts`、`recoveryStatus.ts` | 清 dirty、记录多份含图历史、代替磁盘保存 |
| 工程原子落盘与上一版备份 | `electron/projectSave.js`、`electron/main.js` | 渲染器直接写文件、先截断原稿、隐瞒失败 |
| 只读写作派生与候选目录复用 | `src/model/flow.ts`、`src/model/smarttype.ts` | 改变工程格式、重写分页、使用旧缓存吞掉新改名 |
| 工程格式兼容 | `src/io/zhsp.ts` | 自动迁移用户坐标、吞掉已知字段 |
| 分页与 A4 投影 | `PaginationProvider.tsx`、`PreviewView.tsx` | 用自由板布局重排剧本 |
| 原位创作 PDF | `src/io/creativePdf.ts`、`electron/pdf.js` | 把图片挪到文末、巨型 data 页面 URL |
| 自由板手势、坐标隔离 | `BoardView.tsx`、`boardWorkspace.ts` | 偷改写作图片的 x/y |
| 故事板归幕与排序 | `CardsView.tsx`、`storyboard.ts` | 把“未归幕”当移动正文命令 |
| 只读统计分析 | `ReportsView.tsx`、`reports.ts` | 每字运行未显示的统计页、修改工程 |
| 原生桥接与权限 | `src/io/native.ts`、`electron/` | 从渲染器直接访问文件系统 |

表中未标完整路径的组件在 `src/components/`，模型在 `src/model/`，工具在 `src/utils/`。

### ID 和临时状态

- 正文元素 `ScriptElement.id` 与场景元数据 `SceneMeta.id` 不是同一个 ID。素材关联须兼容规范场景 ID 与旧场次元素 ID。
- 关系线有 `scene:` / `beat:` 前缀；切前缀长度分别是 6 / 5。不要用同一 slice 长度处理。
- 删除场次标题时清理元数据、关联与孤儿线，不误删保留的素材内容、图片和坐标；撤销完整恢复。
- `documentEpoch` 在新建/载入时改变，即使加载的工程 ID 相同，也能阻止旧异步结果写入新文档。它和选择、焦点、光标书签不写进 `.zhsp`。
- 自由板素材位置写 `boardX/boardY`，缺失时只显示回退到旧 `x/y`。写作素材和创作 PDF 继续使用 `x/y`；切板/网格开关不补字段。尺寸 `w/h` 仍按既有工程语义保存，不另做隐式迁移。

## 4. 写作撤销：唯一事实来源

### 事务边界

- 保持现有 **120 个独立事务** 的内存上限；不是无限历史，也不是只能撤销几次。超过上限才丢最早事务。
- 同段文字输入：间隔小于 1500ms 可以合并，但一个连续输入组最多 5000ms。超过绝对窗口必须另起一组，避免长时间打字始终只有一步撤销。这是本项目的策略，不声称 Final Draft 使用相同时间常数。
- 点击/移动光标、聚焦/离开、组合输入开始/结束、格式修改、剪切/粘贴、结构修改都划清合并边界。
- `breakHistoryGroup()` 只重置合并窗口；不设 dirty、不改版本、不增加快照。
- 复制、查找、选中、无效 ID 和无变化操作不能消耗历史、抹掉 redo。
- 段中 Enter、跨段替换/剪切/删除、多段内部粘贴、合并前后段、批量删场、卡片组拖动分别是原子操作。
- 无效/乱序/重复/不连续的范围 ID 必须拒绝，不能把间隔中的未选正文删掉。
- 正文快速 `setText` 与通用 `mutate` 共用提交规则。快速路径只复制当前段落和元素数组，不复制含图片的整个工程；历史快照严禁原位修改。

### 输入入口不能混用

快捷键、工具栏、原生菜单 IPC 和 `beforeinput(historyUndo/historyRedo)` 全部调用 `runEditHistory()`。正文 contentEditable 不得调用浏览器原生 Undo，避免模型已经恢复、屏幕却留下另一份 DOM。

少量未提交的 UI 草稿（自由板标题/关系备注、角色改名、查找框）使用 `data-native-edit-history` 标记并只执行本地原生历史，不顺便撤销正文。其他绑定模型的输入仍归工程事务。

工具栏保留正文焦点。仅操作前焦点属于正文时恢复光标；不能从卡片或对话框抢焦点。书签按不可变快照弱引用记录，Enter 撤销回原段、重做回恢复的新段，不把书签写入项目。

### SmartType接受事务（2026-10-08契约）

新空段的直接输入会话可推荐人物/镜头/转场/场次，不要求先选类型；目录仅来源于内置词库和当前工程。候选查询不改工程，完整姓名与长前缀同时可选、exact优先。已有正文、粘贴、拆行的非空尾文及双列不进入新跨类型模式；没有匹配候选才保留原保守识别回退。

有候选时Enter只确认并留本段，再按一次Enter按原类型规则切段；鼠标/右箭头同样只确认。同类型空格补字段保留，跨类型意图候选不抢空格。接受后用段ID/epoch/HTML/类型记录瞬时抑制，未新输入不得自动重弹相同候选；Esc同时清候选、会话和旧场次前缀，取消后不能经旧识别器暗改类型。Tab/Shift+Tab只做九类循环且保原光标，Shift+Enter不改变。中文组合期、`keyCode=229`、修饰键、非折叠或段中选区不能接受。

Editor接受前核对DOM/光标、原HTML/类型、documentEpoch和候选目录身份；来源改名、类型变更、排序、删除、撤销、活动段排除及文档边界变化使旧目录/候选失效。缓存和会话不持久化。`store.commitSmartType(id, expectedText, expectedType, html, targetType, expectedEpoch)` 再次校验模型与epoch，只允许明确的四类目标转换，拒绝双列跨类型。它调用一次通用不可变事务，同时提交text/type，不能替换成独立setText再setType；撤销/重做同进同退。无变化或拒绝不清redo、不增dirty/version/历史，仍切断打字合并窗口。保焦用稳定ID的requestFocus，不能对可能已被场号包装替换的旧DOM补写。

此契约经用户明确批准，覆盖旧“仅当前字段推荐、Enter确认立即下一段”的要求；历史日志与旧验收不能作为回退依据。专项模型/UI检查之外，固定原生`smarttype`模式必须验证确认/二次Enter、Esc、菜单点击、连续正反Tab、撤销重做及组合事件。真实macOS中文输入法需另外验收，不能把合成CDP事件写成系统输入法已通过。

## 5. 剪贴板契约

- 对外同时提供普通文本和基础 HTML；只投影选中的正文，不复制场号包装或编辑器按钮。
- 软件内部格式为 `application/x-guangying-script+json`，版本 1，仅含片段 `type/html`。不含元素 ID、双列标识、修订、图片、场景关联和关系线。
- 内部多段粘贴保留元素类型与 `b/i/u/strong/em/br` 基础格式，插入段使用新 ID；单片段仍保留目标元素类型，不把目标强制改成来源类型。
- HTML 通过惰性模板与白名单清洗：不带属性，不执行脚本，不引入外部图片；非法内部载荷回退字面纯文本。当前限额：载荷 200 万 UTF-16 单位、单片段 20 万、最多 5000 片段。
- 外部纯文本继续沿用已有目标类型与软换行策略，不在粘贴时猜测类型或强制拆成场景；`< > &`、emoji、CRLF 按文字处理。
- 空载荷不会删除当前选区；选区范围替换只提交一次。剪切删除、随后粘贴分别可以一步撤销，重做不重复生成文本。
- IME组合期阻止原生剪切/粘贴绕过事务。不连续或视觉顺序与模型不一致的双列跨栏范围拒绝修改并提示分栏/多选段落；不放松连续校验来误删未选内容。
- 系统剪贴板的私有内容不属于测试素材。测试前请用户复制无隐私占位文字；不要备份/读取用户原有剪贴板来“保护它”。内存 DataTransfer 自动化不等于原生剪贴板验收。

## 6. 异步文件与素材边界

- 手动保存捕获不可变 project 和 documentEpoch，禁止同时发起多个保存。取消、错误、成功都释放 in-flight gate。
- 保存期间继续写字：已写入的旧快照可以成功，但当前新修改仍 dirty；不能错误显示全部已保存。
- 保存期间切文档：旧结果不能修改新文档的路径/dirty。同 ID 重载也按 epoch 拒绝。
- 另存为后的文件路径也触发自动保存；已有正文timer继续按原截止时间读取最新路径，不被路径变动推迟。timer已完成时才另设900ms任务。
- 打开结果载入前检查当前dirty并确认丢弃，包括对话框等待期间的新修改；取消不动工程/历史。文档epoch变化或已有更新的打开请求，旧结果不得覆盖新稿。
- FDX/TXT/MD 的“打开”是导入，不能绑定源文件为 `.zhsp` 保存目标；第一次保存应选择新 `.zhsp` 路径。真正 `.zhsp` 保留路径关联。
- 图片读取异步完成前文档若已切换，丢弃该结果；不把旧图片塞进新工程。
- 文本类导出只运行选中的一个转换器，不预先计算其他三种格式。純文本导入与 HTML 导出文字必须转义，不能解释作者写的标签为网页代码。
- 自动保存保持既有约900ms停笔调度和文件关联，连续修改增加约30秒最长等待；不能用本轮“优化”延迟已有任务或换用户数据目录。
- 自动保存恢复不是“已写入磁盘”的证明。旧载荷没有可靠保存状态，恢复后保守设dirty直到显式成功保存；无可用载荷时使用干净空白模板，但损坏原始字符串必须保留并提示，不得静默覆盖。不伪造撤销历史。
- 创作版原位 PDF 与 A4 纯文本是独立通道。修改任何一条后都需要真实输出检查，不只看传输 mock。

### 自动恢复、草稿与关闭

自动恢复仅保留最新一份快照，不增加多份含图历史。订阅读取最新 project/path；900ms trailing 与30秒最长等待共用调度，文档epoch变化重新界定任务，cleanup只取消而不写旧稿。`pagehide` / `beforeunload` 会尝试 flush，但不能把这当作磁盘工程保存。

状态栏的恢复点待更新、成功时间或失败由独立 UI store 驱动，不写进工程和撤销栈。存储不可访问、JSON/载荷异常、容量或写入失败须明确提示。坏当前载荷先逐字保留到专用槽；槽已含另一份坏载荷或保留失败时拒绝覆盖原载荷。正常写入仍只存一份最新快照，旧命名空间不删除。

关闭保护检查 dirty、已标记但未确认的工程草稿、保存进行中及恢复 flush 失败；原生提示默认“继续写作”。搜索和筛选等非工程草稿不冒充待保存正文。测试夹具不得移除 `beforeunload` 或忽略产品保护来声称关闭通过。

### `.zhsp` 落盘与耐久性

`electron/projectSave.js` 在目标同目录独占创建临时文件，写入、文件 fsync 后 rename；已有目标先复制为同目录 `<文件名>.guangying-backup`。成功时备份为替换前版本；若最后目标rename失败，当前工程仍原样，但备份可能已更新为与当前工程同版本，不保证失败后仍有更早历史。目标/备份须为常规文件，身份变化、只读目标、符号链接及不安全备份关系拒绝写入。按规范化目标排队；异常只清理本次创建的临时文件，不扫目录、不先删原稿。

保留普通 POSIX mode，**不保留全部 ACL/xattr 元数据**；这不是跨进程文件锁，也不承诺所有文件系统断电无损。目标 rename 成功后，目录 fsync 不支持或失败返回耐久性警告，不能把已经提交的文件假报为保存失败。主进程保存 IPC 等待真实结果，取消/失败不清 dirty；错误只暴露必要阶段/代码，不回显工程文本、图片或任意底层路径信息。

### 写作派生复用的限度

`deriveWritingElements` 以不可变元素数组为键，共用索引与 CONT'D 判断；设置开关仍在渲染时应用。SmartType reader 以来源字段和活动元素排除规则比较候选目录，动作/对白改动复用解析结果，来源改名/类型/顺序/删除/撤销须失效。缓存是只读运行时投影，不写进工程或历史，不修改 Tab/补全语义。

此次未重写分页算法、隐藏排版测量或导出等待，不应描述成“所有输入工作都为O(1)”或“已解决所有长稿卡顿”。真实长稿、含大图恢复写入及平台输入法仍需分别量测。

## 7. 改什么，额外测什么

所有改动首先通过完整基线，下面是定位和人工补测重点：

| 改动 | 专项 | 实际操作 |
| --- | --- | --- |
| 文字/历史/快捷键 | editing、smartquotes、history、input、clipboard-format、clipboard-ui、writing-range-integrity、native-draft-history | 连续 Undo/Redo、段中 Enter、剪贴板、中文 IME、原生菜单 |
| 保存/打开/异步素材 | file-commands、autosave-path、autosave-recovery、project-save、project-save-ipc、zhsp-compat | 独立用户目录保存、取消/失败、保存中编辑/切稿、恢复点失败、关闭提示、重启恢复 |
| 自动补全 | smarttype、smarttype-ui、writing、smarttype-electron | 空段跨类型/两次Enter、9 次以上 Tab 正反循环、候选/Esc/IME/光标非段尾、目录变化与单次撤销 |
| 查找 | search、search-ui | 格式/软换行/emoji 命中、定位、高亮不入导出 |
| 自由板 | board-workspace-model/UI、board-polish、scene-notes | 拖动、缩放、磁吸、连线备注、多选、Delete、撤销 |
| 大纲/故事板/幕 | outline-reorder、storyboard-drop、storyboard-acts | 多场双向排序、归幕/未归幕、折叠/空幕、多选和撤销 |
| 分页/PDF | pagination-safety、pdf-transport | 真 PDF 大图与长稿、图文原位、A4、双列、续页 |
| 派生/统计/外观 | writing-derivation、source-integrity、reports、appearance、studio-theme、progress-bands | 长稿、改名/撤销/切稿缓存失效、日夜、长标题、目标比例/跳转、统计同步 |

`smoke` 使用唯一临时壳 manifest 与临时 userData，不改仓库 `package.json.main`。本轮分层结果见 [RELIABILITY_QA_20261007.md](RELIABILITY_QA_20261007.md)；脚本存在、语法/VM检查或源码37套检查本身不能证明实机通过，真实输入法/文件对话框等待验边界单独列出。

`native-acceptance-launcher.cjs` 只接受固定 QA manifest 和 manual/editing/smarttype/input/pdf/search/image 白名单模式；新增 `smarttype` 固定映射到 `scripts/smarttype-electron.cjs`，不允许外部任意入口/renderer路径。manual壳加载当前候选主进程，使用独立临时userData和合成工程。其余夹具由 `native-fixture-window.cjs` 在React挂载前加载合成种子；恢复检查使用同入口/partition且不重新种子化。销毁测试自有窗口只用于夹具清理，不能冒充真实关闭确认验收。CDP输入法事件、内存DataTransfer复制/粘贴和自动文件drop，分别不能代替原生中文输入法、系统剪贴板和Finder手势。不要直接运行旧安装包测试用户窗口；老 `capture/integration` 仍须逐项审查入口/目录。

2026-10-08本轮最终37套源码退出0（SmartType模型132、UI511），675项发布安全断言单独通过；六组真实Electron SmartType/editing/input/search/image/PDF退出0。图片实际保存模型和可见正文快照严格等值；PDF原位图/声卡、A4及长段250/双列170标签完整各一次。包白名单、独立空白启动、DMG与桌面包全树核验通过；逐页目视范围、真实IME/跨机等未验收边界见 `SMARTTYPE_QA_20261008.md`，不以旧绿灯代替本轮结果。

## 8. 构建、打包与发布

开发HMR设followSymlinks:false，并用lstat忽略函数剪掉符号链接入口，避免macOS初扫仍递归进入链接后代；本仓库顶层release、release-*、tmp及.app根和后代在更早阶段忽略，Vite默认的.git/node_modules/构建输出忽略保留。过滤前底层可能解析链接目标元数据，不能声称完全不访问target；保证的是不递归扫描其后代。禁止用全局 `**/tmp/**`，否则临时测试仓库源码也会被吞掉。`node scripts/dev-watch-test.cjs` 用独立合成目录验证源码真实HMR、产物剪枝及外部链接后代无登记/事件；这不属于37套正文回归。未来外部symlink源码的HMR需单独设计受控监听，不能恢复任意链接遍历。

alpha.18.12公开tag固定于 `775acd8fa5e144944670c76551ac94ca474d0edf`，两个附件SHA见 `RELEASE_ALPHA_18_12.md`。此后的开发监听/文档维护不重打或覆盖这些附件；构建产物须仍逐字节相同，不伪称新生产版本。

`npm run build` 仅构建 renderer。`bash package.sh` 在完整、可信的 Electron 运行时下生成应用/ZIP；现有 macOS CI 另生成 DMG 并上传 Release。三个步骤都不应自动替换现用应用。

打包必须按明确白名单收集 renderer、Electron 主进程、资源与必要 manifest；测试工程、`tmp/editing-review/`、截图、用户文件和自动保存不进入应用。复核包内初始模板和资源，再分享。

ad-hoc 本机签名不等于 Apple Developer ID 签名/公证；本机能打开不等于他人电脑都能打开。遇系统恶意软件拦截，记录事实，不自动清 quarantine、关闭 Gatekeeper 或重用被隔离的二进制。

### 已有版本的安全重复执行（2026-10-07）

`scripts/release-assets.cjs` 仅管理发布附件，不进入生产应用。标签推送先解引用 Git tag 并核对本次完整源码SHA；新版本只在Release接口明确404时创建草稿，保持prerelease且不设置latest。已有公开/草稿版本的必需ZIP与DMG若上传完成、大小和SHA-256元数据有效，直接只读跳过，不重建、不覆盖附件、不改说明或公开状态。已有附件缺失/重复/未完成、接口/鉴权/网络异常或非法响应均明确失败，不自行补包或删除附件。

新草稿上传前验证全部本地附件，每件上传前重新检查草稿ID与状态，结束核对远端大小及digest；不使用`--clobber`。同标签concurrency只串行此工作流，不能锁住外部CLI/网页操作，不能声称GitHub多次接口调用具有原子性。

两条CI均运行独立离线专项 `node scripts/release-assets-test.cjs`（675项断言），与37套应用源码回归分开计数。工作流的手动`workflow_dispatch`只接受已存在tag的只读核验，跳过依赖安装、打包及上传。旧tag绑定旧workflow的失败记录保留，不移动tag来改变历史；修复合并后可从默认分支触发新的只读核验。

alpha.18.11的安装包与tag固定来自`7d92d5953c4e2463f21430651d060409564c9e39`；后续发布流程/文档维护不替换这组已验收附件。合并PR更新默认分支与公开Release是两项独立操作，完成后分别核对，不以发布安装包冒充已经合并。

## 9. 已知后续工作（不要混进小修）

- CONT'D 与元素索引重复推导已加入共享只读派生，快捷输入目录也有来源字段复用；分页隐藏测量仍有全局重算空间。先用合成长稿分析，再保护排版就绪/字体等待/导出，不凭猜测重写。
- `.zhsp` 富文本兼容与主进程 IPC 安全边界需要专门审查；本轮剪贴板白名单不等于整个导入面已消毒。
- 侧栏属性的直接归幕和故事板正式幕整块移动存在不同入口语义，后续统一前先明确用户规则并做全路径测试。
- 双列修改单元素列归属后，DOM顺序可能不同于正文数组；本轮拒绝危险跨栏范围并提示安全替代，未重写双列布局/复制顺序。全面支持这种选择需要独立设计。
- 智能双引号的旧 HTML offset 奇偶算法已在后续独立候选中替换。新逻辑只识别本次输入，不重整旧正文、粘贴与手动引号；未知 metadata、词内/尺寸孤立引号保留，自动配向仅单层，不自动嵌套或补配对。真实中文 IME 仍需验证，不能用合成 composition 断言代替实机输入法。
- 自动恢复失败反馈与坏载荷保护已加入当前候选；含大图的存储容量、序列化/写入耗时和历史内存成本仍需实际量测。不把120快照上限简单加大来掩盖问题。
- 中文 IME、原生菜单/系统剪贴板、真实 Electron 与真实 PDF 仍需各自验收。本轮浏览器/自动测试证据不推广为所有平台稳定性保证。

“核心代码保护”靠清晰契约、自动回归、审查和必需 CI，不是设文件只读或锁哈希。可以修错误，不可未经认可改功能语义。
