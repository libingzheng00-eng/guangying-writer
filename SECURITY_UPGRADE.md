# alpha.18.13 安全候选

本轮基于 PR #13 的 `4bc356c483b355ce005cd396489cef202c0e538d`，使用独立分支评审。源码、CI 结果和安装产物必须绑定同一个提交；本文描述安全边界，不代替当次 CI 的验收结果。现有 alpha.18.12 应用、工程资料与 Release 附件保留，不自动安装、合并或发布。

## 运行时与兼容

Electron 从 31.7.7 升至固定 **44.7.0**。31 已结束支持；44.7.0 是 2026-10-08 的官方稳定版本，计划支持至 2027-03-02，实际期限以上游为准。[版本](https://releases.electronjs.org/release/v44.7.0) · [支持时间表](https://releases.electronjs.org/schedule)

候选平台为 **macOS 13+ Apple Silicon** 和 **Windows 10+ x64**。仓库此前没有明确数字形式的最低 macOS 承诺；新运行时不支持 macOS 12。开发机 macOS 26.6.2 满足要求，CI/本机通过不代表最低系统、其他硬件和真实用户环境都已验证。43 虽可运行于 macOS 12，但支持周期更短，本轮不维护第二条运行时分支。[官方平台要求](https://github.com/electron/electron/blob/v44.7.0/README.md#platform-support)

已核对 32–44 的破坏性变更：42 起二进制改为首次使用时下载，因此本地 `prepare-electron.cjs` 显式调用安装好的 Electron 下载入口；打包校验版本与架构。35 的 QA 日志回调改用事件对象。34 的 Windows 全屏菜单行为、43 的打开对话框默认目录变化属于上游行为；图片走 FileReader，不依赖已移除的 File.path。没有使用重构的 Electron clipboard、扩展、桌面捕获或旧协议 session API；PDF 隔离会话继续保留。[变更清单](https://www.electronjs.org/docs/latest/breaking-changes) · [安装方式](https://www.electronjs.org/docs/latest/tutorial/installation)

`GHSA-h7rp-cf8h-j98x` / `CVE-2026-70601` 涉及 contextBridge 的 Promise 返回与不可信内容，官方要求升级运行时，没有应用侧替代修复。现有 CSP 不足以把旧运行时风险判定为已解决；本轮也没有声称已在旧应用中复现完整攻击链。[官方公告](https://github.com/electron/electron/security/advisories/GHSA-h7rp-cf8h-j98x)

## 工程、显示和原生权限

- `.zhsp` 与自动恢复共用加载边界：对正文用 parse5 进行 HTML5 解析并重建有限格式白名单；脚本、事件、URL、外来命名空间及任意 CSS 不进入正文 DOM。基础粗体、斜体、下划线、软换行和旧安全包装保留；非法结构及超限输入报错，不截断正文。安全迁移不修改原磁盘文件，只有用户保存才写入清洗后的工程。
- 导入时拒绝重复或地址冲突的正文/素材 ID、对象原型保留名、失效版心与极端字号行距；HTML 在解析前限制单标签长度与属性数量，并限制总节点和深度，避免格式解析或分页失控。合法旧场景元数据的既有兼容规则保留。设置界面、序列化和恢复写入共用数值约束；无效字段保留为可见草稿并提示，不写入工程或静默夹取。
- 读取恢复点与替换恢复点共用工程验证。JSON 合法但结构或资源限制不合格的旧恢复内容，必须先逐字保全到独立保护槽，才能写入下一份；保护槽已有另一份内容或保护写入失败时禁止替换原恢复点。正常写入仍只缓存最近成功结果，不保留无限恢复历史。
- 图片与颜色采用安全显示投影；不可信资源地址不得作为请求地址。原始素材字段、位置、标题和备注保留，便于重新导入；HTML 导出对类型、字体、尺寸、属性分别规范化，不能把工程设置拼成活动标签。FDX/TXT 已有字面转义继续沿用。
- 主窗口保持 contextIsolation、禁用 Node 集成、显式 sandbox；拒绝外部/子框架导航、新窗口、webview、下载和权限请求。preload 只向主框架暴露具名功能，不暴露 ipcRenderer 或事件对象。
- 每个 IPC 核验当前主窗口、主框架和精确入口 URL，异步等待后复核身份。文件 URL 仅统一 `~` / `%7E` 等等价语法，路径大小写和查询参数边界保持严格，不通过解析磁盘别名扩大授权。写入路径必须来自用户原生选择，且不能指向应用资源或 userData；校验扩展名、参数、父目录身份和符号链接等边界。单纯提供任意 renderer 路径不产生写权限。
- 已选择的工程保存授权由主进程独立持久化，正常重启可继续保存。旧版自动恢复中的关联路径不自动授予权限；首次保存须在原生对话框确认位置，取消保留工程。工程原子替换、上一版备份和关闭保护继续生效。该机制不宣称防御已能改写 userData 的其他本地进程，也不是跨进程文件锁。

## 依赖审计

升级前 `npm audit` 为 10 个受影响包（5 high / 5 moderate）；本次固定 Electron 44.7.0，显式加入 parse5 8.0.1，source-map-js 由 1.2.1 更新为 1.2.2。旧 Electron 下载链移除；升级后审计为 **2 个受影响包（1 high / 1 moderate）**。这些是包数量，不是漏洞数量，也不是无漏洞承诺。

剩余 Vite 5.4.21 / esbuild 0.21.5 属于开发工具。Vite 告警涉及开发服务器的路径访问和 Windows 编辑器调用；esbuild 告警涉及其 serve API。当前测试使用 esbuild build API，生产包只交付构建结果与 Electron，不包含开发服务器或依赖目录；生产主进程也不会因 ZS_DEV 环境变量加载开发服务器。仍不得把依赖告警宣称为已修复，或把开发服务器暴露到不可信网络。本轮没有执行 audit fix --force，也没有混入 Vite 大版本迁移。

官方公告：[Vite Windows 路径](https://github.com/vitejs/vite/security/advisories/GHSA-fx2h-pf6j-xcff)、[优化依赖 map 路径](https://github.com/vitejs/vite/security/advisories/GHSA-4w7w-66w2-5vf9)、[Windows 编辑器路径](https://github.com/advisories/GHSA-v6wh-96g9-6wx3)、[esbuild serve](https://github.com/evanw/esbuild/security/advisories/GHSA-67mh-4wv8-2f99)。完整 audit JSON 随本次候选证据保留，最终报告以最后一次审计为准。

## 验收与产物边界

源码基线包含恶意工程/合法格式往返、显示与 HTML 导出、错误 IPC 来源、未授权路径、正常选择保存、备份和权限重启。两平台分别验证原始生产入口与隔离 QA 副本；QA 保留生产 main/preload/renderer，原生文件对话框返回值使用合成 stub。保存、真正进程重启、PDF、快捷输入和菜单焦点的结果以目标 head 的证据 JSON 为准。

Mac 隔离 QA 主窗口允许超过本机屏幕尺寸，以核验固定视口；记录实际窗口、内容区和显示器工作区。这个 QA 选项不写入生产包，其截图证明渲染视口布局，不代表整个窗口能在当前物理屏幕同时显示。HTML 验证先初始化空白页，再启用网络观察，最后加载实际导出内容；各步骤均有截止时间和独立阶段证据。

Mac 候选仅 ad-hoc 签名，未做 Developer ID/Apple 公证；Windows 候选未做 Authenticode 签名。两个包均生成文件清单和 SHA-256，并在新目录解压回读；不覆盖旧产物。Mac 的 Chromium 注入按键不经 Cocoa 菜单派发，因此该平台的菜单命令验收核对精确快捷键配置并调用真实 MenuItem，不能声称物理 Command 快捷键已验证；普通正文/Tab/Escape 输入仍走 Chromium。真实系统输入法、人工原生对话框、系统菜单快捷键、跨应用剪贴板、消费设备安装、不同 DPI/字体和长时间真实写作需另行验收。
