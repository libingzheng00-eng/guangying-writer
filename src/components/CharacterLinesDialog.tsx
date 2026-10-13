import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { containModal, createModalSession } from '../app/modalFocus';
import { ownsNativeHistory } from '../utils/editHistory';
import { uid } from '../utils/id';
import type { Annotation, AnnotationAnchor } from '../model/annotations';
import type { CharacterLineCharacter, CharacterOccurrence, CharacterProfile } from '../model/characterLines';

type DialogBase = { epoch: number; onClose: () => void };
const draft = (changed: boolean) => ({ 'data-native-edit-history': '', 'data-project-draft-pending': changed ? 'true' : undefined });

/** Small explicit transactions share the established modal focus boundary. */
export function CharacterLinesDialog({ title, epoch, dirty, onClose, children }: DialogBase & {
  title: string; dirty: boolean; children: React.ReactNode;
}) {
  const node = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [discard, setDiscard] = useState(false);
  const currentEpoch = useStore(state => state.documentEpoch);
  const session = useRef<ReturnType<typeof createModalSession> | null>(null);
  const generation = useRef(0);
  const close = useRef(() => {});
  close.current = () => { if (dirty) setDiscard(true); else onClose(); };
  useLayoutEffect(() => {
    const dialog = node.current!;
    const modal = session.current ||= createModalSession();
    const lifetime = ++generation.current;
    const cleanup = containModal(dialog, dialog.parentElement!, () => close.current());
    modal.activate();
    const history = (event: InputEvent) => {
      if (event.isComposing || ownsNativeHistory(event.target) || !['historyUndo', 'historyRedo'].includes(event.inputType)) return;
      event.preventDefault(); event.stopPropagation();
    };
    dialog.addEventListener('beforeinput', history);
    return () => {
      cleanup(); dialog.removeEventListener('beforeinput', history);
      queueMicrotask(() => {
        if (generation.current === lifetime && !dialog.isConnected && !document.querySelector('[aria-modal="true"]')) modal.restore();
      });
    };
  }, []);
  useLayoutEffect(() => {
    if (discard) node.current?.querySelector<HTMLButtonElement>('[data-character-keep-draft]')?.focus({ preventScroll: true });
  }, [discard]);
  return <div className="modal-backdrop character-dialog-backdrop" data-export-exclude
    onMouseDown={event => { if (event.target === event.currentTarget) event.preventDefault(); }}
    onClick={event => { if (event.target === event.currentTarget) close.current(); }}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if ((event.metaKey || event.ctrlKey) && !ownsNativeHistory(event.target)) event.preventDefault();
    }}>
    <div ref={node} className="modal character-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} data-export-exclude>
      <header className="modal__head"><h3 id={titleId}>{title}</h3><button className="icon-btn" aria-label={`关闭${title}`} onClick={() => close.current()}>×</button></header>
      <div className="modal__body">
        {currentEpoch !== epoch && <p className="character-lines__warning" role="alert">工程已切换。这份草稿已过期，请关闭后重新打开。</p>}
        <fieldset disabled={currentEpoch !== epoch || discard} className="character-dialog__fields">{children}</fieldset>
        {discard && <div className="character-lines__warning" role="alert"><p>还有未确认的输入。放弃后，已保存的记录仍会保留。</p><div className="character-lines__actions">
          <button className="btn" data-character-keep-draft onClick={() => setDiscard(false)}>继续编辑</button>
          <button className="btn" onClick={onClose}>放弃草稿并关闭</button>
        </div></div>}
      </div>
    </div>
  </div>;
}

