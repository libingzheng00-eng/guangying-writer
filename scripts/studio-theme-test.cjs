/** 静态外观守护：只读取源码，用 CSS parser 检查声明，不模拟浏览器级联。
 * 不访问用户资料，不启动应用，不写工程；真实主题/PDF/交互仍须浏览器验收。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function parse(css) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => errors.push(error.message));
  const dom = new JSDOM('<!doctype html><head></head>', { virtualConsole });
  const style = dom.window.document.createElement('style');
  style.textContent = css;
  dom.window.document.head.appendChild(style);
  assert.deepEqual(errors, [], 'CSS 必须可以解析');
  assert.ok(style.sheet, 'CSS 缺少有效 stylesheet');
  return { dom, rules: Array.from(style.sheet.cssRules) };
}

// 仅保护承载正文、素材、分页和坐标的已知结构；不限制工具栏的 UI 字体。
const structure = /\.(?:editor(?:__scroll)?|script-flow(?:__tail)?|sc-(?:el(?:--[\w-]+)?|dual-row|dual-col|scene-row(?:__main)?|scene-no(?:--right)?|measure)|preview__(?:page|scroll)|page__body|board__(?:canvas|world|marquee)|board-links|bcard(?:__[\w-]+|--[\w-]+)?|writing-material-(?:layer|card(?:__[\w-]+|--[\w-]+)?)|write-progress(?:__[\w-]+)?)(?![\w-])/;
const geometry = /^(?:(?:min-|max-)?(?:width|height|inline-size|block-size)|(?:margin|padding|inset)(?:-.+)?|top|right|bottom|left|position|display|overflow(?:-.+)?|box-sizing|transform(?:-origin)?|translate|scale|rotate|zoom|grid(?:-.+)?|flex(?:-.+)?|gap|row-gap|column-gap|align-(?:items|content|self)|order|float|clear|line-height|border(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?(?:-width)?)$/;
const screenplay = /\.(?:script-flow|sc-(?:el(?:--[\w-]+)?|dual-row|dual-col|scene-row(?:__main)?|scene-no(?:--right)?|measure)|preview__page|page__body)(?![\w-])/;

function validate(rules, insideScreen = false, output = []) {
  for (const rule of rules) {
    if (rule.type === 4) { // CSSMediaRule
      const onlyScreen = rule.media.mediaText.split(',').every((part) => /^\s*(?:only\s+)?screen\b/i.test(part));
      validate(Array.from(rule.cssRules), insideScreen || onlyScreen, output);
    } else if (rule.type === 12) { // CSSSupportsRule, if later needed inside screen
      validate(Array.from(rule.cssRules), insideScreen, output);
    } else {
      assert.equal(rule.type, 1, '外观层仅允许样式、screen 和 supports 分组');
      assert.ok(insideScreen, `样式须隔离在 screen 内: ${rule.selectorText}`);
      output.push(rule);
      for (let i = 0; i < rule.style.length; i += 1) {
        const property = rule.style[i];
        assert.notEqual(property, '--zoom', '外观层不可改缩放变量');
        if (!structure.test(rule.selectorText)) continue;
        assert.ok(!geometry.test(property), `不可改结构几何: ${rule.selectorText} { ${property} }`);
        if (property === 'justify-content') {
          // 场景编号改左对齐只改变数字在色条内的位置，不改变比例/点击范围。
          assert.ok(/\.write-progress__scene(?![\w-])/.test(rule.selectorText), '仅场景数字允许更改水平对齐');
        }
        if (screenplay.test(rule.selectorText)) {
          assert.ok(!/^(?:font(?:-.+)?|letter-spacing|word-spacing|white-space|word-break|overflow-wrap|text-indent)$/.test(property), `不可改正文排版: ${property}`);
        }
      }
    }
  }
  return output;
}

function luminance(hex) {
  assert.match(hex, /^#[0-9a-f]{6}$/i, '对比检查只接受不透明六位 HEX，透明色需真实背景合成验收');
  const channels = hex.slice(1).match(/../g).map((value) => parseInt(value, 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(foreground, background) {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}
function tokenRules(rules, selector) {
  const result = {};
  for (const rule of rules.filter((candidate) => candidate.selectorText === selector)) {
    for (let i = 0; i < rule.style.length; i += 1) {
      const property = rule.style[i];
      if (property.startsWith('--')) result[property] = rule.style.getPropertyValue(property).trim();
    }
  }
  return result;
}

const studio = parse(read('src/styles/studio.css'));
const base = parse(read('src/styles/app.css'));
try {
  const rules = validate(studio.rules);
  assert.ok(rules.length > 0, '不能用清空外观层规避检查');

  // 确认守护确实拒绝两类回归；仅解析内存中的合成 CSS。
  for (const css of ['.script-flow { color: red; }', '@media screen { .writing-material-card { width: 320px; } }', '@media screen { .sc-el { line-height: 2; } }']) {
    const invalid = parse(css);
    try { assert.throws(() => validate(invalid.rules), assert.AssertionError); }
    finally { invalid.dom.window.close(); }
  }

  const progress = read('src/model/progress.ts');
  const paletteLiteral = progress.match(/export const SCENE_BAND_PALETTE\s*=\s*\[([^\]]+)\]/);
  assert.ok(paletteLiteral, '场景调色板应为可审查的静态颜色列表');
  const palette = Array.from(paletteLiteral[1].matchAll(/['"](#[0-9a-f]{6})['"]/gi), (match) => match[1]);
  assert.equal(palette.length, 10, '保留十色场景循环');
  const sceneRule = rules.find((rule) => rule.selectorText.endsWith('.write-progress__scene'));
  assert.ok(sceneRule, '场景数字须有明确文字色');
  assert.ok(['#263328', 'rgb(38, 51, 40)'].includes(sceneRule.style.getPropertyValue('color').trim()), '调色板对比基于实际场景数字文字色');
  const ratios = palette.map((color) => contrast('#263328', color));
  assert.ok(ratios.every((ratio) => ratio >= 4.5), '场景数字与全部十个底色至少 4.5:1');

  const rootTokens = tokenRules(base.rules, ':root');
  const night = { ...rootTokens, ...tokenRules(rules, '.app-shell[data-theme]') };
  const day = { ...night, ...tokenRules(rules, ".app-shell[data-theme='day']") };
  for (const [name, tokens] of [['night', night], ['day', day]]) {
    const primary = contrast(tokens['--studio-strong-ink'], tokens['--accent']);
    assert.ok(primary >= 4.5, `${name} 主按钮文字至少 4.5:1，实际 ${primary.toFixed(2)}`);
    for (const background of ['--panel', '--control-bg', '--control-hover']) {
      const danger = contrast(tokens['--danger'], tokens[background]);
      assert.ok(danger >= 4.5, `${name} 危险文字在 ${background} 至少 4.5:1，实际 ${danger.toFixed(2)}`);
    }
    console.log(`${name} primary contrast: ${primary.toFixed(2)}:1; danger surfaces >= 4.5:1`);
  }
  console.log(`studio theme: ${rules.length} screen-only rules; protected geometry unchanged; 10 scene colors min ${Math.min(...ratios).toFixed(2)}:1`);
  console.log('边界：只检查此外观文件中的声明和静态不透明色值，不计算真实 CSS 级联、透明合成、最终尺寸或 PDF；不替代实机验收。');
} finally {
  studio.dom.window.close();
  base.dom.window.close();
}
