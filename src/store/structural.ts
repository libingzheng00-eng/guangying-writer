/**
 * 通用修改（mutate）用的草稿复制与结构共享。
 *
 * - draftCopy：只复制对象和数组的外壳；字符串（包括图片 data URL）按值共享，
 *   不再每次把整个工程 JSON 序列化再解析一遍。
 * - keepUnchanged：改完以后，把内容没有变化的部分换回原来的对象。
 *   撤销历史只多保存真正改动的段落，没改的段落、图片、设置都与上一步共用；
 *   写作页也只重画改动过的段落。
 *
 * 与原来的 JSON 复制保持同样的判断：值为 undefined 的键视同不存在，NaN 与 NaN 相等。
 * 调用者拿到的草稿是全新的对象，可以随意修改；已提交的快照永远不会被改动。
 * keepUnchanged 只改写 draftCopy 造出来的草稿对象；修改函数从别处放进来的对象
 * （例如改稿库里的旧段落）只比较、不改写。
 */

type Plain = Record<string, unknown>;

const isPlainObject = (value: unknown): value is Plain =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const own = (object: Plain, key: string) =>
  Object.prototype.hasOwnProperty.call(object, key) ? object[key] : undefined;

/** draftCopy 造出来的对象和数组；只有它们可以在共享时被改写。 */
const drafts = new WeakSet<object>();

function assign(target: Plain, key: string, value: unknown) {
  // 旧文件里可能有名为 __proto__ 的数据键：按普通数据写入，不能改原型。
  if (key === '__proto__') Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  else target[key] = value;
}

export function draftCopy<T>(value: T): T {
  if (Array.isArray(value)) {
    const out = new Array(value.length);
    for (let i = 0; i < value.length; i++) out[i] = draftCopy(value[i]);
    drafts.add(out);
    return out as T;
  }
  if (isPlainObject(value)) {
    const out: Plain = {};
    for (const key of Object.keys(value)) {
      const item = value[key];
      if (item === undefined || typeof item === 'function') continue;
      assign(out, key, draftCopy(item));
    }
    drafts.add(out);
    return out as T;
  }
  return value;
}

/** 把 next 里与 prev 内容相同的部分换回 prev 的对象；整体相同时直接返回 prev。 */
export function keepUnchanged<T>(prev: T, next: T): T {
  return share(prev, next) as T;
}

function share(prev: unknown, next: unknown): unknown {
  if (prev === next) return prev;
  if (Array.isArray(prev) && Array.isArray(next)) return shareArray(prev, next);
  if (isPlainObject(prev) && isPlainObject(next)) return shareObject(prev, next);
  if (typeof prev === 'number' && typeof next === 'number' && Number.isNaN(prev) && Number.isNaN(next)) return prev;
  return next;
}

function shareObject(prev: Plain, next: Plain): Plain {
  const writable = drafts.has(next);
  let same = true;
  let defined = 0;
  for (const key of Object.keys(next)) {
    const value = next[key];
    if (value === undefined) continue;
    defined++;
    const before = own(prev, key);
    const kept = share(before, value);
    if (kept !== before) {
      same = false;
      // 别处放进来的对象不改写；它已经不同于 prev，原样留用即可。
      if (!writable) return next;
    }
    if (kept !== value) assign(next, key, kept);
  }
  if (!same) return next;
  // next 的每个键都与 prev 相同；prev 还有别的有效键时仍算改动（键被删除）。
  let previous = 0;
  for (const key of Object.keys(prev)) if (prev[key] !== undefined) previous++;
  return previous === defined ? prev : next;
}

function shareArray(prev: unknown[], next: unknown[]): unknown[] {
  const writable = drafts.has(next);
  let same = prev.length === next.length;
  if (!same && !writable) return next;
  let byId: Map<string, unknown> | undefined;
  for (let i = 0; i < next.length; i++) {
    const item = next[i];
    let base = prev[i];
    // 段落、卡片、场次资料都带 id；插入或删除后按 id 找回原对象，后面的段落照样共用。
    const id = isPlainObject(item) && typeof item.id === 'string' ? item.id : undefined;
    if (id !== undefined && !(isPlainObject(base) && base.id === id)) {
      if (!byId) {
        byId = new Map();
        for (const entry of prev) {
          if (isPlainObject(entry) && typeof entry.id === 'string' && !byId.has(entry.id)) byId.set(entry.id, entry);
        }
      }
      base = byId.get(id);
    }
    const kept = base === undefined ? item : share(base, item);
    if (kept !== prev[i]) {
      same = false;
      if (!writable) return next;
    }
    if (kept !== item) next[i] = kept;
  }
  return same ? prev : next;
}
