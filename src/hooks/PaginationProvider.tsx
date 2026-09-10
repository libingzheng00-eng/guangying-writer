import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ScriptElement, ScriptProject } from '../model/types';
import { useStore } from '../store/store';
import { StaticBlock } from '../components/ScriptBlock';
import { keepWithNext, canSplit, contdLabelFor, characterForDialogue, shouldShowContdSuffix, CONTD_SUFFIX } from '../model/flow';
import { PAPER_MM } from '../model/stats';
import { stripSceneNumber } from '../utils/text';
import { fontStackOf } from '../model/elements';
import { deriveScenes } from '../model/project';

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
  const revRank = (id?: string) => id ? project.revisions.findIndex((r) => r.id === id) : -1;
  const flush = () => {
    if (!cur.length) return;
    prevPageLastCharacter = null;
    for (let i = cur.length - 1; i >= 0 && !prevPageLastCharacter; i -= 1) {
      const dialogue = [...cur[i].elements].reverse().find((e) => e.type === 'dialogue');
      if (dialogue) prevPageLastCharacter = characterForDialogue(project, dialogue.id);
    }
    pages.push({ index: pages.length, items: cur, revColor: curRev });
    cur = [];
    curH = 0;
    curRev = null;
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
    if (cur.length && item.keep > 0) {
      let keepLines = mtLines + totalLines;
      let remaining = item.keep;
      for (let nextIndex = itemIndex + 1; nextIndex < measuredItems.length && remaining > 0; nextIndex += 1) {
        const next = measuredItems[nextIndex];
        const taken = Math.min(remaining, linesFor(next));
        keepLines += marginFor(next) + taken;
        if (taken < linesFor(next) && next.kind === 'single' && next.elements[0].type === 'dialogue' && project.settings.moreText) keepLines += 1;
        remaining -= taken;
        // 人物/括号自身也有跟随约束，避免场次带上人物后，人物又单独移到下一页。
        if (taken === linesFor(next)) remaining = Math.max(remaining, next.keep);
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
  const refs = useRef(new Map<string, HTMLElement>());
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

  const items = useMemo(() => buildItems(project), [project.elements, project.settings.indent]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      // 字体加载会改变折行，必须等字体就绪后测量，才能向 PDF 导出声明 ready。
      if (document.fonts) await document.fonts.ready;
      if (cancelled) return;
      const heights = new Map<string, number>();
      refs.current.forEach((node, key) => heights.set(key, node.offsetHeight));
      const measured = paginateMeasured(project, heights, geo);
      setResult({ ...measured, readyKey: requestedKey });
      setPageCount(measured.pages.length);
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, requestedKey, items, geo, project.revisions, project.titlePage.show, project.settings.titlePageBreak]);

  const sceneNo = useMemo(() => {
    const m: Record<string, string> = {};
    deriveScenes(project).forEach((s) => {
      m[s.elementId] = s.number;
    });
    return m;
  }, [project]);

  const sceneNumberFor = (el: ScriptElement) =>
    el.type === 'scene_heading' && project.settings.autoNumberScenes
      ? {
          left: project.settings.sceneNumber === 'left' || project.settings.sceneNumber === 'both' ? sceneNo[el.id] : undefined,
          right: project.settings.sceneNumber === 'right' || project.settings.sceneNumber === 'both' ? sceneNo[el.id] : undefined,
          text: stripSceneNumber(el.text),
        }
      : undefined;

  const measureNode = (
    <div
      className="sc-measure"
      aria-hidden
      style={{
        width: `${geo.contentWidthPx}px`,
        fontFamily: fontStackOf(project.settings.fontKey),
        fontSize: `${project.settings.fontSize}pt`,
        lineHeight: project.settings.lineHeight,
      }}
    >
      {items.map((item) =>
        item.kind === 'dual' ? (
          <div
            key={item.key}
            className="sc-dual-row"
            ref={(n) => {
              if (n) refs.current.set(item.key, n);
              else refs.current.delete(item.key);
            }}
          >
            <div className="sc-dual-col">
              {item.elements
                .filter((e) => (e.dual || 'left') === 'left')
                .map((e) => (
                  <StaticBlock key={e.id} el={e} settings={project.settings} half sceneNumber={sceneNumberFor(e)} contdSuffix={shouldShowContdSuffix(project, e) ? CONTD_SUFFIX : undefined} />
                ))}
            </div>
            <div className="sc-dual-col">
              {item.elements
                .filter((e) => (e.dual || 'left') === 'right')
                .map((e) => (
                  <StaticBlock key={e.id} el={e} settings={project.settings} half sceneNumber={sceneNumberFor(e)} contdSuffix={shouldShowContdSuffix(project, e) ? CONTD_SUFFIX : undefined} />
                ))}
            </div>
          </div>
        ) : (
          <StaticBlock
            key={item.key}
            el={item.elements[0]}
            settings={project.settings}
            sceneNumber={sceneNumberFor(item.elements[0])}
            contdSuffix={shouldShowContdSuffix(project, item.elements[0]) ? CONTD_SUFFIX : undefined}
            innerRef={(n) => {
              if (n) refs.current.set(item.key, n);
              else refs.current.delete(item.key);
            }}
          />
        ),
      )}
    </div>
  );

  return (
    <Ctx.Provider value={result}>
      {measureNode}
      {children}
    </Ctx.Provider>
  );
}
