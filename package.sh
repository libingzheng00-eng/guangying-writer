#!/bin/bash
# ============================================================
#  光影写手 — 打包脚本 v2（手动组装，避免 electron-packager 在本机 macOS 的 file-token 报错）
#  作用：把项目打包成独立可分发的 macOS 应用（.app + .zip）
#  运行：bash package.sh
#  前置：已执行过 npm install 且能正常 vite build
# ============================================================

set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

APP_NAME="${APP_NAME:-GuangyingWriter}"         # 磁盘上的 .app 文件名（用 ASCII，避免中文路径坑）
DISPLAY_NAME="${DISPLAY_NAME:-光影写手}"          # Finder / Launchpad 中显示的名称（支持中文）
BUNDLE_ID="${BUNDLE_ID:-com.workbuddy.guangyingwriter}"
ARCH="${ARCH:-arm64}"                           # M1/M2 用 arm64；Intel 改 x64
VERSION="$(node -p "require('./package.json').version")"
OUT_DIR="${OUT_DIR:-release}"
APP_DIR="$OUT_DIR/${APP_NAME}.app"
ZIP_NAME="${APP_NAME}-macOS-${ARCH}.zip"
RUNTIME_APP="${RUNTIME_APP:-$DIR/node_modules/electron/dist/Electron.app}"
# 只新建，不清理用户现有目录；显式 OUT_DIR 可将候选包放到独立目录。
if [ -e "$APP_DIR" ] || [ -e "$OUT_DIR/$ZIP_NAME" ]; then
  echo "已有同名产物，已停止。请为 OUT_DIR 指定新的目录；旧产物不会被覆盖。"
  exit 1
fi
if [ ! -f "$RUNTIME_APP/Contents/Info.plist" ]; then
  echo "缺少完整 Electron 运行时：$RUNTIME_APP"
  exit 1
fi
RUNTIME_EXEC="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$RUNTIME_APP/Contents/Info.plist")"
if [ ! -x "$RUNTIME_APP/Contents/MacOS/$RUNTIME_EXEC" ]; then
  echo "Electron 运行时不完整，停止打包。"
  exit 1
fi

echo "============================================"
echo "  光影写手 — 打包 (${ARCH})"
echo "============================================"
echo ""

# ---- Step 1: 构建渲染进程 ----
echo "[1/6] 构建渲染进程 (vite build → dist-renderer)…"
npm run build
if [ ! -f "dist-renderer/index.html" ]; then
  echo "  ❌ 构建失败：缺少 dist-renderer/index.html"
  exit 1
fi
echo "      渲染进程构建完成 ✓"
echo ""

# ---- Step 2: 复制 Electron.app 骨架 ----
echo "[2/6] 复制 Electron.app 骨架…"
mkdir -p "$OUT_DIR"
mkdir -p "$APP_DIR"
# 用 rsync 而非 cp -R：node_modules/electron/dist/Electron.app/Contents/Resources/default_app.asar
# 在部分 macOS 上带 com.apple.provenance（SIP 保护），cp -R 复制该文件会报
# "Operation not permitted"（xattr -cr 也无效，因为不是隔离属性）。
# 根本不去碰它即可；我们的 Resources/app 会优先加载，所以 default_app.asar 没用。
# 详见 ENVIRONMENT_PITFALLS.md §2。
rsync -a --exclude 'default_app.asar' --exclude '/Contents/Resources/app/' "$RUNTIME_APP/" "$APP_DIR/"
echo "      骨架就位 ✓"
echo ""

# ---- Step 3: 改名可执行文件 + 清理默认欢迎页 ----
echo "[3/6] 重命名可执行文件并清理默认 app…"
if [ "$RUNTIME_EXEC" != "$APP_NAME" ]; then
  mv "$APP_DIR/Contents/MacOS/$RUNTIME_EXEC" "$APP_DIR/Contents/MacOS/$APP_NAME"
fi
# default_app.asar 是 Electron 自带的示例页；我们提供了 Resources/app，会优先加载我们的应用，
# 因此它可留可删。部分 macOS 上该文件带 com.apple.provenance 属性导致 rm 失败，故做容错处理。
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
set_or_add ":CFBundleIconFile"        "app-icon"
if [ ! -f "$DIR/assets/app-icon.icns" ]; then
  echo "  ❌ 缺少应用图标：assets/app-icon.icns"
  exit 1
fi
cp "$DIR/assets/app-icon.icns" "$APP_DIR/Contents/Resources/app-icon.icns"
echo "      名称=$DISPLAY_NAME / 标识符=$BUNDLE_ID / 版本=$VERSION ✓"
echo ""

# ---- Step 5: 拷贝应用资源（主进程 + 已构建的渲染进程）----
echo "[5/6] 拷贝应用代码到 Contents/Resources/app …"
mkdir -p "$APP_DIR/Contents/Resources/app"
cp -R electron        "$APP_DIR/Contents/Resources/app/electron"
cp -R dist-renderer   "$APP_DIR/Contents/Resources/app/dist-renderer"
cp package.json       "$APP_DIR/Contents/Resources/app/package.json"
cp LICENSE            "$APP_DIR/Contents/Resources/app/LICENSE"
echo "      代码已植入 ✓"
echo ""

# ---- Step 6: Ad-hoc 自签名 + 压缩 ----
echo "[6/6] Ad-hoc 自签名 + 压缩为 $ZIP_NAME …"
codesign --force --deep --sign - "$APP_DIR"
codesign --verify --deep --strict "$APP_DIR"
echo "      Ad-hoc 签名与完整性检查完成（不是 Apple 公证）✓"
cd "$OUT_DIR"
ditto -c -k --sequesterRsrc --keepParent "${APP_NAME}.app" "$ZIP_NAME"
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
echo "    • 本包仅适用于 ${ARCH}，无法保证所有 Mac 直接打开；安全警报不是签名成功证明。"
echo "    • DMG 只是分发容器，不代表 Apple 公证；正式公证需要 Developer ID。"
echo "============================================"
