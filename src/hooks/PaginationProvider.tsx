import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ScriptElement, ScriptProject } from '../model/types';
import { useStore } from '../store/store';
import { StaticBlock } from '../components/ScriptBlock';
import { keepWithNext, canSplit } from '../model/flow';
import { PAPER_MM } from '../model/stats';
import { plain, stripSceneNumber } from '../utils/text';
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

const Ctx = createContext<PaginationResult>({ pages: [], pageOf: {}, breaks: [], lineHeightPx: 18, contentWidthPx: 500, contentHeightPx: 700 });

export function usePagination(): PaginationResult {
  return useContext(Ctx);
}

export function PaginationProvider({ children }: { children: React.ReactNode }) {
  const project = useStore((s) => s.project);
  const version = useStore((s) => s.version);
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

  const geo = useMemo(() => {
    const paper = PAPER_MM[project.settings.paper] || PAPER_MM.A4;
    const s = project.settings;
    const w = (paper.w - (s.marginLeft + s.marginRight) * 10) * PX_PER_MM;
    const h = (paper.h - (s.marginTop + s.marginBottom) * 10) * PX_PER_MM;
    const fs = s.fontSize * PT_TO_PX;
    return { contentWidthPx: w, contentHeightPx: h, fontSizePx: fs, lineHeightPx: fs * s.lineHeight };
  }, [project.settings]);

  const items = useMemo(() => buildItems(project), [project.elements, project.settings.indent]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      const { contentHeightPx: rawCH, lineHeightPx: rawLH } = geo;
    // 兜底：防止 margin / 字号 / 行高被设成 0 时除法得到 NaN / Infinity，导致分页死循环或白屏
    const contentHeightPx = Math.max(1, rawCH || 0);
    const lineHeightPx = Math.max(1, rawLH || 0);
      const pages: PageInfo[] = [];
      const pageOf: Record<string, number> = {};
      const breaks: number[] = [];
      let cur: Placed[] = [];
      let curH = 0;
      let curRev: string | null = null;

      const flush = () => {
        pages.push({ index: pages.length, items: cur, revColor: curRev });
        cur = [];
        curH = 0;
        curRev = null;
      };
      const newPage = () => {
        if (cur.length) flush();
      };

      const revRank = (id?: string) => (id ? project.revisions.findIndex((r) => r.id === id) : -1);

      items.forEach((item) => {
        const node = refs.current.get(item.key);
        const height = node ? (node as HTMLElement).offsetHeight : lineHeightPx;
        const mtLines = item.marginTopLines;
        const mt = mtLines * lineHeightPx;
        const splitable = item.kind === 'single' && canSplit(item.elements[0]);
        const el0 = item.elements[0];
        const isDialogue = el0.type === 'dialogue';
        const reserve = isDialogue ? 1 : 0; // 「（更多）」/「（续）」占 1 行

        // 保持与后续内容同页
        if (cur.length && item.keep > 0) {
          const need = mt + Math.min(height, item.keep * lineHeightPx) + item.keep * lineHeightPx;
          if (curH + need > contentHeightPx && height + item.keep * lineHeightPx <= contentHeightPx) newPage();
        }

        const totalLines = Math.max(1, Math.round(height / lineHeightPx));
        let chunkStart = 0;
        let guard = 0;
        while (chunkStart < totalLines && guard < 40) {
          guard += 1;
          const rest = totalLines - chunkStart;
          const mtNow = chunkStart === 0 ? mt : 0;
          const res = chunkStart === 0 ? 0 : reserve;
          const h = rest * lineHeightPx;
          const need = mtNow + h + res * lineHeightPx;
          const first = chunkStart === 0;
          if (cur.length === 0 && need > contentHeightPx && splitable && rest > 2) {
            // 单块超过一整页：强制切分
          }
          if (curH + need <= contentHeightPx) {
            cur.push({
              key: `${item.key}#${chunkStart}`,
              kind: item.kind,
              elements: item.elements,
              lines: rest,
              skipLines: chunkStart,
              more: false,
              contd: chunkStart > 0 && reserve ? contdLabel(item, project) : undefined,
              spaceBefore: mtLines,
            });
            curH += need;
            item.elements.forEach((e) => {
              if (pageOf[e.id] === undefined) pageOf[e.id] = pages.length;
              if (e.rev && revRank(e.rev) > revRank(curRev || undefined)) curRev = e.rev;
            });
            if (first) breaks.push(item.startIndex);
            break;
          }
          // 放不下：尝试拆分
          const avail = contentHeightPx - curH - mtNow - res * lineHeightPx;
          let fit = Math.floor(avail / lineHeightPx);
          const orphan = 2;
          const widow = 2;
          if (splitable && cur.length > 0 && fit >= orphan && rest - fit >= widow) {
            cur.push({
              key: `${item.key}#${chunkStart}`,
              kind: item.kind,
              elements: item.elements,
              lines: fit,
              skipLines: chunkStart,
              more: isDialogue,
              spaceBefore: mtLines,
            });
            curH += mtNow + fit * lineHeightPx + res * lineHeightPx;
            item.elements.forEach((e) => {
              if (pageOf[e.id] === undefined) pageOf[e.id] = pages.length;
              if (e.rev && revRank(e.rev) > revRank(curRev || undefined)) curRev = e.rev;
            });
            if (first) breaks.push(item.startIndex);
            chunkStart += fit;
            newPage();
            continue;
          }
          if (cur.length === 0) {
            // 空页都放不下：强行按可用行数截断，避免死循环
            const maxLines = Math.max(1, Math.floor(contentHeightPx / lineHeightPx));
            const take = Math.min(rest, maxLines);
            cur.push({
              key: `${item.key}#${chunkStart}`,
              kind: item.kind,
              elements: item.elements,
              lines: take,
              skipLines: chunkStart,
              more: isDialogue && rest > take,
              spaceBefore: mtLines,
            });
            curH += take * lineHeightPx;
            if (first) breaks.push(item.startIndex);
            chunkStart += take;
            newPage();
            continue;
          }
          newPage();
        }
      });

      if (cur.length) flush();
      const withTitle =
        project.titlePage.show && project.settings.titlePageBreak
          ? [{ index: -1, items: [], revColor: null } as PageInfo, ...pages.map((p, i) => ({ ...p, index: i }))]
          : pages;
      setResult({
        pages: withTitle,
        pageOf,
        breaks,
        lineHeightPx: geo.lineHeightPx,
        contentWidthPx: geo.contentWidthPx,
        contentHeightPx: geo.contentHeightPx,
      });
      setPageCount(withTitle.length);
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, items, geo, project.revisions, project.titlePage.show, project.settings.titlePageBreak]);

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
                  <StaticBlock key={e.id} el={e} settings={project.settings} half sceneNumber={sceneNumberFor(e)} />
                ))}
            </div>
            <div className="sc-dual-col">
              {item.elements
                .filter((e) => (e.dual || 'left') === 'right')
                .map((e) => (
                  <StaticBlock key={e.id} el={e} settings={project.settings} half sceneNumber={sceneNumberFor(e)} />
                ))}
            </div>
          </div>
        ) : (
          <StaticBlock
            key={item.key}
            el={item.elements[0]}
            settings={project.settings}
            sceneNumber={sceneNumberFor(item.elements[0])}
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

function contdLabel(item: Item, project: ScriptProject): string {
  // 找到该对白所属人物
  const idx = project.elements.findIndex((e) => e.id === item.elements[0].id);
  for (let i = idx; i >= 0; i -= 1) {
    if (project.elements[i].type === 'character') {
      return `${plain(project.elements[i].text).trim()}${project.settings.contdText}`;
    }
    if (project.elements[i].type === 'scene_heading') break;
  }
  return `（续）`;
}
