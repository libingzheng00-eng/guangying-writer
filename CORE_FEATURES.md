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

## 三、创作素材与 PDF 导出

- 自由板提供灵感卡、声音卡、图片卡；图片只有一套 `image` 卡，不再新增重复的“写作图”类型。**写作面板必须继续支持把本地照片直接拖入，生成这同一套 `image` 卡；删除重复按钮不等于删除拖入入口。**
- 旧工程的 `wimg` 必须读取为 `image`，并保留图片、标题、备注、位置、尺寸。
- 图片拖入必须接管正文上的文件 drop，不能将图片插入正文元素；关闭声音卡不能隐藏图片。读取失败不创建空卡，读取成功后一次撤销能完整移除新卡；滚动后落点与画布右边缘必须实测。专项脚本：`scripts/image-drop-electron.cjs`（独立临时用户目录，真实 Electron 文件拖放测试）。
- **PDF 红线（用户明确纠正）**：创作版必须所见即所得，按写作画布的实际位置保留正文、图片、声音卡；第五场旁边的参考图仍在第五场旁边。禁止统一移动到文末、生成独立素材附页或另行配对。创作版采用数字画布尺寸，不强制 A4；超长画布切页不可切断卡片或重排其与正文的位置关系。
- **纯文本打印版**独立按 A4 分页，保留剧本格式且不包含素材卡。导出不得改变工程纸型、卡片坐标、正文内容或撤销栈。
- 两种导出均等字体与排版就绪；创作版还须等图片解码。缺少 MIME 但可解码的图片也必须保留；损坏图片至少保留原位卡片标题和备注，不得静默丢卡。专项脚本：`scripts/pdf-layout-electron.cjs`，需实际输出 PDF 后检查第五场图文位置和 A4 纸型。

## 四、故事板与自由板

- 故事板卡片支持排序、修改标题/梗概/颜色，并能稳定拖入某一幕归幕；一次拖拽只产生一次状态变更与一次撤销记录。
- 自由板支持场景卡、卡片连接线、可编辑关系备注、卡片缩放与尺寸持久化。
- 自由板支持 ⌘/Ctrl 多选、Shift 范围选、框选、批量删除；删除需同时清理孤儿关系线，但不能误删未选卡片的关系。
- 场景卡的“删除整场”必须存在，并在可撤销的单次操作中处理正文、场景元数据、关系线与关联卡的解除关联。

## 五、结构、统计与界面

- 目标页数、单一打字机指针进度、按场景篇幅的色带与精确跳转保持可用。
- 统计页角色改名必须同步正文人物元素。
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
node scripts/pagination-safety-test.cjs
```

涉及写作交互、导出、拖拽或主题时，还要在真实浏览器或 Electron 中做一次人工验证；自动测试通过不等于视觉与鼠标手势已经验收。

## 七、保护入口与变更要求

| 行为契约 | 关键实现位置 | 回归入口 |
| --- | --- | --- |
| Tab 焦点闭环、备忘往返、正文 Shift 多选 | `src/model/flow.ts`、`Editor.tsx`、`ScriptBlock.tsx` | writing / render / 实机连续 Tab |
| 拖入图片、原位卡片创作 PDF、A4 纯文本 | `Editor.tsx`、`src/io/creativePdf.ts`、`useCommands.ts`、`PreviewView.tsx`、`PaginationProvider.tsx`、`electron/pdf.js` | image-drop-electron / pdf-layout-electron / pagination-safety / PDF 渲染检查 |
| 选择、归幕、删除、撤销重做 | `store.ts`、`selection.ts`、`board.ts`、`BoardView.tsx`、`CardsView.tsx` | history / writing / render / 实机拖放 |
| 工程兼容、空白启动、保存恢复 | `src/io/zhsp.ts`、`src/model/sample.ts`、`src/App.tsx`、`electron/main.js` | zhsp-compat / core-guard / 隔离用户目录启动保存重开 |
| 场景进度与跳转、角色改名同步 | `ProgressBar.tsx`、`progress.ts`、`ReportsView.tsx`、`store.ts` | writing / render / history / 实机跳转 |

表中未写完整路径的组件位于 `src/components/`，模型位于 `src/model/`，`store.ts` 位于 `src/store/`，`useCommands.ts` 位于 `src/app/`。测试入口名称对应 `scripts/` 中同名 `*-test.cjs` 或 `*-electron.cjs` 文件。

这些代码不是只读文件，也不做哈希“锁死”：修复错误必须可以改。任何改变上述行为的设计决定，须先征得用户明确认可；维护者不得靠删断言或关 CI 来掩盖回归。`AGENTS.md` 给 AI 明确约束，`core-checks` CI 自动运行基线；必须由管理员另外设为受保护分支的必需检查，才能强制阻止未通过检查的合并。

`core-guard` 检查 Git 跟踪路径中的工程/导出/自动保存/大文件风险，并实测空白模板和 Tab 类型契约。可对明确的 `Contents/Resources/app` 打包目录附加检查；不会读取个人目录，也不会扫描旧 Git 历史。它不能识别任意字符串是否为用户剧情，不能代替人工源码/产物隐私审查。测试源码允许合成场景、角色与图像；用户真实剧本任何部分都不能当测试夹具。
