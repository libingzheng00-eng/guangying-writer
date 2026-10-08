import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { ELEMENT_META, ELEMENT_ORDER, FONT_PRESETS, REVISION_COLORS } from '../model/elements';
import type { ElementType, Revision, TextAlign } from '../model/types';
import { uid } from '../utils/id';
import { DEFAULT_FONT_COLOR, resolveFontColor } from '../model/appearance';
import { isHexColor } from '../utils/color';
import { containModal, createModalSession, type ModalSession } from '../app/modalFocus';
import { ownsNativeHistory } from '../utils/editHistory';
import { validateProjectSettings } from '../model/projectSettingsValidation';

/** Invalid numeric edits stay in this control, never in a project snapshot.
 * Valid edits keep the existing immediate store/history behavior. */
function SettingsNumberInput({ value, label, validate, commit, step }: {
  value: number; label: string; validate: (value: number) => string | undefined;
  commit: (value: number) => void; step?: number;
}) {
  const errorId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  // Undo/redo and document changes must repaint the current model value.
  useLayoutEffect(() => setDraft(null), [value]);
  const message = (raw: string) => raw.trim() === '' || !Number.isFinite(Number(raw))
    ? '请输入有限的数字，原设置未改变。' : validate(Number(raw));
  // Changing another field can make a rejected geometry draft admissible. It
  // still has not been committed: keep that distinction visible until edited.
  const error = draft === null ? undefined : message(draft) || '此输入尚未应用，请重新输入以确认。';
  return <>
    <input type="number" step={step} aria-label={label} value={draft ?? value}
      aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}
      data-native-edit-history={draft !== null ? '' : undefined}
      onChange={event => {
        const raw = event.target.value;
        if (message(raw)) setDraft(raw);
        else { setDraft(null); commit(Number(raw)); }
      }} />
    {error ? <span id={errorId} className="hint" role="alert">{error}</span> : null}
  </>;
}

/** 可选自定义颜色；默认值另用 auto 跟随日夜主题。 */
const FONT_COLOR_PRESETS = [
  { name: '纯黑', color: '#000000' },
  { name: '纯白', color: '#ffffff' },
  { name: '荧光黄', color: '#e9ff3a' },
  { name: '暖白', color: '#ffe9c4' },
  { name: '青蓝', color: '#8fd3ff' },
  { name: '薄荷', color: '#a8ffcf' },
  { name: '樱粉', color: '#ffb3d1' },
  { name: '浅灰', color: '#c9d1d9' },
];

type DialogProps = { onClose: () => void; session?: ModalSession };

