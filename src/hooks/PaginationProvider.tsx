import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ScriptElement, ScriptProject } from '../model/types';
import { useStore } from '../store/store';
import { StaticBlock } from '../components/ScriptBlock';
import { keepWithNext, canSplit, contdLabelFor, characterForDialogue, deriveWritingElements, CONTD_SUFFIX } from '../model/flow';
import { PAPER_MM } from '../model/stats';
import { stripSceneNumber } from '../utils/text';
import { fontStackOf } from '../model/elements';
import { deriveScenes } from '../model/project';
import { lockedPageLabels } from '../model/locks';

const PX_PER_MM = 96 / 25.4;
const PT_TO_PX = 96 / 72;

export interface Placed {
  key: string;
  kind: 'single' | 'dual';
  elements: ScriptElement[];
  /** 只渲染前 n 行 */
  lines?: number;
  /** 跳过前 n 行（续页） */
  skipLines?: number;
  more?: boolean;
  contd?: string;
  spaceBefore: number;
}

export interface PageInfo {
  index: number;
  items: Placed[];
  revColor: string | null;
  /** 锁页后的页码（12、12A、12-13）；未锁页时不设，由显示处按顺序编号 */
  label?: string;
}

export interface PaginationResult {
  pages: PageInfo[];
  pageOf: Record<string, number>;
  /** 在新页开始的元素下标 */
  breaks: number[];
  lineHeightPx: number;
  contentWidthPx: number;
  contentHeightPx: number;
  /** 仅在当前版本、纸型的 DOM 测量与分页完成后赋值；导出不能使用旧页数。 */
  readyKey?: string;
}

interface Item {
  key: string;
  kind: 'single' | 'dual';
  elements: ScriptElement[];
  startIndex: number;
  marginTopLines: number;
  keep: number;
}

function buildItems(project: ScriptProject): Item[] {
  const out: Item[] = [];
  const els = project.elements;
  let i = 0;
  while (i < els.length) {
    const el = els[i];
    if (el.type === 'note' || el.omit) {
      i += 1;
      continue;
    }
    if (el.dual && el.dualGroup) {
      const group: ScriptElement[] = [];
      const g = el.dualGroup;
      while (i < els.length && els[i].dualGroup === g) {
        if (!(els[i].type === 'note' || els[i].omit)) group.push(els[i]);
        i += 1;
      }
      if (group.length) {
        out.push({
          key: `d:${g}`,
          kind: 'dual',
          elements: group,
          startIndex: els.indexOf(group[0]),
          marginTopLines: project.settings.indent[group[0].type]?.spaceBefore ?? 1,
          keep: 2,
        });
      }
      continue;
    }
    out.push({
      key: `s:${el.id}`,
      kind: 'single',
      elements: [el],
      startIndex: i,
      marginTopLines: project.settings.indent[el.type]?.spaceBefore ?? 1,
      keep: keepWithNext(el),
    });
    i += 1;
  }
  return out;
}

