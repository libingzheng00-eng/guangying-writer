/* One local baseline; native Electron/OS clipboard checks remain separate. */
const { spawn } = require('node:child_process');
const os = require('node:os');
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
  'choice-dialog-ui-test.cjs',
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
  'find-replace-test.cjs',
  'fdx-test.cjs',
  'zhsp-compat-test.cjs',
  'forward-compat-test.cjs',
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
  'card-notes-ui-test.cjs',
  'writing-controls-test.cjs',
  'progress-bands-test.cjs',
  'revision-workspace-test.cjs',
  'annotations-test.cjs',
  'delivery-checks-test.cjs',
  'review-store-test.cjs',
  'scene-review-ui-test.cjs',
  'revision-workspace-ui-test.cjs',
  'character-lines-model-test.cjs',
  'character-lines-store-test.cjs',
  'character-lines-ui-test.cjs',
  'character-navigation-test.cjs',
  'export-command-races-test.cjs',
];

// 套件彼此独立（各自的 jsdom、内存打包、临时目录），并行运行；输出按清单顺序整段打印。
// CORE_JOBS=1 可退回逐个运行，便于定位问题。
const jobs = Math.max(1, Math.min(Number(process.env.CORE_JOBS) || Math.min(os.cpus().length, 6), suites.length));

function run(suite) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [path.join(__dirname, suite)], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ suite, code, signal, output, seconds: (Date.now() - started) / 1000 });
    });
  });
}

(async () => {
  const results = new Array(suites.length);
  let next = 0, printed = 0, failed = null;
  const flush = () => {
    while (printed < suites.length && results[printed]) {
      const r = results[printed];
      console.log(`\n[${printed + 1}/${suites.length}] ${r.suite} (${r.seconds.toFixed(1)}s)`);
      process.stdout.write(r.output);
      if ((r.code !== 0 || r.signal) && !failed) failed = r;
      printed++;
    }
  };
  const worker = async () => {
    while (next < suites.length && !failed) {
      const index = next++;
      results[index] = await run(suites[index]);
      if (results[index].code !== 0 || results[index].signal) failed = failed || results[index];
      flush();
    }
  };
  await Promise.all(Array.from({ length: jobs }, worker));
  flush();
  if (failed) {
    console.error(`FAILED: ${failed.suite}`, failed.signal || failed.code);
    process.exit(1);
  }
  console.log(`\nCore regression: ${suites.length}/${suites.length} suites passed (${jobs} parallel jobs).`);
})();
