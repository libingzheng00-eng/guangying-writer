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
| alpha.18.17 | 本分支 | 人物线、查找替换、导入选项、新版字段保留、PDF 竞态修复、文档整理 |

## alpha.18.17 本分支做了什么

- **人物线**（[设计说明](docs/features/CHARACTER_LINES.md)、[验收记录](docs/archive/CHARACTER_LINES_QA_20261013.md)）：只读的人物阅读视图，数据存放在可选字段 `characterWorkspace` 中，人物笔记复用普通批注。
- **PDF 导出竞态**：导出等待期间如果正文、文档或视图发生变化，本次导出会中止；A4 也改为打印冻结的分页快照，与创作版共用隔离的打印通道。修复了矮窗口里预览页被压扁、导致 A4 PDF 丢正文的问题（`.preview__page { flex: none }`）。
- **导入选项**：「导入文本 / FDX」改为应用内的具名对话框（追加 / 替换 / 不导入），Esc 等同于不导入。实现见 `src/app/choiceDialog.ts` 和 `src/components/ChoiceDialog.tsx`。
- **查找替换**：查找面板新增替换栏。`store.replaceMatches` 一次替换算一步撤销；命中原文已变化或已切换文档时，整批替换会被拒绝。HTML 替换逻辑在 `model/search.ts` 的 `replaceTextRanges`。
- **新版字段保留**：`zhsp.ts` 把本版不认识的工程、正文元素和卡片字段原样保留（工程级字段放在 `preservedFields`，保存时写回原位置）。文件里新增了 `formatRevision`；打开格式修订号更高的文件前，会先询问作者。**以后每次新增工程字段，都要把 `FORMAT_REVISION`（`model/project.ts`）加一。** alpha.18.16 及更早的版本仍然会丢弃未知字段，这一点无法通过新版补救。

## 验证

```bash
npm run typecheck && npm run build && npm run test:core   # 61 套
node scripts/character-lines-native.cjs --output <新的绝对路径>   # 需要 python3 + pypdf
node scripts/review-native.cjs --output <新的绝对路径>
```

PDF 和搜索的原生验收通过隐藏 QA 外壳运行，方法见 docs/MAINTENANCE.md。自动化测试不能代替真实中文输入法、物理鼠标拖放和 Windows 实机验收，这几项至今还没有人工验证。

## 已知待办

- 真实输入法、物理鼠标拖放、Windows 实机验收。
- Mac 尚未做 Developer ID 签名和公证；Windows 尚未做代码签名。
- `store.ts`（约 1,450 行）和 `Editor.tsx`（约 1,100 行）体量较大，后续可以按功能拆分。