export function CharacterProfileDialog({ profile, epoch, onClose, onSaved }: DialogBase & {
  profile?: CharacterLineCharacter; onSaved: (id: string) => void;
}) {
  const [name, setName] = useState(profile?.canonicalName || '');
  const [aliases, setAliases] = useState(profile?.aliases.join('\n') || '');
  const [description, setDescription] = useState(profile?.disambiguation || '');
  const [remove, setRemove] = useState(false);
  const [error, setError] = useState('');
  const base = useRef({ name, aliases, description });
  const changed = name !== base.current.name || aliases !== base.current.aliases || description !== base.current.description;
  const workspace = useStore(state => state.project.characterWorkspace);
  const profiles = workspace?.profiles || [];
  const parsedAliases = Array.from(new Set(aliases.split(/\r?\n/).map(value => value.trim()).filter(Boolean)));
  const names = new Set([name.trim(), ...parsedAliases].filter(Boolean));
  const conflicts = profiles.filter(item => item.id !== profile?.id && [item.canonicalName, ...item.aliases].some(value => names.has(value)));
  const save = () => {
    if (!name.trim()) { setError('请填写规范人物名。'); return; }
    const id = profile?.registered ? profile.id : uid('character');
    const next: CharacterProfile = { id, canonicalName: name.trim(), aliases: parsedAliases, ...(description.trim() ? { disambiguation: description.trim() } : {}) };
    if (useStore.getState().upsertCharacterProfile(next, epoch)) { onSaved(id); onClose(); }
    else setError(useStore.getState().toast?.text || '人物未保存，请检查输入。');
  };
  return <CharacterLinesDialog title={profile?.registered ? '管理人物' : '登记人物'} epoch={epoch} dirty={changed} onClose={onClose}>
    <p className="character-lines__muted">规范名称和别名用于阅读归属，正文保持原样。别名按完整写法匹配，每行一个。</p>
    <label className="character-lines__field">规范人物名<input data-modal-autofocus aria-label="规范人物名" maxLength={200} {...draft(changed)} value={name} onChange={event => { setName(event.target.value); setError(''); }} /></label>
    <label className="character-lines__field">别名<textarea aria-label="人物别名" rows={4} {...draft(changed)} value={aliases} onChange={event => { setAliases(event.target.value); setError(''); }} placeholder="每行一个精确写法，如昵称或旧称" /></label>
    <label className="character-lines__field">同名说明（选填）<textarea aria-label="同名说明" maxLength={500} rows={2} {...draft(changed)} value={description} onChange={event => setDescription(event.target.value)} placeholder="用于区分同名人物，例如：青年时期 / 同名的另一人" /></label>
    {!!conflicts.length && <p className="character-lines__warning" role="status">与 {conflicts.map(item => item.canonicalName + (item.disambiguation ? `（${item.disambiguation}）` : '')).join('、')} 有同名写法。相关证据将保留歧义，可逐条指定归属；不会自动合并人物。</p>}
    {error && <p className="character-lines__warning" role="alert">{error}</p>}
    <div className="character-lines__actions"><button className="btn btn--primary" disabled={!name.trim() || (!!profile?.registered && !changed)} onClick={save}>保存人物</button><button className="btn" onClick={onClose}>{changed ? '放弃本次编辑' : '取消编辑'}</button>
      {profile?.registered && <button className="btn" onClick={() => setRemove(true)}>移除人物登记</button>}
    </div>
    {remove && <div className="character-lines__warning" role="alert"><p>移除这份人物登记、身份纠正和发言归属，同时解除人物笔记关联？正文与批注内容保留，此操作可以撤销。</p><div className="character-lines__actions"><button className="btn" onClick={() => setRemove(false)}>保留人物</button><button className="btn" onClick={() => { if (profile && useStore.getState().removeCharacterProfile(profile.id, epoch)) onClose(); }}>确认移除人物</button></div></div>}
  </CharacterLinesDialog>;
}

export function CharacterEvidenceDialog({ occurrence, character, characters, epoch, onClose }: DialogBase & {
  occurrence: CharacterOccurrence; character: CharacterLineCharacter; characters: CharacterLineCharacter[];
}) {
  const profiles = characters.filter(item => item.registered);
  const workspace = useStore(state => state.project.characterWorkspace);
  const previous = occurrence.overrideId ? workspace?.overrides.find(item => item.id === occurrence.overrideId) : workspace?.assignments.find(item => item.id === occurrence.assignmentId);
  const [person, setPerson] = useState(character.registered ? character.id : occurrence.characterId || '');
  const [classification, setClassification] = useState(occurrence.classification);
  const [reason, setReason] = useState(previous?.reason || '');
  const [error, setError] = useState('');
  const assignmentMode = occurrence.kind === 'speech' && (occurrence.ambiguous || !person || person !== occurrence.characterId || (!!occurrence.assignmentId && !occurrence.overrideId));
  const allowedPerson = profiles.some(profile => profile.id === person) || (assignmentMode && !person);
  const changed = person !== (character.registered ? character.id : occurrence.characterId || '') || classification !== occurrence.classification || reason !== (previous?.reason || '');
  const save = () => {
    if (!allowedPerson) { setError('请先登记一个人物，再确认归属。'); return; }
    const state = useStore.getState();
    let ok: boolean;
    if (assignmentMode && occurrence.anchor.kind === 'text') {
      ok = state.setCharacterAssignment({ id: occurrence.assignmentId || uid('character-assignment'), characterId: person || null, anchor: occurrence.anchor, anchorState: 'current', ...(reason.trim() ? { reason: reason.trim() } : {}) }, epoch);
    } else {
      ok = state.setCharacterOverride({ id: occurrence.overrideId || uid('character-override'), characterId: person, anchor: occurrence.anchor, classification, anchorState: 'current', ...(reason.trim() ? { reason: reason.trim() } : {}) }, epoch);
    }
    if (ok) onClose(); else setError(state.toast?.text || '纠正未保存，原文或记录可能已经变化。');
  };
  return <CharacterLinesDialog title="确认人物证据" epoch={epoch} dirty={changed} onClose={onClose}>
    <p className="character-lines__muted">{occurrence.explanation}{occurrence.originalExplanation && <><br />原始依据：{occurrence.originalExplanation}</>}</p><blockquote className="character-lines__quote">{occurrence.quote || '此场景的作者标记'}</blockquote>
    <label className="character-lines__field">归属人物<select data-modal-autofocus aria-label="证据归属人物" value={person} onChange={event => setPerson(event.target.value)}><option value="">{occurrence.kind === 'speech' ? '明确标为未知归属' : '请选择已登记人物'}</option>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.canonicalName}{profile.disambiguation ? ` · ${profile.disambiguation}` : ''}</option>)}</select></label>
    <label className="character-lines__field">作者分类<select aria-label="证据分类" disabled={assignmentMode} value={classification} onChange={event => setClassification(event.target.value as typeof classification)}>
      <option value="present">实际出场</option><option value="mentioned">仅被提及</option><option value="uncertain">暂不确定</option><option value="irrelevant">与此人物无关</option>
    </select></label>
    {assignmentMode && <p className="character-lines__muted">这次只确认发言归属。保存后可再单独确认是否实际在场；说话不等于出场。</p>}
    <label className="character-lines__field">依据 / 说明（选填）<textarea aria-label="纠正说明" rows={3} maxLength={2000} {...draft(!!reason)} value={reason} onChange={event => setReason(event.target.value)} /></label>
    {error && <p className="character-lines__warning" role="alert">{error}</p>}
    <div className="character-lines__actions"><button className="btn btn--primary" disabled={!allowedPerson} onClick={save}>保存纠正</button><button className="btn" onClick={onClose}>{changed ? '放弃本次纠正' : '取消纠正'}</button>
      {(occurrence.overrideId || occurrence.assignmentId) && <button className="btn" onClick={() => {
        const state = useStore.getState();
        const ok = occurrence.overrideId ? state.deleteCharacterOverride(occurrence.overrideId, epoch) : state.deleteCharacterAssignment(occurrence.assignmentId!, epoch);
        if (ok) onClose();
      }}>撤回作者纠正</button>}
    </div>
  </CharacterLinesDialog>;
}

