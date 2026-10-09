import React, { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { containModal, createModalSession, type ModalSession } from '../app/modalFocus';
import type { ReviewContext } from '../app/reviewContext';
import { ownsNativeHistory } from '../utils/editHistory';
import { searchText } from '../model/search';
import { ELEMENT_META } from '../model/elements';
import type { ScriptProject, ScriptElement, SceneMeta } from '../model/types';
import { captureSceneAnchor, captureTextAnchor, MAX_ANNOTATIONS, MAX_ANNOTATIONS_BYTES, type Annotation, type AnnotationStatus } from '../model/annotations';
import { compareWritingSnapshots, revisionWorkspaceUsage, REVISION_WORKSPACE_LIMITS } from '../model/revisionWorkspace';
import { buildDeliveryChecks } from '../model/deliveryChecks';
import '../styles/revisionWorkspace.css';

type Tab = 'versions' | 'annotations' | 'stash' | 'checks';
type Confirm = { message: string; label: string; action: () => boolean; documentIndependent?: boolean };
type Common = {
  project: ScriptProject;
  context: ReviewContext;
  run: (action: () => boolean) => boolean;
  confirm: (value: Confirm) => void;
  locate: (id: string, caret?: number) => void;
  leaveDraft: (action: () => void, scope?: HTMLElement | null) => void;
};
const date = (value: number) => new Date(value).toLocaleString('zh-CN', { hour12: false });
const matches = (query: string, ...values: (string | undefined)[]) => !query.trim() || values.some(value => value?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
const draftProps = (pending: boolean) => ({ 'data-native-edit-history': '', 'data-project-draft-pending': pending ? 'true' : undefined });
const paragraphsText = (elements: ScriptElement[]) => elements.map(element => searchText(element.text)).join('\n');
const statusLabels: Record<AnnotationStatus, string> = { pending: '待处理', resolved: '已处理', declined: '不采用' };
const sceneStatuses = { todo: '待修改', revising: '修改中', done: '已确认' };

function SceneInformation({ scenes, label }: { scenes: SceneMeta[]; label: string }) {
  return <>{scenes.map(scene => <p key={scene.id} className="revision-workspace__muted" style={{ whiteSpace: 'pre-wrap' }}>
    {label}：{[scene.title && `标题 ${scene.title}`, scene.synopsis && `梗概 ${scene.synopsis}`, scene.location && `地点 ${scene.location}`, scene.storyTime && `故事时间 ${scene.storyTime}`, scene.revisionStatus && `修改状态 ${sceneStatuses[scene.revisionStatus]}`].filter(Boolean).join(' · ') || '未填写'}
  </p>)}</>;
}

function sceneAt(project: ScriptProject, activeId: string | null) {
  const index = project.elements.findIndex(element => element.id === activeId);
  for (let i = index; i >= 0; i--) if (project.elements[i].type === 'scene_heading') return project.elements[i];
  return undefined;
}

function insertionTarget(project: ScriptProject, context: ReviewContext) {
  const element = project.elements.find(item => item.id === context.activeId);
  return {
    allowed: !!element || project.elements.length === 0,
    label: element ? `插入到「${searchText(element.text).slice(0, 38) || '空段'}」后` : project.elements.length ? '请关闭工作台，在正文选择插入位置后重新打开。' : '插入到空正文',
  };
}

function VersionsPanel({ project, context, run, confirm, leaveDraft }: Common) {
  const versions = project.revisionWorkspace?.versions || [];
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState(versions[0]?.id || '');
  const [rename, setRename] = useState<string | null>(null);
  const renameRoot = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const version = versions.find(item => item.id === chosen);
  const diffs = useMemo(() => version ? compareWritingSnapshots(version.content, project) : [], [version, project.elements, project.sceneMeta]);
  const changed = diffs.filter(item => item.added || item.deleted || item.modified || item.moved);
  const target = insertionTarget(project, context);
  const choose = (id: string) => {
    if (id === chosen) return;
    const change = () => { setChosen(id); setRename(null); setSelected([]); };
    if (rename !== null && rename !== version?.name) leaveDraft(change, renameRoot.current);
    else change();
  };
  return <section className="revision-workspace__panel" aria-label="版本管理">
    <p className="revision-workspace__muted">保存正文与场景信息的命名版本。比较方向：所选旧版本 → 当前正文。</p>
    <div className="revision-workspace__row">
      <input aria-label="新版本名称" {...draftProps(!!name)} maxLength={REVISION_WORKSPACE_LIMITS.name} value={name} placeholder="例如：第二稿·开场调整前" onChange={event => setName(event.target.value)} />
      <button className="btn btn--primary" disabled={!name.trim()} onClick={() => {
        if (run(() => useStore.getState().createNamedVersion(name, context.documentEpoch))) {
          setName(''); const next = useStore.getState().project.revisionWorkspace?.versions;
          if (next?.length) choose(next[next.length - 1].id);
        }
      }}>保存当前版本</button>
    </div>
    <div className="revision-workspace__split">
      <div className="revision-workspace__list">
        <input aria-label="搜索版本" data-native-edit-history value={query} placeholder="搜索名称或旧正文" onChange={event => setQuery(event.target.value)} />
        {versions.filter(item => matches(query, item.name, item.description, paragraphsText(item.content.elements))).map(item => <button key={item.id} className="revision-workspace__entry" aria-pressed={chosen === item.id} onClick={() => choose(item.id)}>
          <strong>{item.name}</strong><small>{date(item.createdAt)} · {item.content.elements.length} 段</small>
        </button>)}
        {!versions.length && <p className="revision-workspace__empty">还没有命名版本。改稿前可先保存一份。</p>}
      </div>
      <div className="revision-workspace__detail">
        {version ? <>
          <div className="revision-workspace__row"><h4>{version.name}</h4>
            <button className="btn" disabled={rename !== null} onClick={() => setRename(version.name)}>重命名</button>
            <button className="btn" onClick={() => confirm({ message: `删除版本「${version.name}」？正文不变，删除可撤销。`, label: '确认删除版本', action: () => useStore.getState().deleteNamedVersion(version.id, context.documentEpoch) })}>删除版本</button>
          </div>
          {rename !== null && <div ref={renameRoot} className="revision-workspace__row">
            <input aria-label="版本新名称" {...draftProps(rename !== version.name)} value={rename} maxLength={REVISION_WORKSPACE_LIMITS.name} onChange={event => setRename(event.target.value)} />
            <button className="btn" disabled={!rename.trim()} onClick={() => { if (run(() => useStore.getState().renameNamedVersion(version.id, rename, context.documentEpoch))) setRename(null); }}>确认改名</button>
            <button className="btn" onClick={() => setRename(null)}>取消改名</button>
          </div>}
          <p className="revision-workspace__muted">新增 {diffs.filter(item => item.added).length} · 删除 {diffs.filter(item => item.deleted).length} · 修改 {diffs.filter(item => item.modified).length} · 可能移动 {diffs.filter(item => item.moved).length}</p>
          {!changed.length && <p className="revision-workspace__empty">正文与场景信息没有差异。</p>}
          {diffs.map(item => <details className="revision-workspace__card" key={item.id} open={changed.includes(item) || undefined}>
            <summary tabIndex={0}>{item.label}<span className="revision-workspace__tags">
              {item.added && <span className="revision-workspace__tag">新增</span>}{item.deleted && <span className="revision-workspace__tag">删除</span>}
              {item.modified && <span className="revision-workspace__tag">修改</span>}{item.moved && <span className="revision-workspace__tag">可能移动</span>}
              {!changed.includes(item) && <span className="revision-workspace__tag">未改</span>}
            </span></summary>
            {item.before ? <><SceneInformation scenes={item.before.sceneMeta} label="旧版场景信息" /><div className="revision-workspace__row"><p className="revision-workspace__muted">旧版段落（勾选取回）</p>
              <button className="btn" onClick={() => setSelected(ids => Array.from(new Set([...ids, ...item.before!.elements.map(element => element.id)])))}>{item.headingId ? '勾选此场旧段' : '勾选场前旧段'}</button>
            </div>
              {item.before.elements.map(element => <label className="revision-workspace__paragraph" key={element.id}>
                <input type="checkbox" aria-label={`取回旧段：${searchText(element.text).slice(0, 30) || '空段'}`} checked={selected.includes(element.id)} onChange={event => setSelected(ids => event.target.checked ? [...ids, element.id] : ids.filter(id => id !== element.id))} />
                <span><small className="revision-workspace__muted">{ELEMENT_META[element.type].label}　</small>{searchText(element.text) || '（空段）'}</span>
              </label>)}
            </> : <p className="revision-workspace__muted">旧版无此场次。</p>}
            {item.after && <><SceneInformation scenes={item.after.sceneMeta} label="当前场景信息" /><p className="revision-workspace__muted">当前正文</p><pre className="revision-workspace__text">{paragraphsText(item.after.elements)}</pre></>}
          </details>)}
          <p className="revision-workspace__muted">{target.label}。取回会插入新副本，保留当前正文。</p>
          <button className="btn btn--primary" disabled={!selected.length || !target.allowed} onClick={() => {
            if (run(() => useStore.getState().restoreWorkspaceContent({ kind: 'version', id: version.id, elementIds: selected }, context.activeId, context.documentEpoch))) setSelected([]);
          }}>取回所选 {selected.length} 段</button>
        </> : <p className="revision-workspace__empty">选择版本，查看场次差异并取回旧段落。</p>}
      </div>
    </div>
  </section>;
}

type AnchorChoice = 'selection' | 'paragraph' | 'scene';
function useAnchors(project: ScriptProject, context: ReviewContext) {
  const active = project.elements.find(element => element.id === context.activeId);
  const scene = sceneAt(project, context.activeId);
  const text = active && searchText(active.text);
  const captured = context.textAnchor;
  const current = captured && project.elements.find(element => element.id === captured.elementId);
  const selection = captured?.kind === 'text' && current && searchText(current.text) === captured.sourceText ? captured : null;
  return {
    selection,
    paragraph: active && text ? captureTextAnchor(active, 0, text.length) : null,
    scene: scene ? captureSceneAnchor(scene) : null,
  };
}

function AnnotationEditor({ annotation, run, context, close }: { annotation: Annotation; run: Common['run']; context: ReviewContext; close: () => void }) {
  const [body, setBody] = useState(annotation.body);
  const [status, setStatus] = useState(annotation.status);
  const [reason, setReason] = useState(annotation.reason || '');
  const [decision, setDecision] = useState(annotation.decision || '');
  const changed = body !== annotation.body || status !== annotation.status || reason !== (annotation.reason || '') || decision !== (annotation.decision || '');
  return <div data-review-annotation-editor data-project-draft-pending={changed ? 'true' : undefined}>
    <label className="revision-workspace__field">批注内容<textarea aria-label="编辑批注内容" maxLength={20000} {...draftProps(body !== annotation.body)} value={body} onChange={event => setBody(event.target.value)} /></label>
    <label className="revision-workspace__field">处理状态<select aria-label="批注处理状态" data-native-edit-history value={status} onChange={event => setStatus(event.target.value as AnnotationStatus)}>
      {Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </select></label>
    {status === 'declined' && <label className="revision-workspace__field">不采用原因（必填）<textarea aria-label="不采用原因" maxLength={20000} {...draftProps(reason !== (annotation.reason || ''))} value={reason} onChange={event => setReason(event.target.value)} /></label>}
    <label className="revision-workspace__field">创作决定（确认后记录）<textarea aria-label="创作决定" maxLength={20000} {...draftProps(decision !== (annotation.decision || ''))} value={decision} placeholder="明确写下本次决定，可留空" onChange={event => setDecision(event.target.value)} /></label>
    <div className="revision-workspace__row">
      <button className="btn btn--primary" disabled={!body.trim() || (status === 'declined' && !reason.trim())} onClick={() => {
        if (run(() => useStore.getState().updateAnnotation(annotation.id, { body, status, reason, decision }, context.documentEpoch))) close();
      }}>确认批注与决定</button>
      <button className="btn" onClick={close}>取消编辑</button>
    </div>
  </div>;
}

function AnnotationsPanel({ project, context, run, confirm, locate, leaveDraft, requestedId }: Common & { requestedId?: string }) {
  const annotations = project.annotations || [];
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [body, setBody] = useState('');
  const [choice, setChoice] = useState<AnchorChoice>(context.textAnchor || context.crossBlockSelection || context.selectionError ? 'selection' : 'paragraph');
  const [editing, setEditing] = useState<string | null>(null);
  const panel = useRef<HTMLElement>(null);
  const anchors = useAnchors(project, context);
  const anchor = anchors[choice];
  const items = annotations.filter(item => (!requestedId || item.id === requestedId) && (status === 'all' || item.status === status) && matches(query, item.body, item.reason, item.decision, item.anchor.kind === 'text' ? item.anchor.quote : ''));
  const edit = (id: string) => {
    if (editing) leaveDraft(() => setEditing(id), panel.current?.querySelector<HTMLElement>('[data-review-annotation-editor]'));
    else setEditing(id);
  };
  return <section ref={panel} className="revision-workspace__panel" aria-label="批注管理">
    <div className="revision-workspace__row">
      <label htmlFor="review-anchor-choice">批注位置</label>
      <select id="review-anchor-choice" aria-label="批注位置" value={choice} onChange={event => setChoice(event.target.value as AnchorChoice)}>
        <option value="selection">选中文字</option><option value="paragraph">当前段</option><option value="scene">当前场景</option>
      </select>
    </div>
    {choice === 'selection' && context.selectionError && <p className="revision-workspace__muted" role="status">{context.selectionError}</p>}
    {anchor ? <pre className="revision-workspace__text">{anchor.kind === 'text' ? anchor.quote : searchText(project.elements.find(element => element.id === anchor.elementId)?.text || '')}</pre>
      : <p className="revision-workspace__muted">此范围没有可用锚点，请回正文重新选取，或明确切换批注位置。</p>}
    <label className="revision-workspace__field">新批注<textarea aria-label="新批注" maxLength={20000} {...draftProps(!!body)} value={body} placeholder="记录这处要解决的问题" onChange={event => setBody(event.target.value)} /></label>
    <div className="revision-workspace__row">
      <button className="btn btn--primary" disabled={!anchor || !body.trim()} onClick={() => { if (anchor && run(() => useStore.getState().addAnnotation(anchor, body, context.documentEpoch))) setBody(''); }}>添加批注</button>
      <button className="btn" disabled={!body} onClick={() => setBody('')}>取消新批注</button>
    </div>
    <div className="revision-workspace__row" style={{ marginTop: 20 }}>
      <input aria-label="搜索批注" disabled={editing !== null} data-native-edit-history value={query} placeholder="搜索批注、原文或决定" onChange={event => { if (!editing) setQuery(event.target.value); }} />
      <select aria-label="筛选批注状态" disabled={editing !== null} value={status} onChange={event => { if (!editing) setStatus(event.target.value); }}><option value="all">全部状态</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
    </div>
    {editing && <p className="revision-workspace__muted">请先确认或取消当前批注编辑，再搜索或筛选。</p>}
    {!items.length && <p className="revision-workspace__empty">没有符合条件的批注。</p>}
    {items.map(item => {
      const exists = project.elements.some(element => element.id === item.anchor.elementId);
      return <article className="revision-workspace__card" key={item.id}>
        <div className="revision-workspace__tags"><span className="revision-workspace__tag">{statusLabels[item.status]}</span><span className="revision-workspace__tag">{item.anchor.kind === 'scene' ? '场景' : '文字'}</span>
          {item.anchorState !== 'current' && <span className="revision-workspace__tag">{item.anchorState === 'missing' ? '原段落已缺失' : '原文已改变'}</span>}
        </div>
        {item.anchor.kind === 'text' && <pre className="revision-workspace__text">{item.anchor.quote}</pre>}
        {editing === item.id ? <AnnotationEditor key={`${item.id}:${item.updatedAt}`} annotation={item} run={run} context={context} close={() => setEditing(null)} /> : <>
          <p style={{ whiteSpace: 'pre-wrap' }}>{item.body}</p>
          {item.reason && <p className="revision-workspace__muted">不采用原因：{item.reason}</p>}
          {item.decision && <p style={{ whiteSpace: 'pre-wrap' }}>创作决定：{item.decision}</p>}
          <p className="revision-workspace__muted">{date(item.updatedAt)}{item.anchorState === 'changed' ? ' · 可定位段落；精确文字范围须重新挂接。' : item.anchorState === 'missing' ? ' · 原记录仍保留，可重新挂接。' : ''}</p>
          <div className="revision-workspace__row">
            <button className="btn" disabled={!exists} onClick={() => locate(item.anchor.elementId, item.anchorState === 'current' && item.anchor.kind === 'text' ? item.anchor.start : undefined)}>定位正文</button>
            <button className="btn" onClick={() => edit(item.id)}>编辑 / 处理</button>
            <button className="btn" disabled={!anchor} onClick={() => { if (anchor) confirm({ message: '将这条批注重新挂接到上方明确选择的位置？原批注内容和处理记录保留。', label: '确认重新挂接', action: () => useStore.getState().reanchorAnnotation(item.id, anchor, context.documentEpoch) }); }}>重新挂接</button>
            <button className="btn" onClick={() => confirm({ message: '删除这条批注及其处理记录？删除可撤销。', label: '确认删除批注', action: () => useStore.getState().deleteAnnotation(item.id, context.documentEpoch) })}>删除批注</button>
          </div>
        </>}
      </article>;
    })}
  </section>;
}

function StashPanel({ project, context, run, confirm }: Common) {
  const entries = project.revisionWorkspace?.stash || [];
  const [scope, setScope] = useState<'paragraph' | 'selection' | 'scene'>('paragraph');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState(entries[0]?.id || '');
  const scene = sceneAt(project, context.activeId);
  const sceneIndex = scene && project.elements.findIndex(element => element.id === scene.id);
  const end = sceneIndex !== undefined ? project.elements.findIndex((element, index) => index > sceneIndex && element.type === 'scene_heading') : -1;
  const ids = scope === 'paragraph' ? project.elements.filter(element => element.id === context.activeId).map(element => element.id)
    : scope === 'selection' ? project.elements.filter(element => context.writingSelectedIds.includes(element.id)).map(element => element.id)
      : sceneIndex !== undefined ? project.elements.slice(sceneIndex, end === -1 ? undefined : end).map(element => element.id) : [];
  const selected = entries.find(item => item.id === chosen);
  const target = insertionTarget(project, context);
  const save = (remove: boolean) => {
    const result = useStore.getState().stashWritingElements(ids, name, note, remove, context.documentEpoch);
    if (result) { setName(''); setNote(''); const list = useStore.getState().project.revisionWorkspace?.stash; if (list?.length) setChosen(list[list.length - 1].id); }
    return result;
  };
  return <section className="revision-workspace__panel" aria-label="暂存管理">
    <p className="revision-workspace__muted">保存删减稿、备选段落或整场。恢复后仍保留暂存条目。</p>
    <div className="revision-workspace__row"><label htmlFor="review-stash-scope">暂存范围</label><select id="review-stash-scope" aria-label="暂存范围" value={scope} onChange={event => setScope(event.target.value as typeof scope)}>
      <option value="paragraph">打开时的当前段</option><option value="selection">打开时多选的段落</option><option value="scene">打开时的整场</option>
    </select><span className="revision-workspace__muted">{ids.length} 段</span></div>
    {scope === 'selection' && <p className="revision-workspace__muted">多选按正文顺序保存；不连续的段落恢复时会连续插入。</p>}
    <label className="revision-workspace__field">暂存名称<input aria-label="暂存名称" {...draftProps(!!name)} value={name} maxLength={REVISION_WORKSPACE_LIMITS.name} placeholder="例如：开场的另一种写法" onChange={event => setName(event.target.value)} /></label>
    <label className="revision-workspace__field">暂存备注<textarea aria-label="暂存备注" {...draftProps(!!note)} value={note} maxLength={REVISION_WORKSPACE_LIMITS.description} onChange={event => setNote(event.target.value)} /></label>
    <div className="revision-workspace__row">
      <button className="btn btn--primary" disabled={!ids.length || !name.trim()} onClick={() => run(() => save(false))}>复制存入</button>
      <button className="btn" disabled={!ids.length || !name.trim()} onClick={() => confirm({ message: `将所选 ${ids.length} 段存入暂存并移出正文？包括场次标题时，相应场景会移出；本次操作可以一次撤销。`, label: '确认存入并移出', action: () => save(true) })}>存入并移出正文</button>
      <button className="btn" disabled={!name && !note} onClick={() => { setName(''); setNote(''); }}>取消暂存草稿</button>
    </div>
    <div className="revision-workspace__split">
      <div className="revision-workspace__list"><input aria-label="搜索暂存" data-native-edit-history value={query} placeholder="搜索名称、备注或原文" onChange={event => setQuery(event.target.value)} />
        {entries.filter(item => matches(query, item.name, item.description, item.source.sceneLabel, paragraphsText(item.content.elements))).map(item => <button key={item.id} className="revision-workspace__entry" aria-pressed={chosen === item.id} onClick={() => setChosen(item.id)}><strong>{item.name}</strong><small>{date(item.createdAt)} · {item.content.elements.length} 段</small></button>)}
        {!entries.length && <p className="revision-workspace__empty">暂存为空。</p>}
      </div>
      <div className="revision-workspace__detail">{selected ? <>
        <h4>{selected.name}</h4><p className="revision-workspace__muted">来源：{selected.source.sceneLabel || '正文'} · {selected.kind === 'deleted' ? '移出正文' : '复制暂存'}</p>
        {selected.description && <p style={{ whiteSpace: 'pre-wrap' }}>{selected.description}</p>}
        <pre className="revision-workspace__text">{paragraphsText(selected.content.elements)}</pre>
        <p className="revision-workspace__muted">{target.label}。恢复会插入副本，保留暂存条目。</p>
        <div className="revision-workspace__row"><button className="btn btn--primary" disabled={!target.allowed} onClick={() => run(() => useStore.getState().restoreWorkspaceContent({ kind: 'stash', id: selected.id }, context.activeId, context.documentEpoch))}>恢复暂存副本</button>
          <button className="btn" onClick={() => confirm({ message: `删除暂存「${selected.name}」？正文不变，删除可撤销。`, label: '确认删除暂存', action: () => useStore.getState().deleteStashEntry(selected.id, context.documentEpoch) })}>删除暂存</button></div>
      </> : <p className="revision-workspace__empty">选择条目，查看来源与原文。</p>}</div>
    </div>
  </section>;
}

function ChecksPanel({ project, context, run, confirm, locate, showAnnotation }: Common & { showAnnotation: (id: string) => void }) {
  const issues = useMemo(() => buildDeliveryChecks(project), [project]);
  const [showIgnored, setShowIgnored] = useState(false);
  const [query, setQuery] = useState('');
  const ignored = project.deliveryIgnored || [];
  const shown = issues.filter(item => (showIgnored || !ignored.includes(item.signature)) && matches(query, item.title, item.detail));
  return <section className="revision-workspace__panel" aria-label="交稿检查">
    <p className="revision-workspace__muted">提示待确认的问题，由你决定如何修改正文。相关内容改变后，已忽略的问题会重新提醒。</p>
    <div className="revision-workspace__row"><input aria-label="搜索检查项" data-native-edit-history value={query} placeholder="搜索检查项" onChange={event => setQuery(event.target.value)} />
      <label><input type="checkbox" checked={showIgnored} onChange={event => setShowIgnored(event.target.checked)} /> 显示已忽略</label></div>
    {!!ignored.length && <><p className="revision-workspace__muted">当前扫描不显示已经消失的问题；其历史忽略记录仍可一并清理。</p>
      <button className="btn" onClick={() => confirm({ message: `清除全部 ${ignored.length} 条忽略记录并恢复提醒？正文不变，本次操作可以撤销。`, label: '确认恢复全部提醒', action: () => useStore.getState().clearDeliveryIgnored(context.documentEpoch) })}>恢复全部提醒（{ignored.length}条记录）</button>
    </>}
    {!shown.length && <p className="revision-workspace__empty">当前没有需要显示的检查项。</p>}
    {shown.map(issue => <article className="revision-workspace__card" key={issue.signature}><h5>{issue.title}{ignored.includes(issue.signature) ? ' · 已忽略' : ''}</h5><p>{issue.detail}</p>
      <div className="revision-workspace__row">
        <button className="btn" disabled={!issue.elementIds.length} onClick={() => locate(issue.elementIds[0])}>定位正文</button>
        {issue.annotationId && <button className="btn" onClick={() => showAnnotation(issue.annotationId!)}>查看批注</button>}
        <button className="btn" onClick={() => run(() => useStore.getState().setDeliveryIgnored(issue.signature, !ignored.includes(issue.signature), context.documentEpoch))}>{ignored.includes(issue.signature) ? '恢复提醒' : '忽略此项'}</button>
      </div>
    </article>)}
  </section>;
}

export function RevisionWorkspaceDialog({ context, onClose, session }: { context: ReviewContext; onClose: () => void; session?: ModalSession }) {
  const project = useStore(state => state.project);
  const epoch = useStore(state => state.documentEpoch);
  const [tab, setTab] = useState<Tab>('versions');
  const [confirmation, setConfirmation] = useState<Confirm | null>(null);
  const [annotationId, setAnnotationId] = useState<string | undefined>();
  const node = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const tabsId = useId();
  const closeRef = useRef(onClose);
  const modal = useRef<ModalSession | null>(session || null);
  const historyRef = useRef<(direction: 'undo' | 'redo') => void>(() => {});
  const generation = useRef(0);
  const usage = revisionWorkspaceUsage(project.revisionWorkspace);
  const annotationBytes = useMemo(() => new TextEncoder().encode(JSON.stringify(project.annotations || [])).byteLength, [project.annotations]);
  const valid = epoch === context.documentEpoch;
  useLayoutEffect(() => {
    const dialog = node.current!;
    const current = modal.current ||= createModalSession();
    const lifetime = ++generation.current;
    const cleanup = containModal(dialog, dialog.parentElement!, () => closeRef.current());
    current.activate();
    const history = (event: InputEvent) => {
      if (event.isComposing || ownsNativeHistory(event.target) || !['historyUndo', 'historyRedo'].includes(event.inputType)) return;
      event.preventDefault(); event.stopPropagation(); historyRef.current(event.inputType === 'historyUndo' ? 'undo' : 'redo');
    };
    dialog.addEventListener('beforeinput', history);
    return () => { cleanup(); dialog.removeEventListener('beforeinput', history); queueMicrotask(() => {
      if (generation.current === lifetime && !dialog.isConnected && !document.querySelector('[aria-modal="true"]')) current.restore();
    }); };
  }, []);
  useLayoutEffect(() => {
    if (confirmation) node.current?.querySelector<HTMLButtonElement>('[data-review-confirm-cancel]')?.focus({ preventScroll: true });
  }, [confirmation]);
  const run: Common['run'] = action => {
    if (useStore.getState().documentEpoch !== context.documentEpoch) { useStore.getState().notify('工程已切换，请关闭工作台后重新打开。', 'error'); return false; }
    return action();
  };
  const leaveDraft: Common['leaveDraft'] = (action, scope = node.current) => {
    if (scope?.matches('[data-project-draft-pending="true"]') || scope?.querySelector('[data-project-draft-pending="true"]')) {
      setConfirmation({ message: '还有未确认的草稿。离开会放弃这些输入，已保存的工作台内容仍会保留。', label: '放弃草稿并继续', documentIndependent: true, action: () => { action(); return true; } });
    } else action();
  };
  const close = () => leaveDraft(onClose);
  closeRef.current = close;
  const history = (direction: 'undo' | 'redo') => {
    if (node.current?.querySelector('[data-project-draft-pending="true"]') && !ownsNativeHistory(document.activeElement)) {
      useStore.getState().notify('请先确认或取消当前草稿，再撤销工作台操作。'); return;
    }
    modal.current?.history(direction);
  };
  historyRef.current = history;
  const activateTab = (id: Tab, focus = false) => leaveDraft(() => {
    setTab(id); setConfirmation(null); setAnnotationId(undefined);
    if (focus) requestAnimationFrame(() => document.getElementById(`${tabsId}-${id}`)?.focus());
  });
  const locate: Common['locate'] = (id, caret) => {
    if (!valid || !useStore.getState().project.elements.some(element => element.id === id)) return;
    leaveDraft(() => {
      onClose();
      requestAnimationFrame(() => {
        if (useStore.getState().documentEpoch !== context.documentEpoch || !useStore.getState().project.elements.some(element => element.id === id)) return;
        useStore.getState().setView('write'); useStore.getState().requestFocus(id, caret ?? 'start', 'center');
      });
    });
  };
  const common: Common = { project, context, run, locate, leaveDraft, confirm: setConfirmation };
  const tabs: { id: Tab; label: string }[] = [{ id: 'versions', label: '版本' }, { id: 'annotations', label: '批注' }, { id: 'stash', label: '暂存' }, { id: 'checks', label: '交稿检查' }];
  return <div className="modal-backdrop" data-export-exclude onMouseDown={event => { if (event.target === event.currentTarget) event.preventDefault(); }} onClick={event => { if (event.target === event.currentTarget) close(); }} onKeyDown={event => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const key = event.key.toLowerCase();
    if (event.metaKey || event.ctrlKey) {
      if ((key === 'z' || key === 'y') && !ownsNativeHistory(event.target)) { event.preventDefault(); history(key === 'y' || event.shiftKey ? 'redo' : 'undo'); }
      else if (['s', 'o', 'n', 'p', 'f', 'd', '1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(key)) event.preventDefault();
    }
  }}>
    <div ref={node} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="modal modal--wide revision-workspace" data-export-exclude onMouseDown={event => event.stopPropagation()}>
      <header className="modal__head"><h3 id={titleId}>改稿工作台</h3><button className="icon-btn" aria-label="关闭改稿工作台" onClick={close}>×</button></header>
      <div className="modal__body">
        <div className="revision-workspace__tabs" role="tablist" aria-label="改稿工作台功能">{tabs.map((item, index) => <button key={item.id} id={`${tabsId}-${item.id}`} role="tab" tabIndex={tab === item.id ? 0 : -1} aria-selected={tab === item.id} aria-controls={`${tabsId}-panel`} data-modal-autofocus={tab === item.id ? '' : undefined} onClick={() => { if (item.id !== tab || annotationId) activateTab(item.id); }} onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
          activateTab(tabs[next].id, true);
        }}>{item.label}</button>)}</div>
        {!valid && <p className="revision-workspace__warning" role="alert">工程已切换。此工作台已过期，请关闭后重新打开。</p>}
        <div id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-${tab}`} data-export-exclude>
          <fieldset disabled={!valid || !!confirmation} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            {tab === 'versions' && <VersionsPanel {...common} />}
            {tab === 'annotations' && <AnnotationsPanel {...common} requestedId={annotationId} />}
            {tab === 'stash' && <StashPanel {...common} />}
            {tab === 'checks' && <ChecksPanel {...common} showAnnotation={id => { setAnnotationId(id); setTab('annotations'); }} />}
          </fieldset>
        </div>
        {confirmation && <section className="revision-workspace__confirm" role="alert" aria-label="确认操作"><p>{confirmation.message}</p><div className="revision-workspace__row">
          <button className="btn" data-review-confirm-cancel onClick={() => setConfirmation(null)}>取消操作</button><button className="btn btn--primary" disabled={!valid && !confirmation.documentIndependent} onClick={() => { if (confirmation.documentIndependent ? confirmation.action() : run(confirmation.action)) setConfirmation(null); }}>{confirmation.label}</button>
        </div></section>}
        <footer className="revision-workspace__foot"><span className="revision-workspace__muted">版本 {usage.versions} / 20 · 暂存 {usage.stash} / 100 · {(usage.bytes / 1024 / 1024).toFixed(2)} / 2 MiB<br />批注 {project.annotations?.length || 0} / {MAX_ANNOTATIONS} · {(annotationBytes / 1024).toFixed(1)} / {MAX_ANNOTATIONS_BYTES / 1024} KiB<br />版本、批注、暂存随工程保存，操作可撤销。<br />正文版本不含图片、板面位置或设置。</span>
          <div className="revision-workspace__row"><button className="btn" disabled={!valid || !!confirmation} onClick={() => history('undo')}>撤销本次操作</button><button className="btn" disabled={!valid || !!confirmation} onClick={() => history('redo')}>重做</button><button className="btn" onClick={close}>关闭</button></div></footer>
      </div>
    </div>
  </div>;
}
