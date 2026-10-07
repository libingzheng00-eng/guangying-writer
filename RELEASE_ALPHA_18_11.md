# 光影写手 v1.3.0-alpha.18.11

2026-10-07，macOS Apple Silicon（arm64）测试版，已公开。实际附件以 [GitHub 下载页](https://github.com/libingzheng00-eng/guangying-writer/releases/tag/v1.3.0-alpha.18.11) 为准。安装包与版本tag固定来自 `fix/recovery-performance-20261007` 的 `7d92d5953c4e2463f21430651d060409564c9e39`；[PR #10](https://github.com/libingzheng00-eng/guangying-writer/pull/10) 是合并到main的入口，实际合并状态以PR为准。后续发布流程/文档修复不会替换已验收安装包；发布安装包与更新默认分支须分别核对。本次没有自动替换用户电脑的现用应用。

## 本版更新

- 自动恢复有独立成功/失败反馈与关闭保护，约900ms停笔更新、连续修改最长约30秒更新；坏载荷保留失败时不覆盖。恢复点不等于磁盘工程保存。
- `.zhsp` 同目录临时写入、同步后替换，已有工程保留一份 `.guangying-backup`。成功时备份为替换前版本；最终rename失败时备份可能与当前工程同版本，不是无限历史或断电保证。
- 共用只读正文索引/同人物续说派生与SmartType来源目录，减少重复推导，不重写分页、PDF或双列跨栏语义。
- 汇集此前批准的轻薄打字机进度栏、分字段快捷输入、内容优先自由板第2稿与可选磁吸、统一撤销/剪贴板事务及保守智能双引号。
- 九类Tab闭环、图片拖入、原位图文PDF、A4纯文本、幕管理、统计改名、多选删除、连线备注和旧工程兼容继续由核心回归保护。

## 下载与使用

- 普通用户选择 `GuangyingWriter-macOS-arm64-v1.3.0-alpha.18.11.dmg`；ZIP为同一应用的另一种分发形式。
- DMG中只有 `光影写手.app` 与 `Applications` 安装链接。先保存并备份自己的 `.zhsp`，再自行安装；不要以测试版覆盖唯一的旧版或仅依赖恢复点。
- 本包仅为arm64，不是Intel Mac或Windows安装包。签名为ad-hoc，没有Apple Developer ID或公证；本机验收不保证其他Mac直接放行。
- 若出现恶意软件、损坏或安全拦截提示，请停止运行并保留截图，不关闭Gatekeeper、不清除系统安全防护来掩盖问题。

## 本次发布前实际核验

- typecheck与构建退出0，99 modules；完整37套源码回归退出0，GitHub对应源码自动回归通过。
- 完整应用112个普通文件、157个目录、14个包内链接。生产Resources/app只有manifest、LICENSE、electron与dist-renderer，共10个文件，逐字节与当前构建一致。没有打入用户工程、个人素材、自动保存、日志、数据库或QA夹具。
- 主执行文件、Framework和四个Helper均为arm64，Electron 31.7.7。应用与只读挂载DMG内应用的严格签名完整性检查通过；没有伪称Apple公证。
- DMG校验和有效，顶层恰为应用和Applications链接；112个文件内容及14个链接目标与候选应用完全相同。
- 独立临时userData加载最终生产main/preload/renderer：首次启动为空白未命名稿，没有素材或最近文件；合成工程实际保存两次、上一版备份及IPC读取通过。文件选择器结果在这项检查中为合成替身，不能称作原生选择器通过。
- 包内编辑器实际Chromium测试：段中回车、富文本/BR、剪切粘贴事件、连续多步撤销重做，以及11次Tab/11次Shift+Tab通过。剪贴板事件为内存DataTransfer；另外的真实系统剪贴板证据见 `RELIABILITY_QA_20261007.md`。
- 包内PDF模块与渲染器生成实际合成PDF：第五场旁声音/图片坐标误差小于1px、不放文末；A4不含素材。长稿250个、双列170个唯一行标记各恰好一次；28组短对白的人物与对白同页。已看图检查创作页、A4两页、短对白三页及大图页。第一次临时提取脚本误用短对白标记名，改为脚本实际生成的 `SHORT_DIALOGUE_001` 等后重跑通过；没有因此改产品代码或放松断言。

## 边界与后续

公开后tag自动流程因重复上传同名附件失败，源码检查、打包与创建DMG成功。发布流程的后续修复只读跳过完整现有附件，未删除或覆盖它们；旧失败保留，修复验证使用新的默认分支工作流，不移动tag。675项离线发布测试与37套应用源码回归分别计数，不替代上述安装包实机验收。

真实macOS中文输入法、原生文件选择器（此前独立壳曾出现按钮禁用，原因未定位）、跨机安装、Windows/Linux、Finder物理拖拽和硬断电/网络盘仍未完整验收。Poppler曾报告中文嵌入字体类型警告，已查看页面文字可见；不承诺所有PDF阅读器/字体都相同。测试版不是全平台零风险认证。

打包保留既有主Bundle ID与存储键，不隐式迁移个人数据。运行时Helper仍使用Electron默认标识，顶层遗留默认asar的integrity元数据；此次签名和独立启动未发现由此造成的错误，未为发包扩大成运行时/应用标识改造。

核心维护入口：`CORE_FEATURES.md`、`MAINTENANCE.md`、`DEVELOPER_HANDOFF.md`。详细源码/系统剪贴板/关闭/性能分层证据：`RELIABILITY_QA_20261007.md`。仅用合成稿验收，没有打开、修改或上传用户剧本。

## 附件SHA-256

```text
3f2f1b6b6920a5f21448321fac4cdd7a66c1bd614699f9cc4b47bdf1f036479c  GuangyingWriter-macOS-arm64-v1.3.0-alpha.18.11.dmg
1eb470ad744905fe68a91e5719083e9a638c27f77ff178f755abaecced4db64b  GuangyingWriter-macOS-arm64.zip
```
