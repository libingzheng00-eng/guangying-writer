import React, { useState } from 'react';
import { useStore } from '../store/store';
import { ELEMENT_META, ELEMENT_ORDER, FONT_PRESETS, REVISION_COLORS } from '../model/elements';
import type { ElementType, Revision, TextAlign } from '../model/types';
import { uid } from '../utils/id';
import { DEFAULT_FONT_COLOR } from '../store/store';
import { hexToRgba, isHexColor } from '../utils/color';

/** 写作字体颜色预设（第一个为默认荧光黄） */
const FONT_COLOR_PRESETS = [
  { name: '荧光黄（默认）', color: '#e9ff3a' },
  { name: '纯白', color: '#ffffff' },
  { name: '暖白', color: '#ffe9c4' },
  { name: '青蓝', color: '#8fd3ff' },
  { name: '薄荷', color: '#a8ffcf' },
  { name: '樱粉', color: '#ffb3d1' },
  { name: '浅灰', color: '#c9d1d9' },
];

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className={`modal ${wide ? 'modal--wide' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal__head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  );
}

export function TitlePageDialog({ onClose }: { onClose: () => void }) {
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
    <Modal title="标题页" onClose={onClose}>
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
              <input value={tp[r.key] as string} onChange={(e) => update({ [r.key]: e.target.value })} />
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

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.project.settings);
  const revisions = useStore((s) => s.project.revisions);
  const update = useStore((s) => s.updateSettings);
  const updateIndent = useStore((s) => s.updateIndent);
  const updateRevisions = useStore((s) => s.updateRevisions);
  const fontColor = useStore((s) => s.fontColor);
  const setFontColor = useStore((s) => s.setFontColor);
  const appTheme = useStore((s) => s.appTheme);
  const setAppTheme = useStore((s) => s.setAppTheme);
  const [tab, setTab] = useState<'page' | 'indent' | 'revision' | 'appearance' | 'general'>('page');

  const num = (v: string, fallback = 0) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  };

  return (
    <Modal title="显示简介设置" onClose={onClose} wide>
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
          <button key={k} className={tab === k ? 'is-active' : ''} onClick={() => setTab(k)}>
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
            <input type="number" value={settings.fontSize} onChange={(e) => update({ fontSize: num(e.target.value, 12) })} />
          </div>
          <div className="field">
            <label>行距（倍）</label>
            <input type="number" step="0.05" value={settings.lineHeight} onChange={(e) => update({ lineHeight: num(e.target.value, 1.6) })} />
          </div>
          <div className="field">
            <label>纸张</label>
            <select value={settings.paper} onChange={(e) => update({ paper: e.target.value as 'A4' | 'letter' })}>
              <option value="A4">A4</option>
              <option value="letter">Letter</option>
            </select>
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
              <input type="number" step="0.1" value={settings[k]} onChange={(e) => update({ [k]: num(e.target.value, 2.5) })} />
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
            <input type="number" value={settings.startPageAt} onChange={(e) => update({ startPageAt: Math.max(1, num(e.target.value, 1)) })} />
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
            <input type="number" value={settings.wordsPerMinute} onChange={(e) => update({ wordsPerMinute: Math.max(50, num(e.target.value, 220)) })} />
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
                      <input
                        type="number"
                        value={f.left}
                        onChange={(e) => updateIndent(t, { left: num(e.target.value, 0) })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={f.right}
                        onChange={(e) => updateIndent(t, { right: num(e.target.value, 0) })}
                      />
                    </td>
                    <td>
                      <select value={f.align} onChange={(e) => updateIndent(t, { align: e.target.value as TextAlign })}>
                        <option value="left">左</option>
                        <option value="center">居中</option>
                        <option value="right">右</option>
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        value={f.spaceBefore}
                        onChange={(e) => updateIndent(t, { spaceBefore: num(e.target.value, 0) })}
                      />
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
            <p className="hint">只影响本机界面外观，不会写入剧本文件，也不会影响导出。</p>
          </div>
          <div className="field">
            <label>写作字体颜色</label>
            <div className="rev-picker">
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
                type="color"
                value={fontColor}
                onChange={(e) => setFontColor(e.target.value)}
                style={{ width: 56, height: 28, padding: 0, border: 'none', background: 'none' }}
              />
              <input
                value={fontColor}
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
                color: fontColor,
                textShadow: `0 0 6px ${hexToRgba(fontColor, 0.4)}, 0 0 14px ${hexToRgba(fontColor, 0.18)}`,
                padding: '10px 12px',
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid var(--border)',
                borderRadius: 6,
              }}
            >
              内景 · 深夜的居酒屋 · 夜
            </div>
            <p className="hint">只影响写作视图的正文颜色；导出的 PDF / 打印始终保持黑字，不受此设置影响。</p>
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
