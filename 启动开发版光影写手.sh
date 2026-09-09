#!/bin/bash
# ============================================================
#  光影写手 · 开发版启动脚本
#  仅构建并启动当前源码；绝不关闭 Gatekeeper、修改系统安全设置或删除系统文件。
# ============================================================
set -eu

DIR="$(cd "$(dirname "$0")" && pwd)"
ELECTRON="$DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"

if [ ! -x "$ELECTRON" ]; then
  echo "缺少完整 Electron 运行时。请在项目目录执行 npm install 后重试。"
  exit 1
fi

cd "$DIR"
echo "构建光影写手…"
npm run build
echo "启动开发版…"
env -u ELECTRON_RUN_AS_NODE "$ELECTRON" "$DIR"
