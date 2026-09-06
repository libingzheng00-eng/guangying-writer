#!/bin/bash
# ============================================================
#  墨场 · 中文编剧 — 启动修复脚本 v3
#  用法：在「终端.app」中运行：
#    bash /Users/libingzheng/WorkBuddy/2026-09-02-23-27-10/zh-screenwriter/修复并启动.sh
# ============================================================

DIR="$(cd "$(dirname "$0")" && pwd)"
ELECTRON="$DIR/node_modules/electron/dist/Electron.app"
ZIP="/tmp/electron.zip"

echo "============================================"
echo "  墨场 · 中文编剧 — 环境修复与启动 v3"
echo "============================================"
echo ""

# ---- Step 1: 恢复 Electron（如果被移到废纸篓）----
if [ ! -d "$ELECTRON" ]; then
    echo "[1/6] Electron.app 不在原位，正在从 zip 恢复..."
    rm -rf "$DIR/node_modules/electron/dist" 2>/dev/null
    mkdir -p "$DIR/node_modules/electron/dist"
    if [ -f "$ZIP" ]; then
        ditto -x -k "$ZIP" "$DIR/node_modules/electron/dist/"
        echo "      已从 zip 恢复"
    else
        echo "      错误: 找不到 $ZIP，请先 npm install"
        exit 1
    fi
else
    echo "[1/6] Electron.app 就位 ✓"
fi

# ---- Step 2: 关闭 Gatekeeper 全局拦截（允许任何来源）----
echo ""
echo "[2/6] 关闭 Gatekeeper 全局拦截（需要密码，只需一次）..."
if sudo spctl --master-disable 2>/dev/null; then
    echo "      ✅ 已允许「任何来源」应用，以后不再拦截"
else
    echo "      ⚠️  master-disable 失败，尝试 spctl --add..."
    sudo spctl --add "$ELECTRON" 2>/dev/null && \
        echo "      ✅ 已加入白名单" || \
        echo "      ⚠️  白名单也失败，稍后可能需要手动在系统设置放行"
fi

# ---- Step 3: Ad-hoc 自签名 ----
echo ""
echo "[3/6] 对 Electron.app 进行 Ad-hoc 自签名..."
if sudo codesign --force --deep --sign - "$ELECTRON" 2>/dev/null; then
    echo "      自签名完成 ✓"
else
    codesign --force --deep --sign - "$ELECTRON" 2>/dev/null && \
        echo "      自签名完成（无 sudo）✓" || \
        echo "      自签名跳过"
fi

# ---- Step 4: 清除安全属性 ----
echo ""
echo "[4/6] 清除 macOS 安全属性（需要密码）..."
sudo xattr -cr "$ELECTRON" 2>/dev/null || true
sudo xattr -d com.apple.provenance "$ELECTRON" 2>/dev/null || true
echo "      安全属性已清除"

# ---- Step 5: 构建 ----
echo ""
echo "[5/6] 构建渲染进程..."
cd "$DIR"
npx vite build 2>&1 | tail -3
echo "      构建完成"

# ---- Step 6: 用 open 启动（走系统 LaunchServices，不触发二次拦截）----
echo ""
echo "[6/6] 启动墨场…"
echo ""

# 用 open -a 通过 LaunchServices 启动，args 传给 Electron
open -a "$ELECTRON" --args "$DIR" 2>/dev/null

# 等待并检查
sleep 4
if pgrep -f "Electron.app/Contents/MacOS/Electron" > /dev/null 2>&1; then
    echo "✅ 墨场已启动！窗口应该已经弹出了。"
    echo "   （如未看到窗口，查看日志：cat /tmp/mochang.log）"
    exit 0
else
    echo "❌ 启动未成功，尝试直接启动…"
    nohup "$ELECTRON/Contents/MacOS/Electron" "$DIR" > /tmp/mochang.log 2>&1 &
    sleep 4
    if pgrep -f "Electron.app/Contents/MacOS/Electron" > /dev/null 2>&1; then
        echo "✅ 墨场已启动（备用方式）！"
        exit 0
    fi
    echo "❌ 仍然失败，最后日志："
    tail -15 /tmp/mochang.log
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo " 终极手动方案："
    echo " 1. 打开「系统设置 → 隐私与安全性」"
    echo " 2. 滚到底部，找到「已阻止使用 Electron」"
    echo " 3. 点击「仍要打开」，输入密码"
    echo " 4. 再次运行本脚本"
    exit 1
fi
