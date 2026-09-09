import React, { useMemo } from 'react';
import { useStore } from '../store/store';
import { usePagination, type Placed, type PageInfo } from '../hooks/PaginationProvider';
import { StaticBlock } from './ScriptBlock';
import { fontStackOf } from '../model/elements';
import { PAPER_MM } from '../model/stats';
import { deriveScenes } from '../model/project';
import { stripSceneNumber } from '../utils/text';
import type { Beat } from '../model/types';

const PX_PER_MM = 96 / 25.4;

export function PreviewView({ onExportPdf }: { onExportPdf: () => void }) {
  const project = useStore((s) => s.project);
  const zoom = useStore((s) => s.zoom);
  const setZoom = useStore((s) => s.setZoom);
  const { pages, lineHeightPx, contentWidthPx } = usePagination();

  const geo = useMemo(() => {
    const paper = PAPER_MM[project.settings.paper] || PAPER_MM.A4;
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
  /**
   * PDF 导出红线：声音卡与图片卡是创作内容的一部分，不能只因它们位于写作/自由板
   * 浮层就从打印预览剥离。这里为每张素材生成确定的附页，printToPDF 会原样带出。
   */
  const materials = useMemo(
    () => project.beats.filter((beat) => beat.kind === 'sound' || beat.kind === 'image'),
    [project.beats],
  );

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
        spaceBefore={p.skipLines ? 0 : p.spaceBefore}
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

    if (p.lines === undefined) return <React.Fragment key={p.key}>{block}</React.Fragment>;

    const skip = p.skipLines || 0;
    const inner = (
      <div style={{ marginTop: skip ? -skip * lineHeightPx : undefined }}>
        {p.contd ? <div className="sc-contd">{p.contd}</div> : null}
        {block}
      </div>
    );
    return (
      <div key={p.key}>
        <div style={{ height: (p.lines + (p.contd ? 1 : 0) + (p.more ? 1 : 0)) * lineHeightPx, overflow: 'hidden' }}>
          {inner}
          {p.more ? <div className="sc-more">{settings.moreText}</div> : null}
        </div>
      </div>
    );
  };

  return (
    <div className="preview">
      <div className="preview__bar">
        <span className="preview__label">分页预览 · 剧本 {pages.length} 页{materials.length ? ` · 素材附页 ${materials.length} 张` : ''}</span>
        <div className="spacer" />
        <button className="btn btn--ghost" onClick={() => setZoom(zoom - 0.1)}>
          －
        </button>
        <span className="preview__zoom">{Math.round(zoom * 100)}%</span>
        <button className="btn btn--ghost" onClick={() => setZoom(zoom + 0.1)}>
          ＋
        </button>
        <button className="btn btn--primary" onClick={onExportPdf}>
          导出 PDF
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
        {materials.map((beat, index) => (
          <MaterialPage key={beat.id} beat={beat} index={index} geo={geo} />
        ))}
      </div>
    </div>
  );
}

/** PDF 专用素材附页；不要把它改回仅编辑器浮层，否则导出会再次丢失卡片内容。 */
function MaterialPage({ beat, index, geo }: {
  beat: Beat;
  index: number;
  geo: { w: number; h: number; pt: number; pb: number; pl: number; pr: number };
}) {
  const sound = beat.kind === 'sound';
  const title = beat.title || (sound ? '声音设计' : '图片素材');
  return (
    <div
      className="preview__page preview__material-page"
      style={{
        width: geo.w,
        height: Math.max(120, geo.h - 0.3 * PX_PER_MM),
        paddingTop: geo.pt,
        paddingBottom: geo.pb,
        paddingLeft: geo.pl,
        paddingRight: geo.pr,
        background: '#fff',
      }}
    >
      <div className="preview__material-kicker">创作素材附页 · {sound ? '声音卡' : '图片卡'} {index + 1}</div>
      <h1 className="preview__material-title">{title}</h1>
      {sound ? (
        <p className="preview__material-notes">{beat.text || '（未填写声音、环境或节奏提示）'}</p>
      ) : (
        <>
          {beat.img ? <img className="preview__material-image" src={beat.img} alt={title} /> : <p className="preview__material-missing">（图片文件缺失，但卡片标题与备注仍已保留）</p>}
          {beat.text ? <p className="preview__material-notes">{beat.text}</p> : null}
        </>
      )}
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
