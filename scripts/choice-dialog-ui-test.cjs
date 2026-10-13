/** Named-choice dialog: focus containment, Esc/backdrop safety and queueing in jsdom. */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');
const repo = path.resolve(__dirname, '..');
const dom = new JSDOM('<!doctype html><html><body><button id="outside">外部</button><div id="root"></div></body></html>', { url: 'http://choice-dialog.invalid/', pretendToBeVisual: true });
const w = dom.window;
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Node', 'Element', 'Event', 'MouseEvent', 'KeyboardEvent', 'FocusEvent', 'DOMParser', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle']) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'window' ? w : w[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = React;
let checks = 0;
const check = (name, actual, expected = true) => { assert.deepEqual(actual, expected, name); checks++; console.log(`  ✓ ${name}`); };
const q = selector => document.querySelector(selector);
const click = node => act(async () => { node.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })); });
const key = (target, value) => act(async () => { target.dispatchEvent(new w.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })); });

(async () => {
  const built = await esbuild.build({ stdin: { contents: `
    export { ChoiceDialogHost } from './src/components/ChoiceDialog';
    export { askChoice } from './src/app/choiceDialog';
  `, resolveDir: repo, loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' });
  const filename = path.join(__dirname, 'choice-dialog.bundle.cjs');
  const mod = new Module(filename, module);
  mod.filename = filename; mod.paths = Module._nodeModulePaths(__dirname); mod._compile(built.outputFiles[0].text, filename);
  const { ChoiceDialogHost, askChoice } = mod.exports;
  const request = { title: '导入文本 / FDX', message: '识别到 3 个元素。', warning: '有未保存修改。', cancelValue: 'cancel',
    options: [{ value: 'append', label: '追加到剧本末尾', tone: 'primary' }, { value: 'replace', label: '替换整个剧本', tone: 'danger' }, { value: 'cancel', label: '不导入' }] };

  check('no mounted host resolves to the safe value', await askChoice(request), 'cancel');
  const root = createRoot(q('#root'));
  await act(async () => root.render(React.createElement(ChoiceDialogHost)));
  q('#outside').focus();
  let answer;
  await act(async () => { answer = askChoice(request); });
  check('dialog is modal and labelled', [q('[role="dialog"]').getAttribute('aria-modal'), q('[role="dialog"] h3').textContent], ['true', '导入文本 / FDX']);
  check('buttons say what they do', [...document.querySelectorAll('[data-choice]')].map(node => node.textContent), ['追加到剧本末尾', '替换整个剧本', '不导入']);
  check('warning is shown inside the dialog', q('[role="alert"]').textContent, '有未保存修改。');
  check('focus starts on the primary, non-destructive option', document.activeElement.dataset.choice, 'append');
  check('background is inert while open', q('#outside').hasAttribute('inert'));
  await key(document.activeElement, 'Escape');
  check('Esc chooses the cancel value', await answer, 'cancel');
  check('dialog closes and background is restored', [q('[role="dialog"]'), q('#outside').hasAttribute('inert')], [null, false]);

  await act(async () => { answer = askChoice(request); });
  await click(q('.modal-backdrop'));
  check('backdrop click is the safe cancel value', await answer, 'cancel');

  let first, second;
  await act(async () => { first = askChoice(request); second = askChoice({ ...request, title: '第二个问题' }); });
  await click(q('[data-choice="replace"]'));
  check('explicit destructive choice is returned', await first, 'replace');
  check('queued question appears next', q('[role="dialog"] h3').textContent, '第二个问题');
  await click(q('[data-choice="append"]'));
  check('queued question resolves independently', await second, 'append');

  await act(async () => root.unmount());
  console.log(`\n=== choice-dialog-ui ${checks}/${checks} PASS (jsdom) ===`);
})().catch(error => { console.error(error); process.exit(1); });
