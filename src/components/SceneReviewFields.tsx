import React, { useEffect, useRef, useState } from 'react';
import type { Scene } from '../model/types';
import { useStore } from '../store/store';

export const SCENE_REVIEW_LABELS = { todo: '待修改', revising: '修改中', done: '已确认' } as const;

/** UI drafts do not enter project history until their explicit edit finishes. */
export function SceneReviewText({ value, label, placeholder, multiline = false, onCommit }: {
  value: string; label: string; placeholder?: string; multiline?: boolean; onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const editing = useRef(false);
  const base = useRef(value);
  const cancelled = useRef(false);
  const composing = useRef(false);
  useEffect(() => { if (!editing.current) setDraft(value); }, [value]);
  const finish = () => {
    if (!editing.current) return;
    editing.current = false;
    if (!cancelled.current && draft !== base.current) {
      if (value === base.current) onCommit(draft);
      else useStore.getState().notify('场景信息已变化，请重新编辑。');
    }
    cancelled.current = false;
    if (draft === base.current || value !== base.current) setDraft(value);
  };
  const common = {
    'aria-label': label,
    'data-native-edit-history': true,
    'data-project-draft-pending': draft !== value ? 'true' : undefined,
    className: multiline ? 'scene-review__summary-input' : 'scene-review__input',
    value: draft,
    placeholder,
    onFocus: () => { editing.current = true; base.current = value; cancelled.current = false; },
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(event.target.value),
    onBlur: finish,
    onCompositionStart: () => { composing.current = true; },
    onCompositionEnd: () => { composing.current = false; },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      event.stopPropagation();
      if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') {
        event.preventDefault(); cancelled.current = true; setDraft(value); event.currentTarget.blur();
      } else if (event.key === 'Enter' && (!multiline || !event.shiftKey)) {
        event.preventDefault(); event.currentTarget.blur();
      }
    },
  };
  return multiline ? <textarea {...common} rows={1} /> : <input {...common} />;
}

export function SceneReviewSummary({ scene }: { scene: Scene }) {
  const values = [scene.location || '地点未填写', scene.storyTime || '故事时间未填写', scene.revisionStatus ? SCENE_REVIEW_LABELS[scene.revisionStatus] : '未标记'];
  return <div className="scene-review__summary" title={values.join(' · ')}>{values.map((value, index) => <span key={index}>{value}</span>)}</div>;
}

export function SceneReviewFields({ scene, expanded = false }: { scene: Scene; expanded?: boolean }) {
  const epoch = useStore(state => state.documentEpoch);
  const commit = (patch: { location?: string; storyTime?: string; revisionStatus?: Scene['revisionStatus'] }) =>
    useStore.getState().commitReviewSceneMeta(scene.elementId, patch, epoch);
  const fields = <div className="scene-review__fields" key={`${epoch}:${scene.elementId}`}>
    <label className="scene-review__field"><span>地点</span><SceneReviewText value={scene.location || ''} label={`第 ${scene.number} 场地点`} placeholder="自由填写" onCommit={location => commit({ location })} /></label>
    <label className="scene-review__field"><span>故事时间</span><SceneReviewText value={scene.storyTime || ''} label={`第 ${scene.number} 场故事时间`} placeholder="如：三天后" onCommit={storyTime => commit({ storyTime })} /></label>
    <label className="scene-review__field"><span>修改状态</span><select className="scene-review__input" aria-label={`第 ${scene.number} 场修改状态`} value={scene.revisionStatus || ''}
      onChange={event => commit({ revisionStatus: event.target.value ? event.target.value as NonNullable<Scene['revisionStatus']> : undefined })}>
      <option value="">未标记</option><option value="todo">待修改</option><option value="revising">修改中</option><option value="done">已确认</option>
    </select></label>
  </div>;
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();
  return <div className="scene-review" onMouseDown={stop} onDoubleClick={stop} onClick={stop} onWheel={stop} onKeyDown={stop} onDragStart={event => { event.preventDefault(); event.stopPropagation(); }}>
    {expanded ? fields : <details className="scene-review__details"><summary className="scene-review__toggle" aria-label={`编辑第 ${scene.number} 场信息`}><SceneReviewSummary scene={scene} /><span aria-hidden>⌄</span></summary>{fields}</details>}
  </div>;
}
