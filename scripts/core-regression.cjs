/* One local baseline; native Electron/OS clipboard checks remain separate. */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const suites = [
  'core-guard.cjs',
  'render-test.cjs',
  'writing-test.cjs',
  'editing-test.cjs',
  'smartquotes-test.cjs',
  'clipboard-format-test.cjs',
  'clipboard-ui-test.cjs',
  'writing-range-integrity-test.cjs',
  'file-commands-test.cjs',
  'recent-projects-test.cjs',
  'writing-context-test.cjs',
  'startup-ui-test.cjs',
  'autosave-path-test.cjs',
  'autosave-recovery-test.cjs',
  'project-save-test.cjs',
  'project-save-ipc-test.cjs',
  'electron-security-test.cjs',
  'project-html-security-test.cjs',
  'display-security-test.cjs',
  'display-values-test.cjs',
  'settings-ui-test.cjs',
  'writing-derivation-test.cjs',
  'native-draft-history-test.cjs',
  'modal-ui-test.cjs',
  'menu-ui-test.cjs',
  'source-integrity-test.cjs',
  'smarttype-test.cjs',
  'smarttype-ui-test.cjs',
  'search-test.cjs',
  'search-ui-test.cjs',
  'zhsp-compat-test.cjs',
  'history-test.cjs',
  'input-performance-test.cjs',
  'pagination-safety-test.cjs',
  'pdf-transport-test.cjs',
  'studio-theme-test.cjs',
  'appearance-test.cjs',
  'outline-reorder-test.cjs',
  'scene-notes-test.cjs',
  'storyboard-drop-test.cjs',
  'storyboard-acts-test.cjs',
  'reports-test.cjs',
  'board-polish-test.cjs',
  'board-workspace-model-test.cjs',
  'board-workspace-ui-test.cjs',
  'writing-controls-test.cjs',
  'progress-bands-test.cjs',
];

for (const [index, suite] of suites.entries()) {
  console.log(`\n[${index + 1}/${suites.length}] ${suite}`);
  const result = spawnSync(process.execPath, [path.join(__dirname, suite)], {
    cwd: root,
    stdio: 'inherit',
    timeout: 120000,
  });
  if (result.error || result.signal || result.status !== 0) {
    console.error(`FAILED: ${suite}`, result.error || result.signal || result.status);
    process.exit(1);
  }
}
console.log(`\nCore regression: ${suites.length}/${suites.length} suites passed.`);
