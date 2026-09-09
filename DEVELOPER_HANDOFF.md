# 光影写手源码接手摘要

更新时间：2026-09-09（alpha.18：PDF 素材附页、写作 Shift 多选、故事板归幕修复与正式更名）

## 版本边界

- 本仓库是 `v1.3.0-alpha` 源码回迁工程，不是当前完整稳定版。
- 用户本机当前可用成品是 `/Applications/墨场 1.2.9.app`；绝不修改或覆盖它。
- 完整成品补丁及视觉验证在本机 `../release/Mochang-macOS-arm64-v1.2.9/开发补丁/`；GitHub 克隆中不会包含该成品目录。

## 已回迁的源码能力

- 统计区块标题层级。
- 统计页角色改名并同步正文人物元素。
- 自由板关系线、可编辑备注和删除。
- 目标页数输入与按目标比例计算的单一打字机式进度条。
- 自由板三分区、统一选择 ID、多选 / 框选 / 场景与卡片批量删除、全卡片缩放与撤销安全。
- Tab 九类元素循环、自动识别、同人物 `(CONT'D)` 视觉标记。
- 日间模式顶栏、设置、统计、自由板与侧栏收起布局。

## 仍需完成

- 逐项对照 [MIGRATION.md](MIGRATION.md) 回迁完整 v1.2.8/v1.2.9 行为。
- 当前真实 PNG 打字机指针位于 `src/assets/typewriter-pointer.png`，由 `ProgressBar.tsx` 使用；不要重新放回 `StatusBar.tsx`。
- 当前版本为 `1.3.0-alpha.18`；完成全部回归后再改为正式 `1.3.0`。
- 新建候选安装包，绝不覆盖用户现用 v1.2.9。

## 隐私红线

- `src/model/sample.ts` 现在只创建空白“未命名剧本”。
- 测试数据只能使用 `scripts/render-test.cjs` 中的“角色甲/测试地点/测试卡片”等合成内容。
- 禁止提交或打包任何 `.zhsp`、真实人物名、剧情正文、自由板梗概、导出 PDF 或用户自动保存目录。
- 注意：旧 Git 提交可能仍含已删除的旧示例正文。普通提交不会清除历史；如需彻底移除，必须取得用户对历史重写和 force-push 的明确授权。

## 当前验证

以下命令是当前回归基线：

```bash
npm run typecheck
npm run build
node scripts/render-test.cjs
node scripts/writing-test.cjs
node scripts/zhsp-compat-test.cjs
node scripts/history-test.cjs
```

`npm run test:render` 在本机沙箱偶尔会被 SIGTERM 137 终止，使用上面的 `node scripts/render-test.cjs` 直调。所有测试只用合成数据。

## 当前写作辅助约定

- 场次标题回车后必须进入「动作」（画面/环境描述）；动作连续回车保持动作；人物回车进对白；对白回车进人物。
- **写作红线——Tab 焦点闭环**：`Tab` / `Shift+Tab` 只在当前行循环九类元素，永远不自动新建行，也绝不能跳到缩放、文件名或其他界面按钮。`scene_heading` 会改变场号包装结构，类型切换后必须通过 `requestFocus` 恢复同一 `contentEditable` 及原光标位置。任何涉及 `Editor.tsx`、`ScriptBlock.tsx` 或场号 DOM 的修改，都必须实测连续按 9 次 Tab 后回到起始类型且焦点仍在原段落。
- 快捷输入候选靠近当前输入行右侧：`Enter` 确认后进入符合上述规则的下一元素；空格或鼠标只确认当前行。Tab 专用于元素类型循环，不得被自动补全截获。contentEditable 聚焦时必须同时更新 DOM 与 store，否则鼠标点击会“看似无反应”。
- `Editor.tsx` 在输入时仅派发 `mochang:typing` 事件；`ProgressBar.tsx` 自己在指针 DOM 上短暂加 `.is-typing`（260ms）。严禁把动效状态保存进 `.zhsp` 或 undo 历史，也不要把它改回 Editor 的 React state，以免每次输入重绘整个编辑器。
- **PDF 红线——素材不能丢失**：`PreviewView.tsx` 的 `MaterialPage` 必须保留声音卡与图片卡的确定性附页；`useCommands.ts` 在 `printToPDF` 前必须等待图片解码。任何“只导出正文”优化都不允许删除此链路。
- **写作 Shift 多选**：仅在写作多选模式下，Shift 点击正文段落或复选框会按正文顺序扩展连续选区；普通编辑模式不得拦截鼠标、光标或键盘输入。

## 开始工作的推荐顺序

1. 阅读 `README.md`、`MIGRATION.md`、`CHANGELOG.md`。
2. 查看 `git status`，保留用户和前任留下的未提交改动。
3. 先提交空白模板、合成测试数据及交接文档。
4. 小步回迁，每项都做类型检查、构建、渲染测试和最终画面检查。
5. 发布前扫描剧本文本和工程文件，并验证全新用户目录首次启动为空白稿。
6. 遇到 `Operation not permitted` / `sandbox initialization failed` / git 提交失败等本环境特有报错，先看 [ENVIRONMENT_PITFALLS.md](ENVIRONMENT_PITFALLS.md)。
