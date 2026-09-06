#!/bin/bash
# ============================================================
#  墨场 · 中文编剧 — 打包脚本 v2（手动组装，避免 electron-packager 在本机 macOS 的 file-token 报错）
#  作用：把项目打包成独立可分发的 macOS 应用（.app + .zip）
#  运行：bash package.sh
#  前置：已执行过 npm install 且能正常 vite build
# ============================================================

set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

APP_NAME="${APP_NAME:-Mochang}"                 # 磁盘上的 .app 文件名（用 ASCII，避免中文路径坑）
DISPLAY_NAME="${DISPLAY_NAME:-墨场 · 中文编剧}"  # Finder / Launchpad 中显示的名称（支持中文）
BUNDLE_ID="${BUNDLE_ID:-com.workbuddy.mochang}"
ARCH="${ARCH:-arm64}"                           # M1/M2 用 arm64；Intel 改 x64
VERSION="$(node -p "require('./package.json').version")"
OUT_DIR="${OUT_DIR:-release}"
APP_DIR="$OUT_DIR/${APP_NAME}.app"
ZIP_NAME="${APP_NAME}-macOS-${ARCH}.zip"

echo "============================================"
echo "  墨场 · 中文编剧 — 打包 (${ARCH})"
echo "============================================"
echo ""

# ---- Step 1: 构建渲染进程 ----
echo "[1/6] 构建渲染进程 (vite build → dist-renderer)…"
rm -rf dist-renderer
npx vite build 2>&1 | tail -3
if [ ! -f "dist-renderer/index.html" ]; then
  echo "  ❌ 构建失败：缺少 dist-renderer/index.html"
  exit 1
fi
echo "      渲染进程构建完成 ✓"
echo ""

# ---- Step 2: 复制 Electron.app 骨架 ----
echo "[2/6] 复制 Electron.app 骨架…"
mkdir -p "$OUT_DIR"
rm -rf "$APP_DIR"
cp -R "node_modules/electron/dist/Electron.app" "$APP_DIR"
echo "      骨架就位 ✓"
echo ""

# ---- Step 3: 改名可执行文件 + 清理默认欢迎页 ----
echo "[3/6] 重命名可执行文件并清理默认 app…"
mv "$APP_DIR/Contents/MacOS/Electron" "$APP_DIR/Contents/MacOS/$APP_NAME"
# default_app.asar 是 Electron 自带的示例页；我们提供了 Resources/app，会优先加载我们的应用，
# 因此它可留可删。部分 macOS 上该文件带 com.apple.provenance 属性导致 rm 失败，故做容错处理。
rm -rf "$APP_DIR/Contents/Resources/default_app.asar" 2>/dev/null || true
echo "      完成 ✓"
echo ""

# ---- Step 4: 写入 Info.plist（名称 / 标识符 / 版本）----
echo "[4/6] 写入 Info.plist…"
PLIST="$APP_DIR/Contents/Info.plist"
set_or_add() {
  local key="$1" val="$2"
  if /usr/libexec/PlistBuddy -c "Print $key" "$PLIST" >/dev/null 2>&1; then
    /usr/libexec/PlistBuddy -c "Set $key $val" "$PLIST" >/dev/null
  else
    /usr/libexec/PlistBuddy -c "Add $key string $val" "$PLIST" >/dev/null
  fi
}
set_or_add ":CFBundleName"            "$APP_NAME"
set_or_add ":CFBundleDisplayName"     "$DISPLAY_NAME"
set_or_add ":CFBundleExecutable"      "$APP_NAME"
set_or_add ":CFBundleIdentifier"      "$BUNDLE_ID"
set_or_add ":CFBundleVersion"         "$VERSION"
set_or_add ":CFBundleShortVersionString" "$VERSION"
echo "      名称=$DISPLAY_NAME / 标识符=$BUNDLE_ID / 版本=$VERSION ✓"
echo ""

# ---- Step 5: 拷贝应用资源（主进程 + 已构建的渲染进程）----
echo "[5/6] 拷贝应用代码到 Contents/Resources/app …"
rm -rf "$APP_DIR/Contents/Resources/app"
mkdir -p "$APP_DIR/Contents/Resources/app"
cp -R electron        "$APP_DIR/Contents/Resources/app/electron"
cp -R dist-renderer   "$APP_DIR/Contents/Resources/app/dist-renderer"
cp package.json       "$APP_DIR/Contents/Resources/app/package.json"
echo "      代码已植入 ✓"
echo ""

# ---- Step 6: Ad-hoc 自签名 + 压缩 ----
echo "[6/6] Ad-hoc 自签名 + 压缩为 $ZIP_NAME …"
if codesign --force --deep --sign - "$APP_DIR" 2>/dev/null; then
  echo "      自签名完成（无 sudo）✓"
else
  echo "      ⚠️  自签名跳过（不影响打包，仅本机首次打开需手动放行）"
fi
cd "$OUT_DIR"
rm -f "$ZIP_NAME"
zip -r -q "$ZIP_NAME" "${APP_NAME}.app"
cd "$DIR"
echo "      压缩完成 ✓"
echo ""

# ---- 完成 ----
APP_SIZE="$(du -sh "$APP_DIR" 2>/dev/null | cut -f1)"
echo "============================================"
echo "  ✅ 打包成功！"
echo ""
echo "  产物位置："
echo "    应用： $APP_DIR  ($APP_SIZE)"
echo "    压缩包：$OUT_DIR/$ZIP_NAME"
echo ""
echo "  使用说明："
echo "    • 本包仅做 ad-hoc 自签名，未经过 Apple 公证。"
echo "    • 若系统仍提示「已损坏/无法打开」，请停止运行并保留提示截图；"
echo "      不要关闭 Gatekeeper 或执行 sudo spctl --master-disable。"
echo "    • 分发给他人时，对方也需自行放行（未购买 Apple 开发者证书）。"
echo "    • 想要正式 DMG / 公证（Notarization），请改用 electron-builder（见 README）。"
echo "============================================"
