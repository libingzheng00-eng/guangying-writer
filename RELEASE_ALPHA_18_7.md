# alpha.18.7 输入性能核对

2026-09-10。本地候选，不代表已提交、推送、合并或发布。未安装覆盖用户现用软件，未读取/修改用户剧本。

## 实际变更

- `store.setText` 不再 JSON 深拷贝并序列化比较整个工程；只复制元素数组和当前段落。图片、设置和未变段落复用不可变引用。
- `projectChange` 为正文和通用修改共用历史提交规则；1500ms 合并边界、120条历史上限、无效/无变化操作、撤销后分支及结构修改保持原语义。通用修改继续深拷贝，禁止直接改共享快照。
- `app/autosaveSubscription.ts` 直接订阅版本，不让 App 为重置计时器每字重渲染；保持约900ms停笔保存，执行时读取最新工程与文件路径。
- 统计页面原本已经按需挂载，本轮没有重复改造。没有修改 Editor/ScriptBlock 的输入焦点事件、Tab、分页算法、导出几何、统计口径或素材/幕交互。

## 性能证据及边界

命令：`node scripts/input-performance-test.cjs --compare-ref a0dc5c3`。
同一机器、同一进程，300段，20次更新去掉前5次；合成图片字符串用于测试工程体积，不是真实图像。

| 图片数据 | 旧版 setText 中位耗时 | 优化版 setText 中位耗时 |
| --- | --- | --- |
| 0 MiB | 0.243 ms | 0.020 ms |
| 5 MiB | 7.682 ms | 0.022 ms |
| 20 MiB | 38.469 ms | 0.019 ms |

这些数字只包括数据更新，不含浏览器绘制、IME或保存耗时，不能宣称整机输入速度提升相同倍数。CI保护“不序列化整个工程”和结果等价，不使用易波动的毫秒门槛。

独立 Electron 31.7.7 的300段、小图片工程中，25个采样的输入事件到第二帧回调中位值约13.7ms→11.2ms。它受帧调度影响且只测一组，不能据此给出普遍性能承诺。大工程仍可能受全篇渲染/测量、结构修改深拷贝影响；自动保存仍为原有 localStorage 容量与同步写入机制，本次没有更换持久化方案。

## 验证

- typecheck、生产build、core-guard，以及 render / writing / history / zhsp-compat / pagination-safety / outline-reorder / scene-notes / storyboard-drop / storyboard-acts / studio-theme / appearance / reports / board-polish / writing-controls / progress-bands / input-performance 全部通过。
- 输入专项：冻结旧工程后可输入、不改未变段落或素材、无 JSON 热路径、历史快照保护、1500ms边界、120条撤销/重做、无效操作、混合修改与旧实现逐步等价、自动保存合并/清理/最新文件路径。加入两条 CI。
- 实机发现自动保存 clock 方法引用原生 clearTimeout 会导致 Chromium Illegal invocation，已改成包装调用并补原生接收者回归；最终真实构建重新通过启动与输入验收。
- 新增 `input-electron.cjs`：300段连续输入30字、CDP中文组合输入提交、焦点保持、保存后重载恢复正文与图片均通过，无renderer错误。CDP模拟不等同于所有系统输入法已人工验收。
- `image-drop-electron.cjs` 16项通过：空白启动、11次正向/11次反向Tab、本地图片/无MIME/损坏文件/多图/滚动边缘、撤销与保存重启恢复、两类PDF出口。
- `pdf-layout-electron.cjs`：第五场图文/声音卡坐标尺寸差小于1px，导出后工程/布局未变；实际 PDF 中250行单列、170行双列标记均且仅出现一次，A4尺寸正确。创作版和A4页已渲染目视核对。
- 运行时代码仅3个文件；其他变更为版本、测试、CI与维护文档。源码/脚本中已知隐私关键词0命中，测试均为合成数据。所有测试输出位于临时目录，不纳入Git或安装包。

## 产物

- 独立目录：`release/alpha.18.7/`，包含app、ZIP和DMG。安装包仅含生产代码，已用包级core-guard检查；renderer与通过实机验收的dist-renderer逐文件一致，ad-hoc签名完整性检查通过。
- DMG：`GuangyingWriter-v1.3.0-alpha.18.7-macOS-arm64.dmg`。
- SHA-256：`c403d97dc89ceb9dce201a002d2c6e5f1abe315e0e9d972e559f60a210c144ce`；DMG校验通过，只读挂载确认版本为1.3.0-alpha.18.7，含应用与Applications快捷入口，挂载内renderer与验收构建一致；已卸载测试挂载。
- 仅macOS Apple Silicon，未Apple公证、未跨机器验收；不能保证所有电脑放行，不改变系统安全设置。GitHub与现用应用保持不动。
