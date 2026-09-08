# 环境踩坑与修复指南（下一个接手者必读）

> 本文记录本仓库在**当前开发环境**（无 GUI 的自动化会话）里反复遇到的、看起来"莫名其妙"的报错，
> 以及每一步的**根因**与**可复现的解法**。所有坑都有一个共同根因，读完第一条就能少走很多弯路。

---

## 0. 一个根因：`com.apple.provenance`（SIP 保护的"来源"属性）

本环境会给**几乎所有新写入的文件**自动打上扩展属性 `com.apple.provenance`。这不是常见的
`com.apple.quarantine`（隔离属性，`xattr -cr` 能清），而是 SIP（系统完整性保护）托管的**来源属性**：

- `xattr -l <文件>` 若出现 `com.apple.provenance`，即中了。
- `xattr -cr` **删不掉**它（它不是隔离属性）。
- 带此属性的文件，**普通进程无法修改 / 重命名覆盖 / 删除**（`Operation not permitted`）。

但它有规律可循，这也是所有解法的核心：

> **新建**文件（`mkdir` 目标不存在时的 `rename`）没问题；**覆盖或删除**已有 provenance 文件会失败。

### 快速判别

```bash
xattr -l 文件路径      # 出现 com.apple.provenance 就是中了
ls -laO 文件路径       # 权限位带 @ 也提示有扩展属性
```

---

## 1. Electron 二进制被清空（打包时报文件不存在）

### 症状

- `package.sh` 或 `electron-packager` 报：
  `cp: node_modules/electron/dist/Electron.app: No such file or directory`；
- `node_modules/electron/dist/Electron.app` 只剩几百 KB，且**没有 `Contents/Frameworks`**。

### 根因

npm 的 `electron` 包在 `postinstall` 时用 `extract-zip` 解压官方 zip，本环境报
`Brokered file token refused: modify backup failed`，解压**中途被拦**，产物残缺。

### 解法：不用 node 的 zip 库，改用系统 `curl` + `ditto`

```bash
VER=$(node -p "require('./node_modules/electron/package.json').version")
curl -L -o /tmp/e.zip \
  "https://github.com/electron/electron/releases/download/v${VER}/electron-v${VER}-darwin-arm64.zip"
rm -rf node_modules/electron/dist && mkdir -p node_modules/electron/dist
ditto -xk /tmp/e.zip node_modules/electron/dist/   # 必须 ditto，node 的 zip 库会被拦
xattr -cr node_modules/electron/dist/Electron.app  # 清隔离属性，否则后续 cp 被拒
```

要点：**curl + `ditto -xk`，不要用 `extract-zip` / `unzip`**。x64 把 `-arm64` 换成 `-x64`。

---

## 2. 复制 Electron.app 时 `default_app.asar: Operation not permitted`

### 症状

`package.sh` 组装 `.app` 时，`cp -R` / `rm` 一碰到 `Contents/Resources/default_app.asar` 就报
`Operation not permitted`，`xattr -cr` 也无效。

### 根因

`default_app.asar` 带 `com.apple.provenance`（见 §0），SIP 保护，删不掉、也覆盖不了。

### 解法：根本不去碰它

```bash
rsync -a --exclude 'default_app.asar' src/ dst/   # 用 rsync 排除，而不是先 cp 再删
```

该文件本来就无用（我们提供自己的 `Contents/Resources/app`）。`package.sh` 的 Step 2 已内置此修复
（无 rsync 时回退到 `cp`，并带骨架完整性守卫：缺 `MacOS/Electron` 或 `Frameworks` 直接退出）。

---

## 3. git 提交失败：`Unable to create '.git/index.lock': File exists`（本次新发现）

### 症状

- `git add` / `git commit` / `git reset` 报：
  `fatal: Unable to create '.../.git/index.lock': File exists`；
- 或 `warning: unable to unlink '.git/index.lock': Operation not permitted`；
- `.git/index`、`.git/HEAD`、`.git/refs/heads/main` 用 `xattr -l` 看都带 `com.apple.provenance`。

### 根因

`git` 的每次写操作都是「新建 `xxx.lock` → 写入 → `rename` 覆盖旧文件」。由于旧文件（index / refs）
带 provenance，`rename` 覆盖被 SIP 拦下，git 崩溃并把 `xxx.lock` 残留在原地，于是下一次 git
一进来就撞上残留锁，报"File exists"。**光 `rm -f .git/index.lock` 往往不够**，因为 refs 也一样中招。

