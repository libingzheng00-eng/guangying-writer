/**
 * Synthetic fixture windows for native integration tests. Never use a user's app.
 * Each new fixture gets a distinct temporary HTML URL and Electron partition.
 * The seed is an external generated script executed before the real React module.
 * Current built assets are resolved by an absolute file: base; dist is not edited.
 *
 * Reset loads the successor before destroying ONLY the test-owned old window,
 * so a fixture switch never leaves Electron with zero windows and triggers quit.
 * Destruction is deliberate test teardown,
 * NOT an acceptance test of production close/reload protection. Recovery checks
 * recreate the test window in its SAME partition and SAME generated HTML URL,
 * remove the seed from that generated HTML, and let the real app recover itself.
 * No beforeunload handler is removed and no will-prevent-unload event is ignored.
 */
const { BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const owned = new WeakMap();
const attr = value => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const scriptString = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

async function createFixtureWindow({
  out, renderer, preload, project, theme, previous, restore = false,
  width = 1440, height = 960, show = true, onCreated = () => {},
}) {
  // Validate ownership before producing artifacts or attempting any replacement.
  if (previous && !owned.has(previous)) throw new Error('Refusing to replace an unowned window.');
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const output = fs.realpathSync(out);
  const relative = path.relative(temporaryRoot, output);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error('Native fixture output must be a dedicated existing temporary directory.');
  }
  let info;
  if (restore) {
    if (project !== undefined || theme !== undefined) throw new Error('Recovery cannot inject a new fixture or preferences.');
    info = previous && owned.get(previous);
    if (!info || info.out !== output || info.renderer !== renderer) throw new Error('Recovery requires the same owned synthetic fixture.');
    // Only rewrite this helper's own generated test artifact, never dist-renderer.
    fs.writeFileSync(info.entry, info.unseededHTML, 'utf8');
  } else {
    const token = randomUUID();
    const source = fs.readFileSync(renderer, 'utf8');
    const base = attr(pathToFileURL(path.dirname(renderer) + path.sep).href);
    if (!/<head(?:\s[^>]*)?>/i.test(source) || !/<script\b/i.test(source)) throw new Error('Candidate renderer HTML is incomplete.');
    const unseededHTML = source.replace(/<head(?:\s[^>]*)?>/i, head => `${head}<base href="${base}">`);
    const entry = path.join(output, `fixture-${token}.html`);
    let html = unseededHTML;
    if (project !== undefined || theme !== undefined) {
      const seed = path.join(output, `fixture-${token}-seed.js`);
      let js = '// Only synthetic test state; generated before React mounts.\n';
      if (project !== undefined) js += `localStorage.setItem('guangying:autosave',${scriptString(JSON.stringify({ project, filePath: null }))});\n`;
      if (theme !== undefined) js += `localStorage.setItem('guangying:appTheme',${scriptString(theme)});\n`;
      fs.writeFileSync(seed, js, { encoding: 'utf8', flag: 'wx' });
      const tag = `<script src="${attr(pathToFileURL(seed).href)}"></script>`;
      html = html.replace(/<script\b/i, tag + '<script');
    }
    fs.writeFileSync(entry, html, { encoding: 'utf8', flag: 'wx' });
    info = { out: output, renderer, entry, unseededHTML, partition: `guangying-fixture-${token}` };
  }
  const win = new BrowserWindow({ width, height, show, webPreferences: {
    preload, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
    partition: info.partition,
  } });
  owned.set(win, info);
  try {
    onCreated(win);
    await win.loadFile(info.entry);
    // Electron may quit on window-all-closed. Keep the old synthetic window alive
    // until the candidate successor is loaded; failures leave that old window intact.
    if (previous && !previous.isDestroyed()) previous.destroy();
    return win;
  } catch (error) {
    if (!win.isDestroyed()) win.destroy();
    throw error;
  }
}

module.exports = { createFixtureWindow };
