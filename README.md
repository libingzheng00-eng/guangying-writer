# 光影写手 · Guangying Writer

面向中文编剧的开源桌面剧本软件。剧本正文、故事板、自由板、参考素材和改稿记录都保存在同一份 `.zhsp` 工程里。采用 [MIT License](LICENSE)。

**下载：** 到 [GitHub Releases](https://github.com/libingzheng00-eng/guangying-writer/releases) 下载安装包（源码 ZIP 不是应用）。目前提供 macOS 13+ Apple Silicon 的 DMG，使用 ad-hoc 签名，没有经过 Apple 公证；Windows 10+ x64 免安装包见 [Windows 说明](docs/features/WINDOWS.md)。仍处于 alpha 阶段，升级前请保存工程并保留副本。

**使用说明：** [中文用户说明书](docs/USER_GUIDE.zh-CN.md)

## 主要功能

- **写作**：支持九类剧本元素，Tab / Shift+Tab 切换类型；跨类型快捷输入（第一次 Enter 确认候选，第二次切段）；双列对白、同人物续说提示、智能引号；查找与替换；多步撤销。
- **结构**：导航和大纲整场拖动排序；故事板可按幕分组，也可按正文顺序排列；场景可填写地点、故事时间和修改状态。
- **自由板**：场景、灵感、声音和图片卡，支持关系线与备注、网格、磁吸，板面位置与写作画布分开保存。
- **素材与导出**：图片可以直接拖到写作画布。创作版 PDF 会原样保留图文位置；A4 纯文本 PDF 用于打印和交稿。另外支持 FDX、TXT、Markdown、HTML 和统计 CSV 导出。
- **改稿**：命名版本与逐场比较、暂存删减内容、批注及处理决定、交稿检查。
- **拍摄稿**：锁定场号和页码（新插入的场编成 5A、加长的页编成 12A）；对白可保存多个备选版本。
- **双语对照**：日文、英文译文与原文逐段左右对照，原文改过的段落标「待复查」；预览可导出对照版 PDF。译文可用下面的翻译技能生成。
- **人物线**：按正文顺序阅读一个人物出现的场景和台词，可管理别名与同名人物，核对发言、出场和提及，并记录人物笔记。
- **工程安全**：自动恢复点、原子保存加上一版备份、关闭前提示未保存修改。新版工程里本版不认识的内容会原样保留，打开新版工程前会先提示。

## 翻译技能

仓库里的 [`skills/guangying-translate/`](skills/guangying-translate/SKILL.md) 是给 AI 编程助手用的翻译技能（Claude Code 等支持 SKILL.md 的工具）。它通读整部 `.zhsp` 剧本，按人物和故事气质把每段翻成日文或英文，写回同一个文件的译文位置；写之前留一份备份，写完核对原文没有改动，改稿后可以只重翻改过的段落。剧本只在本机处理，不会发给外部翻译服务。

安装：把这个文件夹复制到 `~/.claude/skills/`（Claude Code），或按你所用工具的方式放进它的技能目录。使用：先在光影写手里保存并关掉剧本，再对助手说「把《某剧本》翻成日文」并给出文件路径。脚本只需要 Node.js，不用安装依赖。

## 开发

需要 Node.js 22.13+，依赖以 `package-lock.json` 为准。

```bash
npm ci
npm run typecheck
npm run build
npm run test:core   # 65 套源码回归，不启动原生 Electron
npm run dev
```

运行或打包桌面应用前，先执行 `node scripts/prepare-electron.cjs` 下载锁定版本的 Electron。Mac 打包用 `node scripts/package-macos.cjs <新目录>`。

## 文档地图

| 文档 | 用途 |
| --- | --- |
| [AGENTS.md](AGENTS.md) | 给维护者和 AI 的协作与隐私约束 |
| [CORE_FEATURES.md](CORE_FEATURES.md) | 核心行为契约：改动前必读，改动后对照回归 |
| [DEVELOPER_HANDOFF.md](DEVELOPER_HANDOFF.md) | 当前状态与接手指南 |
| [docs/MAINTENANCE.md](docs/MAINTENANCE.md) | 模块关系、撤销与剪贴板、保存、打包发布 |
| [docs/features/](docs/features/) | 各功能的设计说明（人物线、改稿、启动页、安全、Windows） |
| [docs/ENVIRONMENT_PITFALLS.md](docs/ENVIRONMENT_PITFALLS.md) | 本机打包环境踩坑记录 |
| [CHANGELOG.md](CHANGELOG.md) | 版本记录 |
| [docs/archive/](docs/archive/) | 历次验收与发布记录（只做追溯） |

贡献时请只用虚构的合成稿，不要提交真实剧本、自动保存或私人图片，也不要靠删测试来让 CI 通过。

## 反馈

在 [GitHub Issues](https://github.com/libingzheng00-eng/guangying-writer/issues) 提交问题，附上版本、系统、复现步骤和脱敏截图，请不要上传真实剧本。公开联系邮箱：libingzheng00@gmail.com。
