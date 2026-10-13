# 人物线验收记录（alpha.18.17，2026-10-13）

环境：macOS 26.6.2 arm64、Electron 44.7.0、Node 22。所有数据都是合成的，在临时 userData 中运行。

## 结果

| 项目 | 结果 |
| --- | --- |
| `npm run typecheck` / `npm run build` | 通过 |
| `npm run test:core`（58 套） | 全部通过 |
| 人物线模型 / store / 导航 / 界面 | 134 / 702 / 80 / 28 项通过 |
| 导出竞态（新增 `export-command-races-test.cjs`） | 15 项通过 |
| `character-lines-native.cjs`（隐藏窗口，两次独立进程） | 通过：保存、重开、恢复，两种 PDF 文本检查，私密标记均未泄漏 |
| `pdf-layout-electron`（隐藏 QA 模式） | 通过；长稿 250 行、双列 170 行标记在 A4 PDF 中各出现且仅出现一次 |
| `review-native.cjs` | 通过 |

## 本轮验收发现并修复的问题

1. **A4 PDF 丢正文。** 新的 A4 冻结快照读取的是预览页的计算高度。预览页是纵向 flex 子项，窗口矮时会被压扁（例如 1122px 被压成 243px），`overflow: hidden` 把后面的内容全部裁掉了。修复：`.preview__page` 设为 `flex: none`（屏幕预览也不再被压扁），`buildPrintPdf` 改用页面自身的 A4 内联尺寸。
2. **人物线页面没有铺满宽度。** 宽窗口下右侧会留出一块空白。修复：`.character-lines` 加上 `flex: 1`。
3. `menu-ui` 和 `writing-controls` 两个测试里的视图数量从 5 改为 6（新增了「人物线」入口）。

## 仍未验证

真实中文输入法、物理鼠标操作、Windows 实机、人工打开系统文件对话框。
