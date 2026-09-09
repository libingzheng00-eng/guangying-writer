#!/bin/bash
# 光影写手 · 中文剧本创作 — 开发版双击启动器
# 仅用于源码开发；它不会修改 macOS 的 Gatekeeper 或安全设置。

SCRIPT="$(dirname "$0")/启动开发版光影写手.sh"

open -a Terminal "$SCRIPT"
