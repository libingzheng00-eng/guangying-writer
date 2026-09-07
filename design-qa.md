# 日间工作台视觉核对

## 比对对象与状态

- 用户视觉目标：
  - `/var/folders/ln/9kx_scj10zd4zmbznrs9jmj40000gn/T/codex-clipboard-ee408966-4b87-4608-a992-280de47648c9.png`（自由板日间状态，含深色元素类型框和关系备注问题）。
  - `/var/folders/ln/9kx_scj10zd4zmbznrs9jmj40000gn/T/codex-clipboard-bf983461-1caf-42b8-bea5-8d4a9b068da6.png`（设置弹窗日间状态）。
- 实现截图（Chrome 本地预览、日间模式、756 × 413 CSS 像素）：
  - `/private/tmp/mochang-ui-alpha12-day.png`：写作页与进度区。
  - `/private/tmp/mochang-settings-alpha12-day.png`：设置弹窗。
  - `/private/tmp/mochang-board-note-alpha12-day.png`：自由板关系备注。
- 所有截图按同一浏览器密度采集；示例工程内容不同，仅比较控件结构、颜色与层级。

## 比较与修正

- [P1，已修正] 日间模式的元素类型选择框仍是黑色。
  - 证据：实现截图中该选择框为白色背景、深灰文字。
  - 修正：为 `.type-select` 加入日间表面、边框与文字颜色。
- [P1，已修正] 自由板关系备注仍是黑色悬浮条。
  - 证据：实现截图中备注条为白灰底、深色文字和低对比边框。
  - 修正：为 `.board-link-note`、输入框和删除按钮补齐日间样式。
- [P1，已修正] 设置弹窗及表单仍显示夜间黑色表面。
  - 证据：实现截图中弹窗、标题、标签、输入框和遮罩均为日间状态。
  - 修正：为弹窗、表单、标签和按钮补齐日间规则。
- [P2，已修正] 当前页文案冗余、右侧目标页未与两组素材控制对称。
  - 证据：实现截图仅显示 `1/100`；目标页数位于两个素材控制组的正上方。
  - 修正：移除“当前页”和单位文案，工具区改为居中纵向布局。
- [P2，已修正] 场景色带颜色偏灰绿，与日间纸面不协调。
  - 证据：实现采用统一雾蓝十阶配色，深浅模式中保持可读。

## 必要表面检查

- 字体与文案：日间控件均为深灰正文、蓝色激活态；当前页仅保留数字关系。
- 间距与布局：目标页数在素材控制正中上方，左右信息在进度区垂直居中。
- 颜色与令牌：选择框、关系备注、弹窗及场景色带均已使用日间令牌。
- 图像与素材：未新增或替换图像资产；原有图片卡内容与裁切逻辑保持。
- 可用性：目标页输入、素材显隐/新建、关系备注编辑、设置标签页均保持原行为。

## 最终结果

final result: passed

## alpha.13 进度条与板块视觉核对

- 参考截图：
  - `/var/folders/ln/9kx_scj10zd4zmbznrs9jmj40000gn/T/codex-clipboard-4444c70c-193a-4fd5-a60a-d18499259cd7.png`
  - `/var/folders/ln/9kx_scj10zd4zmbznrs9jmj40000gn/T/codex-clipboard-93d6e974-da3d-4ff9-8c6c-6ec71218be71.png`
  - `/var/folders/ln/9kx_scj10zd4zmbznrs9jmj40000gn/T/codex-clipboard-20726e9d-c0dc-434e-b22c-0ddc117a2ea1.png`
- 本地 Chrome 实机截图：
  - `/private/tmp/mochang-alpha13-writing-day.png`
  - `/private/tmp/mochang-alpha13-board-day-v2.png`
- 已核对：当前页仅显示 `1/100`，手写风格数字跨进度轨道两行居中；自由板顶部三分区和颜色工具区已进入 DOM 并使用日间对比度；卡片关联选择区和关系备注样式已按标注图调整；故事板卡片尺寸规则已放大。
- 代码级验证：typecheck、build、render、writing、zhsp 兼容、history 全部通过。
- 备注：Chrome 隔离页中的空白样本没有关系线和灵感卡，因此关系备注与卡片浮动按钮的最终像素位置仍需在含真实自由板卡片的工程中复核；不会读取用户剧本来做此注入。