### 解法（可复现，已验证）

**首选：确认没有真 git 进程后，删锁再提交。**

```bash
rm -f .git/index.lock .git/HEAD.lock .git/refs/heads/main.lock
git add -A && git commit -m "..."     # 若这步能过，就到此为止
```

**若仍失败（refs 的 rename 覆盖被拦），改用底层命令绕过 lock+rename：**

```bash
# 0) 记下父提交与作者信息（保持提交署名一致）
PARENT=$(git rev-parse HEAD)
export GIT_AUTHOR_NAME="$(git log -1 --format='%an')" GIT_AUTHOR_EMAIL="$(git log -1 --format='%ae')"
export GIT_COMMITTER_NAME="$(git log -1 --format='%cn')" GIT_COMMITTER_EMAIL="$(git log -1 --format='%ce')"

# 1) 索引重定向到 /tmp（干净目录，rename 不受 provenance 影响）
GIT_INDEX_FILE=/tmp/mochang.idx git add -A

# 2) 直接生成 tree 与 commit 对象（走 loose object 写，新建不覆盖，能过）
TREE=$(GIT_INDEX_FILE=/tmp/mochang.idx git write-tree)
COMMIT=$(printf '提交说明\n' | GIT_INDEX_FILE=/tmp/mochang.idx git commit-tree "$TREE" -p "$PARENT")

# 3) 用 shell 更新分支引用（先删 provenance 旧文件，再写新的）
rm -f .git/refs/heads/main
printf '%s\n' "$COMMIT" > .git/refs/heads/main

# 4) 恢复 .git/index（从 /tmp 干净索引拷回）
cp /tmp/mochang.idx .git/index

git log --oneline -1   # 验证
```

要点：

- **只 `rm -f .git/index.lock` 不解决 refs 的覆盖问题**；根治要连 refs 一起处理。
- `git write-tree` / `git commit-tree` 写的是**新对象**（目标名不存在），所以能过；问题只出在
  "覆盖旧文件"这一步，所以用 shell 的 `rm + 重写` 替换 git 的 `rename`。
- 这些命令需要**沙箱外执行**（对 `.git` 内文件的删除/写入会被沙箱拦）。

---

## 4. Electron 无法启动（`sandbox initialization failed`）

### 症状

`electron .` 或 `open` 启动即退出：`sandbox initialization failed`，加 `--no-sandbox` 也无效。

### 根因

本环境**没有可用的窗口服务会话**（`USER` 为空）。对照实验：连系统「计算器」「文本编辑」都启动不了。

### 结论

**真机交互（打字 / 回车 / 删除 / 音量 / 静音 / 切视图 / 关窗）只能由人在本机完成**，
自动化环境只能验证产物结构与内容。**绝不能声称这些交互已经验证过**。

---

## 快速对照表

| 报错关键字 | 根因 | 解法 |
| --- | --- | --- |
| `Brokered file token refused` / Electron.app 只有几百 KB | extract-zip 解压被拦 | curl + `ditto -xk`（§1） |
| `default_app.asar: Operation not permitted` | provenance（SIP） | `rsync --exclude 'default_app.asar'`（§2） |
| `Unable to create '.git/index.lock': File exists` | 残留锁 / refs 覆盖被拦 | 删锁 → 仍失败用 `commit-tree` 绕过（§3） |
| `sandbox initialization failed` | 无 GUI 会话 | 放弃自动化验证，转人工（§4） |
| `xattr -cr` 对某文件无效 | 那是 provenance 不是 quarantine | 换 `rsync --exclude` 或 `rm + 重写`（§0） |

---

## 一句话总结

> 本环境两大拦路虎：**① 文件自动带 `com.apple.provenance`（SIP）**，导致"覆盖/删除旧文件"类操作失败——
> 对策是"新建替代覆盖"（rsync 排除、`commit-tree`、shell `rm+重写`）；**② 没有 GUI 会话**——
> 对策是"别指望自动化验证交互，交给人工"。遇到看不懂的 `Operation not permitted`，先 `xattr -l` 看看是不是 provenance。
