/**
 * Entrypoint for ONE independent native QA bundle. Select only a fixed repository
 * test through GUANGYING_QA_MODE; arbitrary script/root/renderer paths are refused.
 * The test scripts own unique temporary userData and synthetic fixtures.
 * This launcher does not change OS security, install an app, or attach to the
 * user's production window. A successful launch is not proof of acceptance.
 */
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const manifest = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8'));
if (manifest.name !== 'guangying-native-acceptance-qa') {
  throw new Error('Native QA launcher requires the independent QA manifest; production execution refused.');
}

const entries = Object.freeze({
  manual: 'native-acceptance-shell.cjs',
  editing: 'editing-electron.cjs',
  smarttype: 'smarttype-electron.cjs',
  input: 'input-electron.cjs',
  pdf: 'pdf-layout-electron.cjs',
  search: 'search-electron.cjs',
  image: 'image-drop-electron.cjs',
});
const mode = process.env.GUANGYING_QA_MODE || 'manual';
if (!Object.prototype.hasOwnProperty.call(entries, mode)) {
  throw new Error('Unknown native QA mode. Allowed: manual, editing, smarttype, input, pdf, search, image.');
}

// Do not trust external path overrides; all modes test the candidate built from
// the repository containing this launcher, not an installed or old renderer.
const root = path.resolve(__dirname, '..');
process.env.GUANGYING_TEST_ROOT = root;
process.env.GUANGYING_TEST_RENDERER = path.join(root, 'dist-renderer', 'index.html');
if (app.isReady()) throw new Error('Native QA launcher must run at cold startup before Electron ready.');
require(path.join(__dirname, entries[mode]));

// Each fixed mode synchronously creates its own temp root and sets userData,
// then registers asynchronous whenReady work. Bind Chromium storage before
// that work can create a window; do not rely on runtime-specific path defaults.
const userData = app.getPath('userData');
const temporary = fs.realpathSync(os.tmpdir());
const parent = fs.realpathSync(path.dirname(userData));
const relative = path.relative(temporary, parent);
if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
  throw new Error('Native QA mode did not select a dedicated temporary userData.');
}
app.setPath('sessionData', userData);
app.whenReady().then(() => {
  if (app.getPath('userData') !== userData || app.getPath('sessionData') !== userData) {
    throw new Error('Native QA userData/sessionData isolation changed before ready.');
  }
  console.log('QA_ISOLATION', JSON.stringify({ mode, electron: process.versions.electron,
    platform: process.platform, architecture: process.arch, userData, sessionData: app.getPath('sessionData') }));
});
