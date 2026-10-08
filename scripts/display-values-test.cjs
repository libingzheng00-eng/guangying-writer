/** Pure metadata display boundaries. Synthetic values, in-memory compilation,
 * no DOM, network, image decoding, Electron launch or project-file writes.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
let checks = 0;
const check = (label, run) => { run(); checks++; console.log(`PASS ${label}`); };

(async () => {
  const result = await esbuild.build({
    entryPoints: [path.join(root, 'src/utils/displayValues.ts')],
    bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent',
  });
  // Evaluate without browser globals, including when imported by a DOM harness.
  const saved = new Map();
  for (const name of ['window', 'document', 'CSS', 'Image', 'fetch', 'atob']) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, get() { throw new Error(`Unexpected ${name} dependency`); } });
  }
  try {
    const filename = path.join(root, '.display-values-memory.cjs');
    const compiled = new Module(filename, module);
    compiled.filename = filename; compiled.paths = Module._nodeModulePaths(root);
    compiled._compile(result.outputFiles[0].text, filename);
    const { safeDisplayColor: color, safeEmbeddedImageSource: image } = compiled.exports;
    const named = `aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen`.split(' ');
    check('all 148 CSS named color spellings are represented once', () => assert.equal(new Set(named).size, 148));
    for (const name of named) check(`named color ${name}`, () => assert.equal(color(name, '#000'), name));
    const validColors = [
      '#abc', '#ABCD', '#012345', '#01234567', '  #AbC  ', 'ReBeccAPurple', 'transparent', 'currentColor',
      'rgb(1,2,3)', 'rgba(1, 2, 3, .5)', 'rgb(10%,20%,30%)', 'rgba(10%,20%,30%,50%)',
      'rgba(1,2,3)', 'rgb(1,2,3,50%)', 'rgb(1 20% 3 / 50%)', 'RGBA(1 2 3)',
      'rgb(-1 +2 .3)', 'rgb(1e2 2E+1 3e-2 / +.5)', 'rgb(300 -5 0 / 2)',
      'hsl(120, 40%, 50%)', 'hsla(120deg,40%,50%,.3)', 'hsl(.5turn 50% 60% / 20%)',
      'hsla(-1rad 50% 60%)', 'hsl(200grad,50%,60%,25%)', 'hwb(120 30% 20% / .8)',
      'hsl(120 40 50)', 'hsla(120 40% 50 / .5)', 'hwb(120 30 20% / .8)',
      'lab(50% -40 30 / 75%)', 'lch(50 20% 1.5rad)', 'oklab(.6 .1 -.2)', 'oklch(60% .2 120deg / .5)',
      'color(srgb 1 0 0)', 'color(srgb-linear 10% 0 .5 / 80%)', 'color(display-p3 1 .2 .3)',
      'color(display-p3-linear 1 .2 .3)', 'color(a98-rgb 1 0 0)', 'color(prophoto-rgb .1 .2 .3)',
      'color(rec2020 .2 .3 .4)', 'color(xyz .2 .3 .4)', 'color(xyz-d50 .2 .3 .4)', 'COLOR(XYZ-D65 .2 .3 .4)',
    ];
    validColors.forEach((value, i) => check(`valid color syntax ${i} keeps exact bytes`, () => assert.equal(color(value, '#000'), value)));
    const invalidColors = [
      undefined, null, 1, {}, [], '', ' ', '#12', '#12345', '#1234567', '#zzzzzz', 'notacolor', 'inherit',
      'url(https://fixture.invalid/a)', 'URL(data:image/png;base64,AA==)', 'var(--color)', 'env(color)',
      'var(--color,url(file:///fixture.png))', 'rgb(var(--r) 0 0)', 'hsl(calc(1 + 1) 50% 50%)',
      'red; background:url(https://fixture.invalid/a)', 'red!important', 'red/*comment*/', 'red\\0a',
      '\\72 ed', 'u\\72l(file:///fixture.png)', '<img src=x>', '</style><script>bad()</script>',
      'red\n', 'red\r', 'red\t', 'red\0', 'red\x7f', 'red\u0085', '\u00a0red', 'red"', "red'", 'red:blue',
      'rgb(1 2)', 'rgb(1 2 3 4)', 'rgb(1,2,3,4,5)', 'rgb(1%,2,3)', 'rgb(1,2,3 / .5)',
      'rgb(1 2 3 /)', 'rgb(1 2 3 / .5 / .6)', 'rgb(1 2 3 / .5 .6)', 'rgb(NaN 0 0)',
      'rgb(Infinity 0 0)', 'rgb(1e999 0 0)', 'rgb(1deg 0 0)', 'rgb(1. 2 3)', 'rgb(1px 2 3)',
      'rgb(none 0 0)', 'hsl(120,40,50)', 'hsl(120% 40% 50%)', 'hwb(120,40%,50%)',
      'lab(50 0 0deg)', 'lch(50 20 30%)', 'oklab(50,0,0)', 'color(unknown 1 0 0)',
      'color(--custom 1 0 0)', 'color(srgb,1,0,0)', 'color(srgb 1 0 0deg)', 'color(srgb 1 0)',
      'color(srgb 1 0 0) url(x)', 'rgb((1) 2 3)', 'rgb (1 2 3)',
    ];
    invalidColors.forEach((value, i) => check(`unsafe/malformed color ${i} uses safe fallback`, () => assert.equal(color(value, '#13579b'), '#13579b')));
    check('default fallback remains the historical card color', () => assert.equal(color(null), '#fff7d6'));
    check('unsafe fallback cannot introduce a CSS URL', () => assert.equal(color(null, 'url(file:///fixture.png)'), '#fff7d6'));
    check('valid primary is unaffected by an unsafe fallback', () => assert.equal(color('red', 'var(--x)'), 'red'));

    const validImages = [
      'data:image/png;base64,iVBORw0KGgo=', 'data:image/jpeg;base64,/9j/2Q==',
      'DATA:IMAGE/PNG;BASE64,AA==', 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22/%3E',
      'data:image/svg+xml;charset=utf-8,%3Csvg/%3E', 'data:image/svg+xml;charset=UTF-8;base64,PHN2Zy8+',
      'data:application/octet-stream;base64,iVBORw0KGgo=', 'data:application/octet-stream,%89PNG',
      'data:;base64,iVBORw0KGgo=', 'data:,%89PNG', 'data:;charset=utf-8,%89PNG',
      'data:image/png;name=synthetic.png;charset=utf-8;base64,AA==',
      'data:image/svg+xml;charset=%22utf-8%22,%3Csvg/%3E', 'data:image/svg+xml,<svg>\n</svg>',
      'data:image/png;base64,not-a-decodable-image', 'data:image/png,', 'data:,',
    ];
    validImages.forEach((value, i) => check(`embedded image ${i} preserves source without decoding`, () => assert.equal(image(value), value)));
    const invalidImages = [
      undefined, null, 4, {}, [], '', 'https://fixture.invalid/image.png', 'http://fixture.invalid/image.png',
      'file:///synthetic/image.png', 'blob:https://fixture.invalid/id', 'javascript:bad()', '//fixture.invalid/x',
      './image.png', '../image.png', '/image.png', 'C:\\synthetic\\image.png',
      ' data:image/png;base64,AA==', '\tdata:image/png,AA==', '\ndata:image/png,AA==',
      'd\nata:image/png,AA==', 'data :image/png,AA==', 'data:\timage/png,AA==', 'data:image/png ;base64,AA==',
      'data:image/png;\nbase64,AA==', 'data:image/png;\rbase64,AA==', 'data:image/png\0,AA==',
      'data:image/png\u0085,AA==', 'data:image/png\u00a0,AA==', 'data:image/png\\,AA==',
      'data:text/html,<script>bad()</script>', 'data:application/javascript,bad()', 'data:text/xml,%3Csvg/%3E',
      'data:image/,AA==', 'data:image/*,AA==', 'data:image/png', 'data:image/png;base64',
      'data:image/png;;base64,AA==', 'data:image/png;base64;base64,AA==',
      'data:image/png;base64;charset=utf-8,AA==', 'data:image/png;not-a-parameter,AA==',
      'data:image/png;charset=,AA==', 'data:image/png;charset="utf-8",AA==',
      'data:image/png;charset=utf-8 bad,AA==', 'data:image/png;charset=%zz,AA==',
      'data:image/png;name=<img>,AA==', 'data:image/png;base64%0a,AA==',
    ];
    invalidImages.forEach((value, i) => check(`unsafe/malformed image source ${i} is absent`, () => assert.equal(image(value), undefined)));
    check('project-owned values are not mutated or coerced', () => {
      const value = Object.freeze({ color: 'red', img: 'data:image/png;base64,AA==', toString() { throw new Error('No coercion'); } });
      assert.equal(color(value), '#fff7d6'); assert.equal(image(value), undefined);
      assert.equal(color(value.color), value.color); assert.equal(image(value.img), value.img);
    });
  } finally {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
  console.log(`Display values: ${checks} checks passed (pure syntax boundary; no DOM, network or image decoding).`);
})().catch(error => { console.error(error); process.exitCode = 1; });