function Modal({ title, onClose, children, wide, session }: DialogProps & { title: string; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const latestClose = useRef(onClose);
  latestClose.current = onClose;
  const sessionRef = useRef<ModalSession | null>(session || null);
  const generation = useRef(0);
  useLayoutEffect(() => {
    const node = ref.current!;
    const current = sessionRef.current ||= createModalSession();
    const lifetime = ++generation.current;
    const cleanup = containModal(node, node.parentElement!, () => latestClose.current());
    current.activate();
    const history = (event: InputEvent) => {
      if (event.isComposing) return;
      if (event.inputType !== 'historyUndo' && event.inputType !== 'historyRedo') return;
      if (ownsNativeHistory(event.target)) return;
      event.preventDefault(); event.stopPropagation();
      current.history(event.inputType === 'historyUndo' ? 'undo' : 'redo');
    };
    node.addEventListener('beforeinput', history);
    return () => {
      cleanup();
      node.removeEventListener('beforeinput', history);
      // StrictMode replays effects with the same live node. Restore only after
      // a genuine close, and never steal focus from a replacement modal.
      queueMicrotask(() => {
        if (generation.current === lifetime && !node.isConnected && !document.querySelector('[aria-modal="true"]')) current.restore();
      });
    };
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={event => {
      // Keep the modal alive through pointer release: removing it on mousedown
      // can expose a background control to the rest of the same gesture.
      if (event.target === event.currentTarget) event.preventDefault();
    }} onClick={event => {
      if (event.target === event.currentTarget) onClose();
    }} onKeyDown={event => {
      // Keep board/editor window shortcuts from observing modal keystrokes.
      event.stopPropagation();
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      const key = event.key.toLowerCase();
      if (event.metaKey || event.ctrlKey) {
        if ((key === 'z' || key === 'y') && !ownsNativeHistory(event.target)) {
          event.preventDefault(); sessionRef.current?.history(key === 'y' || event.shiftKey ? 'redo' : 'undo');
        } else if (['s', 'o', 'n', 'p', 'f', 'd', '1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(key)) {
          event.preventDefault();
        }
      }
    }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={`modal ${wide ? 'modal--wide' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal__head">
          <h3 id={titleId}>{title}</h3>
          <button className="icon-btn" aria-label={`关闭${title}`} onClick={onClose}>
            ×
          </button>
        </header>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  );
}

export function TitlePageDialog({ onClose, session }: DialogProps) {
  const tp = useStore((s) => s.project.titlePage);
  const update = useStore((s) => s.updateTitlePage);
  const rows: { key: keyof typeof tp; label: string; area?: boolean }[] = [
    { key: 'title', label: '剧名' },
    { key: 'subtitle', label: '副标题' },
    { key: 'author', label: '编剧' },
    { key: 'basedOn', label: '改编自' },
    { key: 'version', label: '稿别 / 版本' },
    { key: 'date', label: '日期' },
    { key: 'contact', label: '联系方式' },
    { key: 'notes', label: '备注', area: true },
  ];
  return (
    <Modal title="标题页" onClose={onClose} session={session}>
      <div className="form">
        <label className="checkbox">
          <input type="checkbox" checked={tp.show} onChange={(e) => update({ show: e.target.checked })} />
          打印时输出标题页
        </label>
        {rows.map((r) => (
          <div className="field" key={String(r.key)}>
            <label>{r.label}</label>
            {r.area ? (
              <textarea value={tp[r.key] as string} rows={3} onChange={(e) => update({ [r.key]: e.target.value })} />
            ) : (
              <input aria-label={r.label} data-modal-autofocus={r.key === 'title' ? '' : undefined} value={tp[r.key] as string} onChange={(e) => update({ [r.key]: e.target.value })} />
            )}
          </div>
        ))}
      </div>
      <footer className="modal__foot">
        <button className="btn btn--primary" onClick={onClose}>
          完成
        </button>
      </footer>
    </Modal>
  );
}

export function SettingsDialog({ onClose, session }: DialogProps) {
  const settings = useStore((s) => s.project.settings);
  const revisions = useStore((s) => s.project.revisions);
  const update = useStore((s) => s.updateSettings);
  const updateIndent = useStore((s) => s.updateIndent);
  const updateRevisions = useStore((s) => s.updateRevisions);
  const fontColor = useStore((s) => s.fontColor);
  const setFontColor = useStore((s) => s.setFontColor);
  const appTheme = useStore((s) => s.appTheme);
  const resolvedFontColor = resolveFontColor(fontColor, appTheme);
  const setAppTheme = useStore((s) => s.setAppTheme);
  const [tab, setTab] = useState<'page' | 'indent' | 'revision' | 'appearance' | 'general'>('page');

  const [paperError, setPaperError] = useState<string | undefined>();
  const paperErrorId = useId();
  useLayoutEffect(() => setPaperError(undefined), [settings]);
  const settingError = (field: string, candidate: unknown) => {
    const errors = validateProjectSettings(candidate);
    return (errors.find(error => error.field === field) || errors[0])?.message;
  };
  const numberInput = (field: 'fontSize' | 'lineHeight' | 'marginTop' | 'marginBottom' | 'marginLeft' | 'marginRight' | 'startPageAt' | 'wordsPerMinute', label: string, step?: number) =>
    <SettingsNumberInput value={settings[field]} label={label} step={step}
      validate={value => {
        // Preserve these controls' existing positive UI limits, but reject an
        // invalid draft explicitly instead of silently replacing its value.
        if (field === 'startPageAt' && value < 1) return '页码起始须至少为 1，原设置未改变。';
        if (field === 'wordsPerMinute' && value < 50) return '每分钟字数须至少为 50，原设置未改变。';
        return settingError(field, { ...useStore.getState().project.settings, [field]: value });
      }} commit={value => update({ [field]: value })} />;
  const indentInput = (type: ElementType, field: 'left' | 'right' | 'spaceBefore', label: string) =>
    <SettingsNumberInput value={settings.indent[type][field]} label={`${ELEMENT_META[type].label}${label}`}
      validate={value => {
        const current = useStore.getState().project.settings;
        return settingError(`indent.${type}.${field}`, { ...current, indent: { ...current.indent, [type]: { ...current.indent[type], [field]: value } } });
      }} commit={value => updateIndent(type, { [field]: value })} />;

  return (
    <Modal title="显示简介设置" onClose={onClose} session={session} wide>
      <div className="tabs">
        {(
          [
            ['page', '版式'],
            ['indent', '元素缩进'],
            ['revision', '修订'],
            ['appearance', '外观'],
            ['general', '常规'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} data-modal-autofocus={tab === k ? '' : undefined} className={tab === k ? 'is-active' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'page' ? (
        <div className="form form--grid">
          <div className="field">
            <label>正文字体</label>
            <select value={settings.fontKey} onChange={(e) => update({ fontKey: e.target.value })}>
              {FONT_PRESETS.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>字号（pt）</label>
            {numberInput('fontSize', '字号（pt）')}
          </div>
          <div className="field">
            <label>行距（倍）</label>
            {numberInput('lineHeight', '行距（倍）', 0.05)}
          </div>
          <div className="field">
            <label>纸张</label>
            <select aria-label="纸张" value={settings.paper} aria-invalid={paperError ? true : undefined} aria-describedby={paperError ? paperErrorId : undefined} onChange={e => {
              const paper = e.target.value as 'A4' | 'letter';
              const error = settingError('paper', { ...useStore.getState().project.settings, paper });
              setPaperError(error);
              if (!error) update({ paper });
            }}>
              <option value="A4">A4</option>
              <option value="letter">Letter</option>
            </select>
            {paperError ? <span id={paperErrorId} className="hint" role="alert">{paperError}</span> : null}
          </div>
          {(
            [
              ['marginTop', '上边距（cm）'],
              ['marginBottom', '下边距（cm）'],
              ['marginLeft', '左边距（cm）'],
              ['marginRight', '右边距（cm）'],
            ] as const
          ).map(([k, label]) => (
            <div className="field" key={k}>
              <label>{label}</label>
              {numberInput(k, label, 0.1)}
            </div>
          ))}
          <div className="field">
            <label>场号位置</label>
            <select value={settings.sceneNumber} onChange={(e) => update({ sceneNumber: e.target.value as typeof settings.sceneNumber })}>
              <option value="none">不显示</option>
              <option value="left">左侧</option>
              <option value="right">右侧</option>
              <option value="both">两侧</option>
            </select>
          </div>
          <div className="field">
            <label>页码起始</label>
            {numberInput('startPageAt', '页码起始')}
          </div>
          <div className="field">
            <label>「（更多）」文案</label>
            <input value={settings.moreText} onChange={(e) => update({ moreText: e.target.value })} />
          </div>
          <div className="field">
            <label>「（续）」文案</label>
            <input value={settings.contdText} onChange={(e) => update({ contdText: e.target.value })} />
          </div>
          <div className="field">
            <label>字数 / 每分钟（时长估算）</label>
            {numberInput('wordsPerMinute', '字数 / 每分钟（时长估算）')}
          </div>
          <div className="field field--checks">
            <label className="checkbox">
              <input type="checkbox" checked={settings.autoNumberScenes} onChange={(e) => update({ autoNumberScenes: e.target.checked })} />
              自动编号场次
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={settings.showPageNumbers} onChange={(e) => update({ showPageNumbers: e.target.checked })} />
              显示页码
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={settings.showContd} onChange={(e) => update({ showContd: e.target.checked })} />
              跨页对白显示「（续）」
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={settings.contdCharacter !== false}
                onChange={(e) => update({ contdCharacter: e.target.checked })}
              />
              同一人物再次说话时自动显示 (CONT'D)
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={settings.titlePageBreak} onChange={(e) => update({ titlePageBreak: e.target.checked })} />
              标题页独立成页
            </label>
          </div>
        </div>
      ) : null}

      {tab === 'indent' ? (
        <div>
          <p className="hint">缩进单位为「全角字符数」，1 = 一个汉字宽度。修改后分页会立即重新计算。</p>
          <table className="table">
            <thead>
              <tr>
                <th>元素</th>
                <th style={{ width: 110 }}>左缩进</th>
                <th style={{ width: 110 }}>右缩进</th>
                <th style={{ width: 120 }}>对齐</th>
                <th style={{ width: 110 }}>前空行</th>
              </tr>
            </thead>
            <tbody>
              {ELEMENT_ORDER.map((t: ElementType) => {
                const f = settings.indent[t];
                return (
                  <tr key={t}>
                    <td>{ELEMENT_META[t].label}</td>
                    <td>
                      {indentInput(t, 'left', '左缩进')}
                    </td>
                    <td>
                      {indentInput(t, 'right', '右缩进')}
                    </td>
                    <td>
                      <select value={f.align} onChange={(e) => updateIndent(t, { align: e.target.value as TextAlign })}>
                        <option value="left">左</option>
                        <option value="center">居中</option>
                        <option value="right">右</option>
                      </select>
                    </td>
                    <td>
                      {indentInput(t, 'spaceBefore', '前空行')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === 'revision' ? (
        <div>
          <p className="hint">修订稿用不同颜色标记，打印时整页会染上该稿的颜色。</p>
          <label className="checkbox">
            <input type="checkbox" checked={settings.revisionMode} onChange={(e) => update({ revisionMode: e.target.checked })} />
            启用修订模式
          </label>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 120 }}>稿别</th>
                <th style={{ width: 160 }}>颜色</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {revisions.map((r, i) => (
                <tr key={r.id}>
                  <td>
                    <input value={r.label} onChange={(e) => patchRev(i, { label: e.target.value })} />
                  </td>
                  <td>
                    <div className="rev-picker">
                      {REVISION_COLORS.map((c) => (
                        <button
                          key={c.color}
                          className={`rev-chip ${r.color === c.color ? 'is-active' : ''}`}
                          style={{ background: c.color }}
                          title={c.name}
                          onClick={() => patchRev(i, { color: c.color })}
                        />
                      ))}
                    </div>
                  </td>
                  <td>
                    <button
                      className="btn btn--danger"
                      onClick={() => updateRevisions(revisions.filter((x) => x.id !== r.id))}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            className="btn btn--ghost"
            onClick={() =>
              updateRevisions([
                ...revisions,
                { id: uid('rev'), label: String.fromCharCode(65 + revisions.length - 1), color: '#ffe08a' },
              ])
            }
          >
            + 新增稿别
          </button>
        </div>
      ) : null}

      {tab === 'appearance' ? (
        <div className="form">
          <div className="field">
            <label>界面模式</label>
            <div className="segmented appearance-theme-switch" role="group" aria-label="界面模式">
              <button className={appTheme === 'night' ? 'is-active' : ''} onClick={() => setAppTheme('night')}>夜间</button>
              <button className={appTheme === 'day' ? 'is-active' : ''} onClick={() => setAppTheme('day')}>日间</button>
            </div>
            <p className="hint">只影响本机外观，不会写入剧本文件。默认正文随主题切换：日间黑色，夜间白色。</p>
          </div>
          <div className="field">
            <label>写作字体颜色</label>
            <div className="rev-picker">
              <button className={`btn ${fontColor === DEFAULT_FONT_COLOR ? 'btn--primary' : 'btn--ghost'}`} aria-pressed={fontColor === DEFAULT_FONT_COLOR} onClick={() => setFontColor(DEFAULT_FONT_COLOR)}>
                随主题（默认）
              </button>
              {FONT_COLOR_PRESETS.map((c) => (
                <button
                  key={c.color}
                  className={`rev-chip ${fontColor.toLowerCase() === c.color ? 'is-active' : ''}`}
                  style={{ background: c.color }}
                  title={c.name}
                  onClick={() => setFontColor(c.color)}
                />
              ))}
            </div>
          </div>
          <div className="field">
            <label>自定义颜色</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                data-native-edit-history
                type="color"
                value={resolvedFontColor}
                onChange={(e) => setFontColor(e.target.value)}
                style={{ width: 56, height: 28, padding: 0, border: 'none', background: 'none' }}
              />
              <input
                data-native-edit-history
                value={resolvedFontColor}
                style={{ width: 110 }}
                onChange={(e) => {
                  if (isHexColor(e.target.value)) setFontColor(e.target.value);
                }}
              />
              <button className="btn btn--ghost" onClick={() => setFontColor(DEFAULT_FONT_COLOR)}>
                恢复默认
              </button>
            </div>
          </div>
          <div className="field">
            <label>预览</label>
            <div
              style={{
                color: resolvedFontColor,
                padding: '10px 12px',
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid var(--border)',
                borderRadius: 6,
              }}
            >
              内景 · 深夜的居酒屋 · 夜
            </div>
            <p className="hint">自选颜色保留在本机；恢复默认后重新随主题切换。A4 纯文本打印保持黑字，创作版 PDF 保留屏幕上的图文外观。</p>
          </div>
        </div>
      ) : null}

      {tab === 'general' ? (
        <div className="form">
          <label className="checkbox">
            <input type="checkbox" checked={settings.dualDialogue} onChange={(e) => update({ dualDialogue: e.target.checked })} />
            启用双列对白
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={settings.smartQuotes} onChange={(e) => update({ smartQuotes: e.target.checked })} />
            输入对白时自动将英文引号转为中文引号
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={settings.printNotes} onChange={(e) => update({ printNotes: e.target.checked })} />
            打印「备忘」元素
          </label>
        </div>
      ) : null}

      <footer className="modal__foot">
        <button className="btn btn--primary" onClick={onClose}>
          完成
        </button>
      </footer>
    </Modal>
  );

  function patchRev(i: number, patch: Partial<Revision>) {
    const list = revisions.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    updateRevisions(list);
  }
}
