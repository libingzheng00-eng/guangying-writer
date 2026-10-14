import type { ScriptElement } from './types';

/*
 * 备选台词：一段对白可以存好几个版本。当前版本就是 element.text（导出、分页、统计都只看它）；
 * 其余版本放在 alts，altNo 记当前版本排第几，切换时按原顺序放回。
 */

export const altTotal = (el: Pick<ScriptElement, 'alts'>) => (el.alts?.length || 0) + 1;

export function currentAltNo(el: Pick<ScriptElement, 'alts' | 'altNo'>): number {
  const total = altTotal(el);
  return total > 1 && Number.isInteger(el.altNo) && el.altNo! >= 1 && el.altNo! <= total ? el.altNo! : 1;
}

/** 全部版本，按顺序。 */
export function altVersions(el: Pick<ScriptElement, 'text' | 'alts' | 'altNo'>): string[] {
  const versions = [...(el.alts || [])];
  versions.splice(currentAltNo(el) - 1, 0, el.text);
  return versions;
}

function apply(el: ScriptElement, versions: string[], current: number): void {
  el.text = versions[current - 1];
  const rest = versions.filter((_, index) => index !== current - 1);
  if (rest.length) { el.alts = rest; el.altNo = current; } else { delete el.alts; delete el.altNo; }
}

/** 新建一个版本：复制当前文字放到最后并切过去，旧版本保留，作者直接在新版本上改。 */
export function addAlt(el: ScriptElement): void {
  const versions = altVersions(el);
  versions.push(el.text);
  apply(el, versions, versions.length);
}

/** 切到第 n 个版本（从 1 开始，超出范围时循环）。 */
export function selectAlt(el: ScriptElement, n: number): void {
  const versions = altVersions(el);
  if (versions.length < 2) return;
  const target = ((n - 1) % versions.length + versions.length) % versions.length + 1;
  apply(el, versions, target);
}

/** 删掉当前版本，切到相邻的版本；只剩一个版本时不动。 */
export function deleteCurrentAlt(el: ScriptElement): void {
  const versions = altVersions(el);
  if (versions.length < 2) return;
  const current = currentAltNo(el);
  versions.splice(current - 1, 1);
  apply(el, versions, Math.min(current, versions.length));
}
