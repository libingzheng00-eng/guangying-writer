# 光影写手：当前状态与接手指南

更新：2026-10-13 · 源码版本 `1.3.0-alpha.18.17`（分支 `feat/character-lines-20261009`，尚未合并 main，也没有发布 Release）。
以前各轮的详细交接日志在 [docs/archive/DEVELOPER_HANDOFF_HISTORY.md](docs/archive/DEVELOPER_HANDOFF_HISTORY.md)，只做追溯，不作为当前规则。

## 接手先读

1. [AGENTS.md](AGENTS.md)：隐私与协作约束。
2. [CORE_FEATURES.md](CORE_FEATURES.md)：哪些行为不能随意改，以及对应的测试入口。
3. [docs/MAINTENANCE.md](docs/MAINTENANCE.md)：模块边界、撤销事务、剪贴板、保存与发布流程。

## 版本状态

| 版本 | 状态 | 内容 |
| --- | --- | --- |
| alpha.18.15 | 最新公开 Release | 启动页、最近项目、写作位置、旧关系线兼容 |
| alpha.18.16 | 已合并 main，未发布 | 改稿工作台、用户说明书 |
| alpha.18.17 | 已合并 main，未发布 | 人物线、查找替换、导入选项、新版字段保留、PDF 竞态修复、文档整理 |
| alpha.18.18 | 已合并 main，未发布 | 「现代工具」外观：配色、工具栏图标、故事板卡片 |
| alpha.18.19 | 已合并 main，未发布 | 状态切片与组件拆分、并行测试；自由板缩放可输入、右上角连线钮、顶栏分隔线对齐、新图标 |
| alpha.18.20 | 已合并 main，GitHub 预发布 | 侧栏标签、自由板圆点连线 / 整卡上色 / 顶栏缩放 / 默认磁吸、写作页素材卡不超宽、默认字色 |
| alpha.18.21 | 已合并 main，随 18.22 发布 | 按 Final Draft 真实结构重做 FDX 导出 / 导入（`src/io/fdx.ts`，专项 `fdx-test.cjs`） |
| alpha.18.22 | 已合并 main，GitHub 预发布 | 拍摄稿场号 / 页码锁定、备选台词（`model/locks.ts`、`model/altDialogue.ts`、`store/slices/production.ts`） |
| alpha.18.23 | 已合并 main，GitHub 预发布 | 双语对照视图、显示译文 / 对照版 PDF、翻译技能 `skills/guangying-translate`；启动页标题区；长剧本输入与撤销内存优化（`store/structural.ts`、`model/textCache.ts`） |
| alpha.18.24 | `feat/zhsp-file-type-20261016` | .zhsp 文档图标与文件类型登记、访达双击打开（`main.js` 的 `open-file` / `finder:*`，`assets/zhsp-document*`） |

## alpha.18.17 本分支做了什么

- **人物线**（[设计说明](docs/features/CHARACTER_LINES.md)、[验收记录](docs/archive/CHARACTER_LINES_QA_20261013.md)）：只读的人物阅读视图，数据存放在可选字段 `characterWorkspace` 中，人物笔记复用普通批注。
- **PDF 导出竞态**：导出等待期间如果正文、文档或视图发生变化，本次导出会中止；A4 也改为打印冻结的分页快照，与创作版共用隔离的打印通道。修复了矮窗口里预览页被压扁、导致 A4 PDF 丢正文的问题（`.preview__page { flex: none }`）。
- **导入选项**：「导入文本 / FDX」改为应用内的具名对话框（追加 / 替换 / 不导入），Esc 等同于不导入。实现见 `src/app/choiceDialog.ts` 和 `src/components/ChoiceDialog.tsx`。
- **查找替换**：查找面板新增替换栏。`store.replaceMatches` 一次替换算一步撤销；命中原文已变化或已切换文档时，整批替换会被拒绝。HTML 替换逻辑在 `model/search.ts` 的 `replaceTextRanges`。
- **新版字段保留**：`zhsp.ts` 把本版不认识的工程、正文元素和卡片字段原样保留（工程级字段放在 `preservedFields`，保存时写回原位置）。文件里新增了 `formatRevision`；打开格式修订号更高的文件前，会先询问作者。**以后每次新增工程字段，都要把 `FORMAT_REVISION`（`model/project.ts`）加一。** alpha.18.16 及更早的版本仍然会丢弃未知字段，这一点无法通过新版补救。

## 代码地图（2026-10-13 重构后）

- `src/store/`：`store.ts` 只负责组合；`types.ts` 是状态接口，`history.ts` 放撤销、合并和改稿事务；业务操作在 `slices/`（ui、document、writing、scenes、board、review）。
- `src/components/`：每个视图一个主组件，独立部件放进子目录 `writing/`、`board/`。
- 新增功能怎么放，见 [MAINTENANCE.md](docs/MAINTENANCE.md) 的「新增功能放在哪里」。

## 验证

```bash
npm run typecheck && npm run build && npm run test:core   # 62 套，默认并行，约 25 秒
node scripts/character-lines-native.cjs --output <新的绝对路径>   # 需要 python3 + pypdf
node scripts/review-native.cjs --output <新的绝对路径>
```

PDF 和搜索的原生验收通过隐藏 QA 外壳运行，方法见 docs/MAINTENANCE.md。自动化测试不能代替真实中文输入法、物理鼠标拖放和 Windows 实机验收，这几项至今还没有人工验证。

## 已知待办

- 真实输入法、物理鼠标拖放、Windows 实机验收。
- Mac 尚未做 Developer ID 签名和公证；Windows 尚未做代码签名。
- `store.ts`（约 1,450 行）和 `Editor.tsx`（约 1,100 行）体量较大，后续可以按功能拆分。