export function CharacterNoteDialog({ character, characters, anchor, annotation, topic: initialTopic = 'note', relatedCharacterId, epoch, onClose }: DialogBase & {
  character: CharacterLineCharacter; characters: CharacterLineCharacter[]; anchor: AnnotationAnchor;
  annotation?: Annotation; topic?: 'note' | 'relationship' | 'knowledge'; relatedCharacterId?: string;
}) {
  const [body, setBody] = useState(annotation?.body || '');
  const [topic, setTopic] = useState(initialTopic);
  const [related, setRelated] = useState(relatedCharacterId || '');
  const [pending, setPending] = useState(annotation?.status === 'pending');
  const [statusChanged, setStatusChanged] = useState(false);
  const [error, setError] = useState('');
  const changed = body !== (annotation?.body || '') || topic !== initialTopic || related !== (relatedCharacterId || '') || pending !== (annotation?.status === 'pending');
  const save = () => {
    const state = useStore.getState();
    const ok = annotation ? state.updateAnnotation(annotation.id, { body, ...(statusChanged ? { status: pending ? 'pending' as const : 'resolved' as const } : {}) }, epoch)
      : state.addCharacterNote(character.id, anchor, body, { topic, relatedCharacterId: related || undefined, status: pending ? 'pending' : 'resolved' }, epoch);
    if (ok) onClose(); else setError(state.toast?.text || '笔记未保存，请检查内容或容量。');
  };
  return <CharacterLinesDialog title={annotation ? '编辑人物笔记' : '添加人物笔记'} epoch={epoch} dirty={changed} onClose={onClose}>
    <p className="character-lines__muted">{character.canonicalName} · 这是作者的创作记录，与改稿工作台共用同一条批注。随工程保存，不进入正文或正式导出。</p>
    <label className="character-lines__field">类别<select aria-label="笔记类别" disabled={!!annotation} value={topic} onChange={event => setTopic(event.target.value as typeof topic)}><option value="note">人物笔记</option><option value="relationship">关系变化</option><option value="knowledge">知道的信息</option></select></label>
    {topic === 'relationship' && <label className="character-lines__field">关联人物（选填）<select aria-label="笔记关联人物" disabled={!!annotation} value={related} onChange={event => setRelated(event.target.value)}><option value="">不指定</option>{characters.filter(item => item.registered && item.id !== character.id).map(item => <option key={item.id} value={item.id}>{item.canonicalName}</option>)}</select></label>}
    <label className="character-lines__field">{topic === 'knowledge' ? '作者记录：人物此时知道什么' : '内容'}<textarea data-modal-autofocus aria-label="人物笔记内容" maxLength={20000} rows={6} {...draft(body !== (annotation?.body || ''))} value={body} onChange={event => { setBody(event.target.value); setError(''); }} /></label>
    {annotation?.status === 'declined' && !statusChanged && <p className="character-lines__muted">此批注原状态为“不采用”。只编辑文字会保留状态与原因。</p>}
    <label className="character-lines__check"><input type="checkbox" aria-label="需要后续处理" checked={pending} onChange={event => { setPending(event.target.checked); setStatusChanged(true); }} />需要后续处理（加入交稿检查）</label>
    {error && <p className="character-lines__warning" role="alert">{error}</p>}
    <div className="character-lines__actions"><button className="btn btn--primary" disabled={!body.trim() || (!!annotation && !changed)} onClick={save}>保存人物笔记</button><button className="btn" onClick={onClose}>{changed ? '放弃本次笔记输入' : '取消笔记'}</button></div>
  </CharacterLinesDialog>;
}
