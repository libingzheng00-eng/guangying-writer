'use strict';

const { URL } = require('node:url');
const MAX_CONTENT_BYTES = 256 * 1024 * 1024;
const EXPORT_EXTENSIONS = new Set(['zhsp', 'fdx', 'txt', 'md', 'html']);
const navigations = new WeakMap();

function rejectRequest() {
  const error = new Error('请求未获授权或参数无效（ESECURITY）。请重新选择文件后重试。');
  error.code = 'ESECURITY';
  throw error;
}

function entryURL(value) {
  try { const url = new URL(value); url.hash = ''; return url.href; }
  catch { return null; }
}

function requireTrustedSender(event, window, expectedURL) {
  // URL alone is not an identity: same-origin child frames/other windows must
  // never obtain the main window's file capabilities.
  const contents = window?.webContents;
  if (!window || window.isDestroyed() || !contents || contents.isDestroyed() ||
      event?.sender !== contents || !event.senderFrame ||
      event.senderFrame !== contents.mainFrame ||
      entryURL(event.senderFrame.url) !== entryURL(expectedURL) ||
      entryURL(contents.getURL()) !== entryURL(expectedURL)) rejectRequest();
}

function secureWindow(window) {
  const contents = window.webContents;
  navigations.set(contents, 0);
  contents.on('did-start-navigation', (event, _url, inPlace, isMainFrame) => {
    if ((event.isMainFrame ?? isMainFrame) && !(event.isSameDocument ?? inPlace)) navigations.set(contents, navigations.get(contents) + 1);
  });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  for (const name of ['will-navigate', 'will-frame-navigate', 'will-redirect', 'will-attach-webview']) {
    contents.on(name, event => event.preventDefault());
  }
  contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  contents.session.setPermissionCheckHandler(() => false);
  // Exports are mediated by native Save dialogs, never by arbitrary links.
  contents.session.on('will-download', event => event.preventDefault());
}

function senderGuard(event, getWindow, expectedURL) {
  requireTrustedSender(event, getWindow(), expectedURL);
  const frame = event.senderFrame;
  const navigation = navigations.get(event.sender);
  return () => {
    requireTrustedSender(event, getWindow(), expectedURL);
    if (event.senderFrame !== frame || navigations.get(event.sender) !== navigation) rejectRequest();
  };
}

function record(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) rejectRequest();
}
function text(value, maximum, optional = false) {
  if (optional && value === undefined) return;
  if (typeof value !== 'string' || value.includes('\0') || value.length > maximum) rejectRequest();
}
function content(value) {
  if (typeof value !== 'string' || value.length > MAX_CONTENT_BYTES || Buffer.byteLength(value, 'utf8') > MAX_CONTENT_BYTES) rejectRequest();
}
function savePayload(payload, saveAs = false) {
  record(payload); content(payload.content); text(payload.name, 4096, true);
  if (saveAs) {
    if (payload.ext !== undefined && (typeof payload.ext !== 'string' || !EXPORT_EXTENSIONS.has(payload.ext.toLowerCase()))) rejectRequest();
  } else if (payload.path !== undefined && payload.path !== null) {
    text(payload.path, 32768);
    if (!payload.path) rejectRequest();
  }
  return payload;
}
function pdfPayload(opts) {
  record(opts); text(opts.name, 4096, true);
  if (opts.mode !== undefined && opts.mode !== 'creative' && opts.mode !== 'print') rejectRequest();
  if (opts.landscape !== undefined && typeof opts.landscape !== 'boolean') rejectRequest();
  if (opts.mode === 'creative') {
    content(opts.html);
    if (!/<section\b[^>]*\bclass\s*=\s*["'][^"']*\bexport-sheet\b[^"']*["']/i.test(opts.html)) rejectRequest();
    record(opts.pageSize);
    // Existing creative canvas is bounded to 18,000 CSS pixels per page.
    for (const dimension of ['width', 'height']) {
      if (!Number.isFinite(opts.pageSize[dimension]) || opts.pageSize[dimension] < 353 || opts.pageSize[dimension] > 5_000_000) rejectRequest();
    }
  }
  return opts;
}

module.exports = { MAX_CONTENT_BYTES, rejectRequest, requireTrustedSender, senderGuard, secureWindow, savePayload, pdfPayload };
