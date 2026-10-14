import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store/store';
import { sizeLimitFor } from '../../model/board';
import type { Beat, Scene } from '../../model/types';
import { safeDisplayColor, safeEmbeddedImageSource } from '../../utils/displayValues';
import { SCENE_REVIEW_LABELS } from '../SceneReviewFields';
import { RichNoteField } from '../RichNoteField';
import { stopMouse, stopWheel, type Layout } from './boardShared';

/** 自由板上的场景卡与素材卡（灵感 / 声音 / 图片），以及它们的连线圆点和缩放把手。 */
export interface CardProps {
  layout: Layout; selected: boolean; linking: boolean; snapping: boolean;
  onSelect: () => void; onResizeStart: (event: React.MouseEvent, id: string) => void; onLinkStart: (event: React.MouseEvent, id: string) => void;
}
function LinkHandle({ id, onStart }: { id: string; onStart: CardProps['onLinkStart'] }) {
  return <button className="bcard__connector" aria-label="拖到另一张卡片建立连线" title="拖到另一张卡片建立连线"
    onMouseDown={(event) => onStart(event, id)} onClick={(event) => { event.preventDefault(); event.stopPropagation(); }} onDoubleClick={stopMouse}><span aria-hidden="true" /></button>;
}
const cardClass = (props: CardProps) => `bcard${props.selected ? ' is-selected' : ''}${props.linking ? ' is-linking' : ''}${props.snapping ? ' is-snapping' : ''}`;
function ResizeHandle({ layout, onStart }: { layout: Layout; onStart: CardProps['onResizeStart'] }) {
  const limits = sizeLimitFor(layout.kind);
  return <button className="bcard__resize" aria-label={layout.kind === 'scene' ? '调整场景卡大小' : '调整卡片大小'} title={`拖动缩放（${limits.minW}–${limits.maxW}px）`}
    onMouseDown={(event) => onStart(event, layout.id)} onClick={(event) => { event.preventDefault(); event.stopPropagation(); }} onDoubleClick={stopMouse}><span /></button>;
}
export function SceneCard(props: CardProps & { scene: Scene; onOpen: () => void }) {
  const { scene, layout, onSelect } = props;
  return <div className={`${cardClass(props)} bcard--scene`} data-card="scene" data-drag="scene" data-id={scene.elementId} data-kind="scene"
    style={{ left: layout.x, top: layout.y, width: layout.w, height: layout.h, '--scene-color': safeDisplayColor(scene.color) } as React.CSSProperties} onDoubleClick={(event) => { event.stopPropagation(); props.onOpen(); }}>
    <div className="bcard__head"><span className="bcard__no">{scene.number}</span><span className="bcard__title" title={scene.title || scene.heading}>{scene.title || scene.heading || '场景标题'}</span>
      {scene.revisionStatus && <span className={`bcard__status is-${scene.revisionStatus}`}>{SCENE_REVIEW_LABELS[scene.revisionStatus]}</span>}</div>
    <RichNoteField className="bcard__scene-notes" label={`第 ${scene.number} 场简介`} placeholder="这一场发生了什么？" value={scene.synopsis} onFocus={onSelect} stopPointer
      onChange={(synopsis) => useStore.getState().updateSceneMeta(scene.elementId, { synopsis })} />
    <LinkHandle id={layout.id} onStart={props.onLinkStart} />
    <ResizeHandle layout={layout} onStart={props.onResizeStart} />
  </div>;
}
export function BeatCard(props: CardProps & { beat: Beat }) {
  const { beat, layout, onSelect } = props;
  const image = beat.kind === 'image';
  const sound = beat.kind === 'sound';
  const imageSource = safeEmbeddedImageSource(beat.img);
  const update = (patch: Partial<Beat>) => useStore.getState().updateBeat(beat.id, patch);
  return <div className={`${cardClass(props)} bcard--beat${image ? ' bcard--image' : sound ? ' bcard--sound' : ''}`} data-card="beat" data-id={beat.id} data-kind={beat.kind || 'beat'}
    style={{ left: layout.x, top: layout.y, width: layout.w, height: layout.h, '--card-color': safeDisplayColor(beat.color) } as React.CSSProperties}>
    {!image && <div className="bcard__head"><CardTitle value={beat.title || ''} label={sound ? '声音标题' : '灵感标题'} placeholder={sound ? '声音标题' : '添加标题'} onSelect={onSelect} onCommit={(title) => useStore.getState().commitBoardCardTitle(beat.id, title)} /></div>}
    {image && <><div className="bcard__media">{imageSource ? <img className="bcard__media-img" src={imageSource} alt={beat.title || '参考图片'} draggable={false} /> : <div className="bcard__empty-media">{beat.img ? '图片来源已阻止，请重新导入本地图片' : '暂无图片'}</div>}</div>
      <input className="bcard__caption" aria-label="图片标题" placeholder="图片标题（可选）" value={beat.title || ''} onFocus={onSelect} onChange={(event) => update({ title: event.target.value })} onMouseDown={stopMouse} onDoubleClick={stopMouse} onWheel={stopWheel} /></>}
    <RichNoteField className={`bcard__edit${image ? ' bcard__image-notes' : ''}`} label={image ? '图片备注' : sound ? '声音说明' : '灵感内容'}
      placeholder={image ? '图片备注、画面灵感…' : sound ? '声音、音乐或氛围说明…' : '写下灵感、人物动机或事件关系…'} value={beat.text} onFocus={onSelect} stopPointer
      onChange={(text) => update({ text })} />
    <LinkHandle id={layout.id} onStart={props.onLinkStart} />
    <ResizeHandle layout={layout} onStart={props.onResizeStart} />
  </div>;
}

// 单击标题仍可选中/拖动卡片；双击才编辑，防止标题输入框吞掉 Shift 多选和 L 连线。
function CardTitle({ value, label, placeholder, onSelect, onCommit }: { value: string; label: string; placeholder: string; onSelect: () => void; onCommit: (value: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  const finishing = useRef(false);
  const draftRef = useRef(draft); draftRef.current = draft;
  useEffect(() => { if (editing) { input.current?.focus(); input.current?.select(); } }, [editing]);
  const begin = () => { finishing.current = false; setDraft(value); setEditing(true); onSelect(); };
  const finish = (commit: boolean) => {
    if (finishing.current) return; finishing.current = true;
    if (commit && draftRef.current !== value) onCommit(draftRef.current);
    setEditing(false);
  };
  return editing ? <input ref={input} data-native-edit-history data-project-draft-pending={draft !== value ? 'true' : undefined} className="bcard__media-title" aria-label={label} value={draft} placeholder={placeholder}
    onChange={(event) => setDraft(event.target.value)} onBlur={() => finish(true)} onMouseDown={stopMouse} onDoubleClick={stopMouse} onWheel={stopWheel}
    onKeyDown={(event) => { event.stopPropagation(); if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); finish(event.key === 'Enter'); } }} />
    : <span className="bcard__media-title" tabIndex={0} role="button" aria-label={`编辑${label}`} title="双击编辑标题" onDoubleClick={(event) => { event.stopPropagation(); begin(); }}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === 'F2') { event.preventDefault(); event.stopPropagation(); begin(); } }}>{value || placeholder}</span>;
}

