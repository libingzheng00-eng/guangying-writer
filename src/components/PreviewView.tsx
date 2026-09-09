import React, { useMemo } from 'react';
import { useStore } from '../store/store';
import { usePagination, type Placed, type PageInfo } from '../hooks/PaginationProvider';
import { StaticBlock } from './ScriptBlock';
import { fontStackOf } from '../model/elements';
import { PAPER_MM } from '../model/stats';
import { deriveScenes } from '../model/project';
import { stripSceneNumber } from '../utils/text';

const PX_PER_MM = 96 / 25.4;

export function PreviewView({ onExportPdf }: { onExportPdf: (mode?: 'creative' | 'print') => void }) {
  const project = useStore((s) => s.project);
  const version = useStore((s) => s.version);
  const zoom = useStore((s) => s.zoom);
  const setZoom = useStore((s) => s.setZoom);
  const { pages, lineHeightPx, contentWidthPx, readyKey } = usePagination();
  const ready = readyKey === `${version}:A4`;

  const geo = useMemo(() => {
    const paper = PAPER_MM.A4;
    const s = project.settings;
    return {
      w: paper.w * PX_PER_MM,
      h: paper.h * PX_PER_MM,
      pt: s.marginTop * 10 * PX_PER_MM,
      pb: s.marginBottom * 10 * PX_PER_MM,
      pl: s.marginLeft * 10 * PX_PER_MM,
      pr: s.marginRight * 10 * PX_PER_MM,
    };
  }, [project.settings]);

  const revMap = useMemo(() => {
    const m: Record<string, string> = {};
    project.revisions.forEach((r) => {
      m[r.id] = r.color;
    });
    return m;
  }, [project.revisions]);

  const sceneNo = useMemo(() => {
    const m: Record<string, string> = {};
    deriveScenes(project).forEach((s) => {
      m[s.elementId] = s.number;
    });
    return m;
  }, [project]);

  const settings = project.settings;
  const showTitle = project.titlePage.show && settings.titlePageBreak;
  // 核心红线：这里仅为 A4 纯文本打印。含卡片的创作版由写作布局导出，
  // 保留图片与正文的原位置关系，禁止把卡片统一搬到文末附页。

  const renderPlaced = (p: Placed) => {
    const el0 = p.elements[0];
    const revColor = settings.revisionMode && el0.rev ? revMap[el0.rev] : undefined;
    if (p.kind === 'dual') {
      return (
        <div className="sc-dual-row" key={p.key}>
          <div className="sc-dual-col">
            {p.elements.filter((e) => (e.dual || 'left') === 'left').map((e) => (
              <StaticBlock key={e.id} el={e} settings={settings} half />
            ))}
          </div>
          <div className="sc-dual-col">
            {p.elements.filter((e) => (e.dual || 'left') === 'right').map((e) => (
              <StaticBlock key={e.id} el={e} settings={settings} half />
            ))}
          </div>
        </div>
      );
    }
    const el = p.elements[0];
    const block = (
      <StaticBlock
        el={el}
        settings={settings}
        spaceBefore={0}
        revColor={revColor}
        sceneNumber={
          el.type === 'scene_heading' && settings.autoNumberScenes
            ? {
                left: settings.sceneNumber === 'left' || settings.sceneNumber === 'both' ? sceneNo[el.id] : undefined,
                right: settings.sceneNumber === 'right' || settings.sceneNumber === 'both' ? sceneNo[el.id] : undefined,
                text: stripSceneNumber(el.text),
              }
            : undefined
        }
      />
    );

    const skip = p.skipLines || 0;
    // 打印红线：段前留白不能进入正文的行数裁剪窗，否则场次标题和末行会被截掉。
    // 续页偏移只移动正文；续说/更多提示各占独立一行，不随正文向上移走。
    return (
      <div key={p.key} className="preview__placed" style={{ paddingTop: skip ? 0 : p.spaceBefore * lineHeightPx }}>
        {p.contd ? <div className="sc-contd" style={{ height: lineHeightPx, lineHeight: `${lineHeightPx}px` }}>{p.contd}</div> : null}
        {p.lines === undefined ? block : (
          <div className="preview__line-window" style={{ height: p.lines * lineHeightPx, overflow: 'hidden' }}>
            <div style={{ transform: skip ? `translateY(${-skip * lineHeightPx}px)` : undefined }}>
              {block}
            </div>
          </div>
        )}
        {p.more ? <div className="sc-more" style={{ height: lineHeightPx, lineHeight: `${lineHeightPx}px` }}>{settings.moreText}</div> : null}
      </div>
    );
  };

  return (
    <div className="preview" data-ready={ready ? 'true' : 'false'} data-pagination-key={readyKey || ''}>
      <div className="preview__bar">
        <span className="preview__label">A4 纯文本打印预览 · 剧本 {pages.length} 页</span>
        <div className="spacer" />
        <button className="btn btn--ghost" onClick={() => setZoom(zoom - 0.1)}>
          －
        </button>
        <span className="preview__zoom">{Math.round(zoom * 100)}%</span>
        <button className="btn btn--ghost" onClick={() => setZoom(zoom + 0.1)}>
          ＋
        </button>
        <button className="btn btn--ghost" onClick={() => onExportPdf('creative')}>
          导出创作版（含卡片）
        </button>
        <button className="btn btn--primary" disabled={!ready} onClick={() => onExportPdf('print')}>
          导出 A4 纯文本
        </button>
      </div>
      <div className="preview__scroll" style={{ ['--zoom' as string]: zoom }}>
        {pages.map((page, i) => (
          <PageCard
            key={i}
            page={page}
            index={i}
            geo={geo}
            showTitle={showTitle && i === 0}
            project={project}
            contentWidthPx={contentWidthPx}
          >
            {showTitle && i === 0 ? null : page.items.map(renderPlaced)}
          </PageCard>
        ))}
      </div>
    </div>
  );
}

