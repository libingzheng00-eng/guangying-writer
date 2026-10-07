# 光影写手 v1.3.0-alpha.18.12

2026-10-08，macOS Apple Silicon（arm64）测试版。本版重点是更顺手、明确确认的 SmartType。源码默认分支与安装附件分别以GitHub实际状态为准：[源码仓库](https://github.com/libingzheng00-eng/guangying-writer) · [本版下载页](https://github.com/libingzheng00-eng/guangying-writer/releases/tag/v1.3.0-alpha.18.12)。不移动旧版本tag或覆盖旧附件。

## 更新内容

- 新空段直接输入“特”，可选“特写 · 镜头”；直接输入剧本中已有的人名，自动提供人物候选，不必先切属性。
- 有“小明”和“小明妈妈”时，输入完整“小明”仍提供两个候选，完整匹配排前；只有明确选择才改文字和类型。
- **第一次 Enter 确认并留在本段继续写，第二次 Enter 才换段。**鼠标/右箭头也只确认；确认后候选收起，未继续编辑不反复弹出。
- 文字与属性一笔事务提交，一次撤销同时恢复。旧正文、粘贴、拆行尾文及双列不加入新跨类型识别。
- 保留九类 Tab / Shift+Tab、软换行、分字段补全、原保守识别、搜索、剪切粘贴与多步撤销。Tab 不被候选截获，完整时段“夜”不强扩“夜晚”，完整地点不自动补上时段。
- 修复旧内/INT输入会话在切换工程、同字粘贴或剪切后残留的问题；强化原文、类型、目录、文档epoch、光标和双列边界校验。
- 更新核心功能契约与维护说明。本轮不改分页/PDF、素材位置、故事板归幕、卡片逻辑、工程格式或个人数据目录。

## 下载、安装与回退

下载 `GuangyingWriter-macOS-arm64-v1.3.0-alpha.18.12.dmg`，打开后将 `光影写手.app` 拖入Applications。ZIP为同一个应用的另一种分发形式，源码ZIP不是安装包。

先保存并备份 `.zhsp`，退出正在写作的旧应用，再开启新版本。本机桌面独立副本名为 `光影写手 alpha.18.12.app`，没有强退旧版、覆盖用户剧本或自动删除旧版。其他用户的应用也不会因GitHub发布自动更新。

仅支持macOS arm64（Apple Silicon）。本包是ad-hoc签名，**没有Apple Developer ID签名/公证**，本机启动通过不保证其他Mac放行；不是Intel或Windows安装包。出现安全拦截时停止运行并保留截图，不关闭系统安全保护。

## 本次实际核验

- 最终typecheck/build退出0，99 modules；37/37套完整源码回归退出0，SmartType模型132、Editor/store511项通过。发布安全另675项离线断言通过。
- 最终源码六组真实Electron依次退出0：SmartType60、editing25、input3、search3、image18、PDF7个PASS。候选截图实际看到“特写 · 镜头”；确认后仍在原段，第二次Enter再切段。11次正向与11次反向Tab保护正文ID/文字和中间光标。
- 图片投递后，真实保存的完整 `project.elements` 与可见正文ID/类型/HTML/文字/顺序严格等值；非空合成稿的图片插入、一步撤销/重做不改变正文。
- 生成实际PDF：第五场旁图卡/声音卡仍在原位，最新几何差最大0.0078125px；A4纯文本无图片。长段250、双列170标签均恰好一次，28组短对白人物与对白同页。目视范围及字体警告详见验收记录，不声称最后生成的全部长稿逐页目视。
- 生产 `Resources/app` 10个白名单文件逐字节等于最终构建；完整应用112个普通文件/14个链接与只读DMG及桌面副本一致。未纳入用户工程、私人素材、自动保存、数据库、日志或测试夹具。
- 独立临时userData加载最终包的生产main/preload/renderer：首次启动为空白“未命名剧本”（空场次＋空动作），无素材、最近文件或console错误。应用和DMG内应用严格签名完整性通过，DMG校验有效；签名成功不代表Apple公证。

所有验收使用合成稿，没有测试、修改或上传用户剧本。源码/测试边界详见 [SmartType验收记录](https://github.com/libingzheng00-eng/guangying-writer/blob/main/SMARTTYPE_QA_20261008.md)；维护入口：[核心功能契约](https://github.com/libingzheng00-eng/guangying-writer/blob/main/CORE_FEATURES.md)、[维护说明](https://github.com/libingzheng00-eng/guangying-writer/blob/main/MAINTENANCE.md)。

## 未完整验证的边界

本轮组合输入和229是Chromium CDP/合成事件，不等于真实macOS中文输入法；剪贴板是测试DataTransfer，没有操作用户系统剪贴板；图片投递真实本地合成文件，不等于Finder人工拖动。真实输入法、原生文件选择器、跨机器安装、特殊双列跨栏选区、Windows/Intel及断电耐久性仍不作通过承诺。

保留既有主Bundle ID与存储键，不隐式迁移个人数据。运行时Helper仍沿用既有Electron标识与默认asar integrity元数据；本轮未扩展为运行时/应用标识改造。本版仍是alpha测试版，不是全平台零风险认证。

## 附件与SHA-256

| 附件 | 大小（字节） |
| --- | ---: |
| GuangyingWriter-macOS-arm64-v1.3.0-alpha.18.12.dmg | 107455449 |
| GuangyingWriter-macOS-arm64.zip | 96558512 |

```text
be2c94fde508af3ed8d28b04c8bc5b7e22dd5c4bc2993f8847636dbc38f397cc  GuangyingWriter-macOS-arm64-v1.3.0-alpha.18.12.dmg
967bde99c38b8540d536c22c88f550d8b699a2ca345801c1160807aa47a90e78  GuangyingWriter-macOS-arm64.zip
```
