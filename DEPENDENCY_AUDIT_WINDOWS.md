# Windows 候选的依赖审计

后续安全升级已固定 Electron 44.7.0，旧下载链移除、source-map-js更新为1.2.2，新增parse5 8.0.1；初次升级后审计为2包（1 high / 1 moderate，均开发工具链）。本页余下10包/31.7.7结论是升级前历史，当前解释与最终验证入口见 [SECURITY_UPGRADE.md](SECURITY_UPGRADE.md)。

审计日期：2026-10-08。比较原始 `main` 提交 `dcc097bc324dc081a68c5120a9260530e2278a33` 与 Windows 分支锁文件（首次审计提交 `439e95e940818173118b43298dca3852a866c6b4`）。后续原始入口和 SmartType 验收补丁没有修改依赖。方法是分别运行 `npm audit --json --package-lock-only`，比较 `vulnerabilities` 对象，再按锁文件和 `npm ls` 追踪安装、开发和交付路径。此为有界依赖审查，不是完整渗透测试；公告和计数可能随时间变化。

## 结果与交付限制

两份审计的受影响包对象完全相同：**10 个受影响包，5 high / 5 moderate / 0 critical**。这是包数量，不是漏洞数量；这些包关联 46 条直接公告，Electron 关联其中 37 条（11 条 high）。Windows 打包新增 44 条锁定包记录，除根项目 manifest 记录外，没有改动既有依赖包记录，新增记录没有被本次 audit 列为受影响节点。

**Electron 31.7.7 是随 EXE 交付的运行时，不能因它位于 devDependencies 就忽略其风险。** 本次继续沿用 Mac 基线运行时，Windows 功能验收通过也不表示运行时漏洞已修复。本候选应保持 alpha / draft 状态；面向普通用户正式推广前，优先安排受支持 Electron 版本升级和 Mac、Windows 的保存、恢复、PDF、输入法回归。

| 依赖 / 当前版本 | 本次分级 | 实际用途与处理 |
| --- | --- | --- |
| `electron` 31.7.7 | high | 实际交付。存在 contextBridge 隔离绕过等公告；保留为明确的运行时风险，升级须单独完整回归。 |
| `vite` 5.4.21 | high | 开发服务器/构建，不装入生产 app。Windows 路径和 UNC 公告影响开发环境；勿把开发服务器暴露给不可信来源。 |
| `extract-zip` 2.0.1 | high | 既有 Electron 安装解压链，不装入 app；公告涉及恶意 ZIP 的符号链接写出目标目录。 |
| `http-cache-semantics` 4.2.0 | high | 既有 Electron 下载缓存链，不装入 app；公告涉及共享缓存跨用户响应泄漏。 |
| `source-map-js` 1.2.1 | high | 构建/测试依赖，不装入 app；异常 indexed source map 可能阻塞事件循环。可另评估公告修复版本 1.2.2。 |
| `esbuild` 0.21.5 | moderate | Vite 构建工具，不装入 app；公告针对 esbuild 开发服务器，本仓库没有调用其 serve 接口。 |
| `@electron/get` 2.0.3、`global-agent` 3.0.0、`roarr` 2.15.4、`sprintf-js` 1.1.3 | 各 moderate | 既有 Electron 下载/代理日志链，前三者由下游风险传播标记；`sprintf-js` 的格式精度参数可造成拒绝服务。不装入 app。 |

新增 `@electron/packager` 20.3.0 使用其自己的 `@electron/get` 5.1.0 和 `@electron-internal/extract-zip`；没有把旧 Electron 下载链带入新增 packager 路径。生产白名单只复制 app 的 `package.json`、LICENSE、electron 和 renderer，依赖目录不随 app 交付。打包后的 Electron 自身仍然存在上述运行时风险。renderer 使用的 React 18.3.1、React DOM 18.3.1、Zustand 4.5.7 未命中本次 audit；这也不是无漏洞证明。

## 与当前应用相关的重点

[Electron 官方隔离绕过公告](https://github.com/electron/electron/security/advisories/GHSA-h7rp-cf8h-j98x)涉及跨 contextBridge 的 Promise 和 `Function.prototype.bind`；本项目 preload 暴露的 `ipcRenderer.invoke` 返回 Promise，因此不能笼统认定与应用无关。audit 对当前 31.7.7 给出的受影响范围是 `<39.8.9`，这是该版本所在区间，不代表只升到 39.8.9 就修复全部公告。

现有入口加载本地 renderer，使用 CSP、`contextIsolation: true` 和 `nodeIntegration: false`，这些设置限制暴露面，但不能修复 Electron 自身的隔离绕过。应用没有统一的外部导航/新窗口拒绝策略，工程内容也进入编辑器 DOM；本轮未建立具体利用链，亦没有据此宣称应用不可被利用。后续运行时升级应连同工程内容、导航边界和 preload 接口一起审查。

其他公告依据：[Vite Windows 路径](https://github.com/vitejs/vite/security/advisories/GHSA-fx2h-pf6j-xcff)、[UNC/NTLM](https://github.com/advisories/GHSA-v6wh-96g9-6wx3)、[source map 路径](https://github.com/advisories/GHSA-4w7w-66w2-5vf9)、[extract-zip 符号链接](https://github.com/advisories/GHSA-jmr9-qjv8-65gv)、[extract-zip 任意写入](https://github.com/advisories/GHSA-7pqw-9j4j-h8q3)、[HTTP 缓存](https://github.com/advisories/GHSA-ch52-4w7c-c8xp)、[source-map-js](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)、[esbuild](https://github.com/advisories/GHSA-67mh-4wv8-2f99)、[sprintf-js](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)。

## 为什么没有直接自动升级

本次 audit 的整链修复建议包含 Electron 44.7.0 和 Vite 8.3.3，均跨大版本；直接 `npm audit fix --force` 会把平台适配扩大为运行时和构建系统迁移。没有执行该操作，也没有把 `npm audit --omit=dev` 的结果作为交付安全结论。构建工具的小版本补丁可以单独评估，不能代替已交付 Electron 的修复。下一轮应先选定受支持的目标运行时，重新读取公告与锁文件，并完成两平台功能、权限和输入/导出回归。
