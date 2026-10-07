# 写作编辑与源码审查验收记录

日期：2026-10-07。对象：当前 `1.3.0-alpha.18.10` 源码的本地候选修改。不是已安装应用、DMG 或 GitHub 发布验收。

## 结论

类型检查、生产 renderer 构建及完整 **32/32 套自动回归通过**。本轮使用合成工程，没有读取/修改用户剧本，没有替换现用应用，没有 commit、push、打包或发布。

已修复反复撤销的历史分组/入口问题，强化剪切粘贴原子事务、内部格式与安全边界，并补文件保存/打开/恢复的关联保护。完整维护说明见 [MAINTENANCE.md](MAINTENANCE.md)，核心契约见 [CORE_FEATURES.md](CORE_FEATURES.md)。

## 1. 对照依据与保留差异

使用 Final Draft 官方桌面说明核对可观察行为：Undo 恢复上一步、Redo 恢复已撤销操作、无可撤销内容时禁用入口；并核对剪切/复制/粘贴的选区、插入位置、内部格式保留和单段目标类型规则。[官方撤销说明](https://kb.finaldraft.com/hc/en-us/articles/27570105148692-How-do-I-undo-changes-or-revert-back-to-the-last-saved-draft)、[官方剪贴板说明](https://kb.finaldraft.com/hc/en-us/articles/28002784585748-How-do-I-use-the-clipboard-Cut-Copy-and-Paste)。

不是逐字克隆 Final Draft：本软件已批准的九类 Tab、对白后回车到人物、外部纯文本软换行策略保持。1500ms idle / 5000ms 组上限 / 120 事务是本项目策略，不声称这些数字来自 Final Draft，也不声称运行了 Final Draft 做逐项黑盒对比。

## 2. 可复现原因与修复

| 问题 | 源码原因 | 修复边界 |
| --- | --- | --- |
| 持续输入撤销步数少 | 滚动idle合并没有绝对输入组上限 | 保留1.5秒停顿合并，新增5秒绝对组上限，长时间输入分成可恢复片段 |
| 撤销内容/焦点不一致 | 工程历史和原生DOM历史入口可能分叉；新段被撤销后焦点失去 | 统一键盘/工具栏/菜单/beforeinput；书签与稳定ID恢复，首次分行Undo回原分割处 |
| 格式/操作被前后输入吞并 | 光标/格式/组合输入边界不明确 | 显式切断合并，不制造多余工程修改 |
| 前向Delete分成两步 | 文本拼接和删除是两个事务 | 共用富文本合并，一次完整撤销 |
| 多段内部粘贴丢类型/格式 | 只有外部文本投影 | 版本1安全MIME片段，多段保留类型与基础格式，单段保持目标类型 |
| 范围可能误伤关联 | 删除heading元素ID未覆盖SceneMeta.id | 同时清理规范/旧ID关联，保留素材本体和坐标 |
| 保存完成误标全已保存 | await后仅按路径标记，不验证快照/文档 | immutable snapshot + epoch；编辑中仍dirty，旧文档回调不污染新稿 |
| 外部文件路径被误用于zhsp | FDX/TXT/MD打开保留源路径 | 导入后无zhsp绑定，第一次保存选新目标 |
| 新关联未进入恢复记录 | 自动保存只订阅version | 路径变化也保存，不推迟已挂起的正文timer |
| 搜索/筛选草稿Undo误动正文 | 未明确本地草稿的原生历史归属 | 标记Sidebar/Reports/外观草稿，项目绑定输入仍用工程历史 |
| 打开/恢复后可能丢未保存稿 | 替换不确认；旧autosave恢复被认为clean | 打开dirty替换须确认，过期/并发结果保护；有效恢复保守dirty，显式成功保存后清除 |

IME组合期剪切/粘贴阻止原生默认绕过统一处理。不连续或双列视觉/正文顺序不一致的范围拒绝修改并提示分栏或“多选段落”；没有放松连续校验，也没有宣称任意双列跨栏范围都已支持。

## 3. 最终自动回归结果

执行：

```bash
npm run typecheck
npm run build
npm run test:core
git diff --check
```

均 exit 0。完整运行日志保存在工作区外层 `审查记录/20261007-编辑验收/core-regression.log`，不打包进应用。

| 专项 | 最终结果 | 验证性质 |
| --- | --- | --- |
| editing | 145 条，failures为空 | 真Editor + store + jsdom事件/DOM |
| clipboard-format | 11 组 | 合成富文本白名单/格式/边界 |
| clipboard-ui | 89 条 / 8 组 | 真Editor + store，内存ClipboardEvent/DataTransfer |
| writing-range-integrity | 51 条 | 范围、富文本/UTF-16、关联清理、Undo/Redo |
| file-commands | 70 条 | 真命令hook，内存native bridge，不写实际文件 |
| autosave-path | 49 条 / 8 组 | 合成clock与真实store，路径/截止时间/卸载 |
| native-draft-history | 69 条 / 7 组 | 真App/视图 + 合成存储/菜单；native命令spy及恢复保护 |
| history | 42 条 | 40次独立Undo/Redo、文件边界/无变化保护 |
| input-performance | 通过 | 引用不可变、idle/绝对组阈值；600事件/60秒分12组；旧resize合并不变 |
| source-integrity | 8 组 | 派生等价、纯文本转义、HTML文字输出、smoke壳VM |
| 其余既有专项 | 全部通过 | Tab/写作、SmartType、查找、zhsp、分页/PDF传输、主题/大纲/幕/统计、自由板、进度等 |

32套集合以 `scripts/core-regression.cjs` 为统一入口；两条CI同步新增测试，但**尚未推送，不能称本轮GitHub Actions已通过**。生产输出仅index/样式/JS/打字机资源，合成浏览器夹具 `tmp/editing-review/` 已精确忽略，不进入production renderer构建。

构建仍报告既有Vite CJS API弃用提示。Node 26运行部分旧脚本有localStorage实验提示；这些提示不是本次测试失败，也不代表已消除全部依赖维护债务。

## 4. 真实浏览器已观察的行为

独立本地origin `127.0.0.1:5211`，仅种入“合成编辑验收（不含用户剧本）”。测试入口直接编译当前App/组件，不访问现用应用的用户目录或用户预览页。

- 段中Enter：原段留下前半，新段只有后半，未重复尾文；Undo恢复完整原段；Redo恢复相同新段。
- 同段10个独立输入组：真实按键输入abcdefghij后，连续10次⌘Z恢复原文；连续10次⌘⇧Z恢复最终文本；焦点始终是qa-target。
- 从general真实按11次Tab：经过note/action/character/parenthetical/dialogue/transition/shot/scene_heading/general/note/action；11次Shift+Tab返回general。每步同一ID、正文不变、caret=0，没有跳至外部控件。
- 后续分行试验：Undo返回原段，Redo回恢复的新段及此前caret=1。该试验发现首次Undo落在恢复段末尾，随后已在源码中改成原分割处并通过editing新增断言；**这最后一个光标改进没有再完成浏览器复验**。

后段浏览器重载/连接多次超时；不将超时重载、未完成按键或最终截图留档算作通过。曾观察真实页面截图，但最终文件留档未确认，本文不以模拟图代替真实证据。

## 5. 剪贴板权限与未验证项

最初备份系统剪贴板的尝试被隐私审批阻止，未执行读取。已向用户提出：先复制“光影写手测试”，再回复“可以测试剪贴板”。本轮尚未收到确认，因此**未执行系统剪贴板端到端复制/剪切/粘贴**。内存事件89条通过不等于原生剪贴板通过。

还未完成：

- 原生Electron、真实系统菜单、用户中文IME及系统剪贴板。
- 完整FD黑盒行为对照，或每种外部编辑器/浏览器提供的HTML格式保真。
- 本轮重新输出实际图文/A4 PDF，以及所有真实拖拽/屏幕尺寸视觉回归。
- 原生smoke。其临时壳隔离仅做语法/VM测试，没有绕过系统安全拦截。

没有降低安全设置、清除隔离属性、下载/替换Electron运行时，没有打开或编辑用户真实稿来补测。

## 6. 总体源码整理与后续待办

已做低风险优化：场景元数据一次索引并保持首条匹配语义；人物/计数减少重复遍历；导出只计算选中格式；纯文本导入与HTML文字转义；独立smoke壳不改仓库入口。保留既有不可变正文快速路径。

没有在这轮重写分页、PDF几何、幕管理或用户数据目录。隐藏分页测量重算、智能引号的旧方向判断、特殊双列范围语义、导入/IPC全面安全审查、自动保存容量反馈需要独立任务和实测，不应称“整体无bug”。

当前维护采用契约+自动回归+审查，不把文件设为不可修改，也不靠删测试“锁死”。最终交付仍是**本地源码候选**。
