'use strict';

// Suggestions only: never rewrite an already chosen file path or the project title.
// Windows forbids these characters and DOS device names even with an extension.
function dialogFileName(name, platform = process.platform) {
  if (platform !== 'win32') return name;
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '');
  if (!cleaned) return '未命名剧本';
  return /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(cleaned)
    ? `_${cleaned}` : cleaned;
}

module.exports = { dialogFileName };
