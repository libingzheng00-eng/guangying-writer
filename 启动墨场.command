#!/bin/bash
# 墨场 · 中文编剧 — 双击启动器
# 会自动打开「终端」运行修复脚本（解决 Gatekeeper 拦截问题）

SCRIPT="$(dirname "$0")/修复并启动.sh"

open -a Terminal "$SCRIPT"
