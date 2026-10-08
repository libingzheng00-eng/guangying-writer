/** Display-only boundaries for untrusted project metadata. These helpers neither
 * rewrite the project nor depend on a browser, fetch resources or decode images.
 */
const DEFAULT_COLOR = '#fff7d6';
// CSS Color 4 named colors, including all gray/grey aliases.
const NAMED_COLORS = new Set(`
aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue
blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue
cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey
darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon
darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet
deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen
fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew
hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon
lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey
lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey
lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine
mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen
mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite
navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen
paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple
rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell
sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan
teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen
transparent currentcolor
`.trim().split(/\s+/));

const COLOR_SPACES = new Set([
  'srgb', 'srgb-linear', 'display-p3', 'display-p3-linear', 'a98-rgb',
  'prophoto-rgb', 'rec2020', 'xyz', 'xyz-d50', 'xyz-d65',
]);
const NUMERIC = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)(%|deg|grad|rad|turn)?$/i;
type NumericKind = 'number' | 'percent' | 'angle';
function numericKind(token: string): NumericKind | undefined {
  const match = NUMERIC.exec(token);
  if (!match || !Number.isFinite(Number(match[1]))) return undefined;
  return !match[2] ? 'number' : match[2] === '%' ? 'percent' : 'angle';
}
const numberOrPercent = (token: string) => {
  const kind = numericKind(token);
  return kind === 'number' || kind === 'percent';
};
const hue = (token: string) => {
  const kind = numericKind(token);
  return kind === 'number' || kind === 'angle';
};

function isDisplayColor(value: unknown): value is string {
  // ASCII spaces are allowed, but no controls, escapes, declarations, markup or
  // non-ASCII whitespace. In particular, never accept var()/env()/calc() tokens.
  if (typeof value !== 'string' || /[^a-z0-9#().,%/+ -]/i.test(value)) return false;
  const color = value.trim().toLowerCase();
  if (NAMED_COLORS.has(color) || /^#(?:[a-f0-9]{3}|[a-f0-9]{4}|[a-f0-9]{6}|[a-f0-9]{8})$/.test(color)) return true;
  const match = /^(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(([^()]*)\)$/.exec(color);
  if (!match) return false;
  const [, name, body] = match;
  let parts: string[];
  if (body.includes(',')) {
    // Legacy RGB requires three numbers OR three percentages; comma and slash
    // syntaxes cannot be mixed. rgba/hsla are aliases, not separate grammars.
    if (!['rgb', 'rgba', 'hsl', 'hsla'].includes(name) || body.includes('/')) return false;
    parts = body.split(',').map(part => part.trim());
    if (parts.length !== 3 && parts.length !== 4) return false;
    if (parts.length === 4 && !numberOrPercent(parts.pop()!)) return false;
    if (name === 'rgb' || name === 'rgba') {
      const kind = numericKind(parts[0]);
      return (kind === 'number' || kind === 'percent') && parts.every(part => numericKind(part) === kind);
    }
    return hue(parts[0]) && numericKind(parts[1]) === 'percent' && numericKind(parts[2]) === 'percent';
  } else {
    const sections = body.split('/');
    if (sections.length > 2 || (sections.length === 2 && !numberOrPercent(sections[1].trim()))) return false;
    parts = sections[0].trim().split(/ +/);
    if (name === 'color' && !COLOR_SPACES.has(parts.shift()!)) return false;
    if (parts.length !== 3) return false;
  }
  if (name === 'hsl' || name === 'hsla' || name === 'hwb') {
    // Modern Color 4 permits numbers as well as percentages for S/L and W/B.
    return hue(parts[0]) && numberOrPercent(parts[1]) && numberOrPercent(parts[2]);
  }
  if (name === 'lch' || name === 'oklch') {
    return numberOrPercent(parts[0]) && numberOrPercent(parts[1]) && hue(parts[2]);
  }
  return parts.every(numberOrPercent);
}

/** Preserve approved color bytes; even an invalid caller fallback cannot reopen
 * the CSS URL/variable boundary. Out-of-gamut finite numbers remain CSS's job.
 */
export function safeDisplayColor(value: unknown, fallback = DEFAULT_COLOR): string {
  return isDisplayColor(value) ? value : isDisplayColor(fallback) ? fallback : DEFAULT_COLOR;
}

const MIME = /^(?:image\/[a-z0-9!#$&^_.+-]+|application\/octet-stream)$/i;
const PARAMETER = /^[a-z0-9!#$&^_.+*-]+=(?:[a-z0-9!#$&^_.+*'~-]|%[a-f0-9]{2})+$/i;

/** Permit only embedded image data at the rendering boundary. Empty MIME and
 * octet-stream preserve old FileReader images; payload validity, including SVG
 * and base64, is intentionally left to the existing image decoder.
 */
export function safeEmbeddedImageSource(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^data:/i.test(value)) return undefined;
  const comma = value.indexOf(',');
  if (comma < 5) return undefined;
  const header = value.slice(5, comma);
  if (/[\s\u0000-\u001f\u007f-\u009f\\]/.test(header)) return undefined;
  const [mime, ...parameters] = header.split(';');
  if (mime && !MIME.test(mime)) return undefined;
  for (let i = 0; i < parameters.length; i++) {
    const parameter = parameters[i];
    if (/^base64$/i.test(parameter)) {
      if (i !== parameters.length - 1) return undefined;
    } else if (!PARAMETER.test(parameter)) return undefined;
  }
  return value;
}
