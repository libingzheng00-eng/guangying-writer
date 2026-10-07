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

const manifest = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8'));
if (manifest.name !== 'guangying-native-acceptance-qa') {
  throw new Error('Native QA launcher requires the independent QA manifest; production execution refused.');
}

const entries = Object.freeze({
  manual: 'native-acceptance-shell.cjs',
  editing: 'editing-electron.cjs',
  input: 'input-electron.cjs',
  pdf: 'pdf-layout-electron.cjs',
  search: 'search-electron.cjs',
  image: 'image-drop-electron.cjs',
});
const mode = process.env.GUANGYING_QA_MODE || 'manual';
if (!Object.prototype.hasOwnProperty.call(entries, mode)) {
  throw new Error('Unknown native QA mode. Allowed: manual, editing, input, pdf, search, image.');
}

// Do not trust external path overrides; all modes test the candidate built from
// the repository containing this launcher, not an installed or old renderer.
const root = path.resolve(__dirname, '..');
process.env.GUANGYING_TEST_ROOT = root;
process.env.GUANGYING_TEST_RENDERER = path.join(root, 'dist-renderer', 'index.html');
require(path.join(__dirname, entries[mode]));