/** 根据实测正文高度分页。每次循环必须消费正文行或结束当前页，不能以页数上限截掉内容。 */
export function paginateMeasured(
  project: ScriptProject,
  heights: ReadonlyMap<string, number>,
  geometry: Pick<PaginationResult, 'contentHeightPx' | 'contentWidthPx' | 'lineHeightPx'>,
): PaginationResult {
  const finitePositive = (value: number, fallback: number) => Number.isFinite(value) && value > 0 ? value : fallback;
  const lineHeightPx = finitePositive(geometry.lineHeightPx, 18);
  // 极端页边距至少留下一个正文行；否则任何格式都无法容纳正文。
  const contentHeightPx = Math.max(lineHeightPx, finitePositive(geometry.contentHeightPx, lineHeightPx));
  const pages: PageInfo[] = [];
  const pageOf: Record<string, number> = {};
  const breaks: number[] = [];
  let cur: Placed[] = [];
  let curH = 0;
  let curRev: string | null = null;
  let prevPageLastCharacter: string | null = null;
  // 锁页：锁定时每页起头的段落在这里强制换页；记下每页由哪个锁定页起头，最后算页码。
  const lock = project.pageLock;
  const anchorIndex = new Map<string, number>();
  lock?.pages.forEach((entry, index) => { if (entry.id && !anchorIndex.has(entry.id)) anchorIndex.set(entry.id, index); });
  const pageAnchors: number[] = [];
  let curAnchor = -1;
  const revRank = (id?: string) => id ? project.revisions.findIndex((r) => r.id === id) : -1;
  const flush = () => {
    if (!cur.length) return;
    prevPageLastCharacter = null;
    for (let i = cur.length - 1; i >= 0 && !prevPageLastCharacter; i -= 1) {
      const dialogue = [...cur[i].elements].reverse().find((e) => e.type === 'dialogue');
      if (dialogue) prevPageLastCharacter = characterForDialogue(project, dialogue.id);
    }
    pages.push({ index: pages.length, items: cur, revColor: curRev });
    pageAnchors.push(curAnchor);
    cur = [];
    curH = 0;
    curRev = null;
    curAnchor = -1;
  };

  const measuredItems = buildItems(project);
  const linesFor = (item: Item) => Math.max(1, Math.round(finitePositive(heights.get(item.key) || 0, lineHeightPx) / lineHeightPx));
  const marginFor = (item: Item) => Number.isFinite(item.marginTopLines) ? Math.max(0, item.marginTopLines) : 0;
  for (let itemIndex = 0; itemIndex < measuredItems.length; itemIndex += 1) {
    const item = measuredItems[itemIndex];
    const measured = finitePositive(heights.get(item.key) || 0, lineHeightPx);
    // offsetHeight 是整数，而行高常为小数；round 避免测量四舍五入造成虚构末行。
    const totalLines = Math.max(1, Math.round(measured / lineHeightPx));
    const mtLines = Number.isFinite(item.marginTopLines) ? Math.max(0, item.marginTopLines) : 0;
    const isDialogue = item.kind === 'single' && item.elements[0].type === 'dialogue';
    // 双列也使用统一裁剪窗；允许按行续页，避免长双列把场次标题独留上一页。
    const splitable = item.kind === 'dual' || canSplit(item.elements[0]);
    const anchor = anchorIndex.get(item.elements[0].id);
    if (anchor !== undefined) {
      if (cur.length) flush();
      curAnchor = anchor;
    }
    if (cur.length && item.keep > 0) {
      let keepLines = mtLines + totalLines;
      let remaining = item.keep;
      for (let nextIndex = itemIndex + 1; nextIndex < measuredItems.length && remaining > 0; nextIndex += 1) {
        const next = measuredItems[nextIndex];
        // 锁定页的起头段落一定另起一页，跟随单元不能跨过它，否则前一段会被单独挤到新页。
        if (anchorIndex.has(next.elements[0].id)) break;
        const taken = Math.min(remaining, linesFor(next));
        keepLines += marginFor(next) + taken;
        if (taken < linesFor(next) && next.kind === 'single' && next.elements[0].type === 'dialogue' && project.settings.moreText) keepLines += 1;
        remaining -= taken;
        // 人物/括号自身也有跟随约束，避免场次带上人物后，人物又单独移到下一页。
        if (taken === linesFor(next)) remaining = Math.max(remaining, next.keep);
        // 核心分页契约：完整的动作/对白已结束一个跟随单元。
        // 一行短对白也足以跟住人物，不能为凑满“两行”继续吞下一人物，
        // 否则交替的短对白会被串成整页不可分组，造成大片空白和过早翻页。
        if (taken === linesFor(next) && next.keep === 0) break;
      }
      const keepHeight = keepLines * lineHeightPx;
      if (curH + keepHeight > contentHeightPx && keepHeight <= contentHeightPx) flush();
    }
    let start = 0;
    while (start < totalLines) {
      const rest = totalLines - start;
      let margin = start ? 0 : mtLines;
      let contd = start && isDialogue && project.settings.showContd
        ? contdLabelFor(item, project, prevPageLastCharacter) : undefined;
      const availableLines = Math.max(0, Math.floor((contentHeightPx - curH) / lineHeightPx + 1e-7));
      const continuationLines = contd ? 1 : 0;
      let take = rest;
      let more = false;
      if (margin + continuationLines + rest > availableLines) {
        // 中途断开的对白需要预留 MORE；下一页的 CONT'D 独立预算。
        more = isDialogue && !!project.settings.moreText;
        let fit = Math.floor(availableLines - margin - continuationLines - (more ? 1 : 0));
        if (cur.length && (!splitable || fit < 2 || rest - fit < 2)) {
          flush();
          continue;
        }
        if (!cur.length && fit < 1) {
          // 极端小版心先让出空白及提示行，始终保留正文，不循环制造空页。
          margin = Math.min(margin, Math.max(0, availableLines - 1));
          if (availableLines - margin - (contd ? 1 : 0) - (more ? 1 : 0) < 1) more = false;
          if (availableLines - margin - (contd ? 1 : 0) < 1) contd = undefined;
          fit = Math.max(1, Math.floor(availableLines - margin - (contd ? 1 : 0) - (more ? 1 : 0)));
        }
        take = Math.min(rest, Math.max(1, fit));
        more = more && take < rest;
      }
      const placed: Placed = {
        key: `${item.key}#${start}`,
        kind: item.kind,
        elements: item.elements,
        lines: take,
        skipLines: start,
        more,
        contd,
        spaceBefore: margin,
      };
      cur.push(placed);
      curH += (margin + take + (contd ? 1 : 0) + (more ? 1 : 0)) * lineHeightPx;
      // 普通、拆分、强制分页都走同一路径，场景跳页与修订色不再漏记。
      item.elements.forEach((e) => {
        if (pageOf[e.id] === undefined) pageOf[e.id] = pages.length;
        if (e.rev && revRank(e.rev) > revRank(curRev || undefined)) curRev = e.rev;
      });
      if (start === 0) breaks.push(item.startIndex);
      start += take;
      if (start < totalLines) flush();
    }
  }
  flush();
  if (lock?.pages.length) {
    const present = new Set(pageAnchors.filter((anchor) => anchor >= 0));
    lockedPageLabels(lock, pageAnchors, present).forEach((label, index) => { pages[index].label = label; });
  }
  const withTitle = project.titlePage.show && project.settings.titlePageBreak
    ? [{ index: -1, items: [], revColor: null } as PageInfo, ...pages]
    : pages;
  return { pages: withTitle, pageOf, breaks, lineHeightPx, contentWidthPx: geometry.contentWidthPx, contentHeightPx };
}