function PageCard({
  page,
  index,
  geo,
  showTitle,
  project,
  contentWidthPx,
  children,
}: {
  page: PageInfo;
  index: number;
  geo: { w: number; h: number; pt: number; pb: number; pl: number; pr: number };
  showTitle: boolean;
  project: ReturnType<typeof useStore.getState>['project'];
  contentWidthPx: number;
  children: React.ReactNode;
}) {
  const s = project.settings;
  const num = index + (project.titlePage.show && s.titlePageBreak ? 0 : s.startPageAt);
  const showNum = s.showPageNumbers && !showTitle && num >= s.startPageAt;
  return (
    <div
      className="preview__page"
      style={{
        width: geo.w,
        height: Math.max(120, geo.h - 0.3 * PX_PER_MM),
        paddingTop: geo.pt,
        paddingBottom: geo.pb,
        paddingLeft: geo.pl,
        paddingRight: geo.pr,
        background: page.revColor || '#fff',
      }}
    >
      {showNum ? (
        <div
          className="page__num"
          style={{ top: Math.max(6, geo.pt * 0.42), right: Math.max(8, geo.pr * 0.5), fontSize: `${s.fontSize}pt` }}
        >
          {num + (project.titlePage.show && s.titlePageBreak ? 1 : 0)}
        </div>
      ) : null}
      {showTitle ? (
        <TitlePageBlock project={project} />
      ) : (
        <div
          className="page__body"
          style={{
            width: contentWidthPx,
            fontFamily: fontStackOf(s.fontKey),
            fontSize: `${s.fontSize}pt`,
            lineHeight: s.lineHeight,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function TitlePageBlock({ project }: { project: ReturnType<typeof useStore.getState>['project'] }) {
  const tp = project.titlePage;
  const s = project.settings;
  return (
    <div className="title-page" style={{ fontFamily: fontStackOf(s.fontKey) }}>
      <div className="title-page__main">
        <div className="title-page__title">{tp.title || '未命名剧本'}</div>
        {tp.subtitle ? <div className="title-page__subtitle">{tp.subtitle}</div> : null}
        {tp.basedOn ? <div className="title-page__based">改编自 {tp.basedOn}</div> : null}
        {tp.author ? (
          <div className="title-page__author">
            <div>编剧</div>
            <div className="title-page__author-name">{tp.author}</div>
          </div>
        ) : null}
      </div>
      <div className="title-page__foot">
        <div className="title-page__foot-left">{tp.contact}</div>
        <div className="title-page__foot-right">
          {tp.version ? <div>{tp.version}</div> : null}
          {tp.date ? <div>{tp.date}</div> : null}
        </div>
      </div>
    </div>
  );
}