const Ctx = createContext<PaginationResult>({ pages: [], pageOf: {}, breaks: [], lineHeightPx: 18, contentWidthPx: 500, contentHeightPx: 700 });

export function usePagination(): PaginationResult {
  return useContext(Ctx);
}

export function PaginationProvider({ children }: { children: React.ReactNode }) {
  const project = useStore((s) => s.project);
  const version = useStore((s) => s.version);
  const view = useStore((s) => s.view);
  const setPageCount = useStore((s) => s.setPageCount);
  // 显示译文会让每段变高，分页要跟着重算（预览里即对照版 PDF）。
  const shownTranslation = useStore((s) => s.shownTranslation);
  const refs = useRef(new Map<string, HTMLElement>());
  // 每个测量块一个固定的 ref 回调：块不重画时不会反复解绑、重绑。
  const refCallbacks = useRef(new Map<string, (node: HTMLElement | null) => void>());
  const measureRef = (key: string) => {
    let callback = refCallbacks.current.get(key);
    if (!callback) {
      callback = (node) => {
        if (node) refs.current.set(key, node);
        else refs.current.delete(key);
      };
      refCallbacks.current.set(key, callback);
    }
    return callback;
  };
  const [result, setResult] = useState<PaginationResult>({
    pages: [],
    pageOf: {},
    breaks: [],
    lineHeightPx: 18,
    contentWidthPx: 500,
    contentHeightPx: 700,
  });

  const paperName = view === 'preview' ? 'A4' : project.settings.paper;
  const requestedKey = `${version}:${paperName}`;
  const geo = useMemo(() => {
    const paper = PAPER_MM[paperName] || PAPER_MM.A4;
    const s = project.settings;
    const w = (paper.w - (s.marginLeft + s.marginRight) * 10) * PX_PER_MM;
    const h = (paper.h - (s.marginTop + s.marginBottom) * 10) * PX_PER_MM;
    const fs = s.fontSize * PT_TO_PX;
    return { contentWidthPx: w, contentHeightPx: h, fontSizePx: fs, lineHeightPx: fs * s.lineHeight };
  }, [project.settings, paperName]);

  /*
   * 隐藏的测量稿只在停笔 180ms 后才换成最新正文：打字时它完全不重画，
   * 每次按键不再为几千段测量块做一遍渲染。停笔后先画出测量稿，再在提交后量高度、分页。
   * 测量用的工程、几何参数和 readyKey 来自同一次请求，与原来「定时器里读当前测量稿」一致。
   */
  const [request, setRequest] = useState<{ project: ScriptProject; geo: typeof geo; key: string } | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      setRequest({ project, geo, key: requestedKey });
    }, 180);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, requestedKey, geo, project.revisions, project.titlePage.show, project.settings.titlePageBreak, project.pageLock, shownTranslation]);

  useEffect(() => {
    if (!request) return;
    let cancelled = false;
    (async () => {
      // 字体加载会改变折行，必须等字体就绪后测量，才能向 PDF 导出声明 ready。
      if (document.fonts) await document.fonts.ready;
      if (cancelled) return;
      const heights = new Map<string, number>();
      refs.current.forEach((node, key) => heights.set(key, node.offsetHeight));
      const measured = paginateMeasured(request.project, heights, request.geo);
      setResult({ ...measured, readyKey: request.key });
      setPageCount(measured.pages.length);
    })();
    return () => {
      cancelled = true;
    };
  }, [request, setPageCount]);

  const measureNode = useMemo(() => {
    if (!request) return null;
    const source = request.project;
    const settings = source.settings;
    const items = buildItems(source);
    const writingDerivation = deriveWritingElements(source.elements);
    const sceneNo: Record<string, string> = {};
    deriveScenes(source).forEach((scene) => {
      sceneNo[scene.elementId] = scene.number;
    });
    const contdSuffixFor = (element: ScriptElement) => settings.contdCharacter !== false &&
      writingDerivation.contdCharacters.has(element) ? CONTD_SUFFIX : undefined;
    const sceneNumberFor = (el: ScriptElement) =>
      el.type === 'scene_heading' && settings.autoNumberScenes
        ? {
            left: settings.sceneNumber === 'left' || settings.sceneNumber === 'both' ? sceneNo[el.id] : undefined,
            right: settings.sceneNumber === 'right' || settings.sceneNumber === 'both' ? sceneNo[el.id] : undefined,
            text: stripSceneNumber(el.text),
          }
        : undefined;
    // 删掉的段落不再保留 ref 回调；只在明显积累时清理。
    const callbacks = refCallbacks.current;
    if (callbacks.size > items.length + 64) {
      const live = new Set(items.map((item) => item.key));
      for (const key of callbacks.keys()) if (!live.has(key)) callbacks.delete(key);
    }
    return (
      <div
        className="sc-measure"
        aria-hidden
        style={{
          width: `${request.geo.contentWidthPx}px`,
          fontFamily: fontStackOf(settings.fontKey),
          fontSize: `${settings.fontSize}pt`,
          lineHeight: settings.lineHeight,
        }}
      >
        {items.map((item) =>
          item.kind === 'dual' ? (
            <div key={item.key} className="sc-dual-row" ref={measureRef(item.key)}>
              <div className="sc-dual-col">
                {item.elements
                  .filter((e) => (e.dual || 'left') === 'left')
                  .map((e) => (
                    <StaticBlock key={e.id} el={e} settings={settings} half sceneNumber={sceneNumberFor(e)} contdSuffix={contdSuffixFor(e)} />
                  ))}
              </div>
              <div className="sc-dual-col">
                {item.elements
                  .filter((e) => (e.dual || 'left') === 'right')
                  .map((e) => (
                    <StaticBlock key={e.id} el={e} settings={settings} half sceneNumber={sceneNumberFor(e)} contdSuffix={contdSuffixFor(e)} />
                  ))}
              </div>
            </div>
          ) : (
            <StaticBlock
              key={item.key}
              el={item.elements[0]}
              settings={settings}
              sceneNumber={sceneNumberFor(item.elements[0])}
              contdSuffix={contdSuffixFor(item.elements[0])}
              innerRef={measureRef(item.key)}
            />
          ),
        )}
      </div>
    );
    // measureRef 只读写 ref，不需要作为依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  return (
    <Ctx.Provider value={result}>
      {measureNode}
      {children}
    </Ctx.Provider>
  );
}
