import { useEffect, useId, useMemo, useRef, useState } from 'react';
import '../styles/startup.css';

export interface StartupRecentItem {
  id: string;
  path: string;
  name: string;
  updatedAt: string | number;
  pinned?: boolean;
  missing?: boolean;
  needsAuthorization?: boolean;
}

export interface StartupPageProps {
  recentItems: readonly StartupRecentItem[];
  loading: boolean;
  busy: boolean;
  error: string | null;
  warning?: string | null;
  preference: 'home' | 'resume';
  onPreferenceChange: (preference: 'home' | 'resume') => void;
  onNew: () => void;
  onOpen: () => void;
  onOpenRecent: (id: string) => void;
  onRelocate: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onRemove: (id: string) => void;
  continueLabel?: string;
  onContinue?: () => void;
}

function timestamp(value: string | number): number {
  const time = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function openedTime(value: string | number): { text: string; iso?: string } {
  const date = new Date(typeof value === 'number' ? value : Date.parse(value));
  if (!Number.isFinite(date.getTime())) return { text: '时间未知' };
  return {
    text: date.toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }),
    iso: date.toISOString(),
  };
}

type IconName = 'new' | 'folder' | 'document' | 'search' | 'pin' | 'arrow';

function StartupIcon({ name }: { name: IconName }) {
  return <svg className="startup__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {name === 'new' ? <><path d="M12 5v14M5 12h14" /></> : null}
    {name === 'folder' ? <><path d="M3 8V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v2" /><path d="M5 20h14l3-9H6l-3 9V8" /></> : null}
    {name === 'document' ? <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></> : null}
    {name === 'search' ? <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></> : null}
    {name === 'pin' ? <><path d="m9 3 6 0-1 6 4 4v2H6v-2l4-4zM12 15v6" /></> : null}
    {name === 'arrow' ? <><path d="M4 12h15m-6-6 6 6-6 6" /></> : null}
  </svg>;
}

/** Presentation only: recent-file persistence and document recovery stay in the app layer. */
export function StartupPage({
  recentItems, loading, busy, error, warning, preference, onPreferenceChange,
  onNew, onOpen, onOpenRecent, onRelocate, onPin, onRemove, continueLabel, onContinue,
}: StartupPageProps) {
  const [query, setQuery] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const id = useId();
  const unavailable = loading || busy;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleItems = useMemo(() => recentItems
    .filter(item => !normalizedQuery || `${item.name}\n${item.path}`.toLocaleLowerCase().includes(normalizedQuery))
    .slice()
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || timestamp(b.updatedAt) - timestamp(a.updatedAt)),
  [recentItems, normalizedQuery]);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  const removeRecent = (itemId: string, index: number) => {
    // Move keyboard focus before this row can disappear. Removing a record does
    // not have a confirmation dialog and never requests deletion of a file.
    const entries = listRef.current?.querySelectorAll<HTMLButtonElement>('.startup__project-open');
    const next = entries?.[index + 1] || entries?.[index - 1];
    (next || searchRef.current)?.focus();
    onRemove(itemId);
  };

  return <main className="startup" aria-labelledby={`${id}-title`}>
    <div className="startup__inner">
      <header className="startup__header">
        <div className="startup__brand-mark"><StartupIcon name="document" /></div>
        <div>
          <h1 ref={headingRef} id={`${id}-title`} tabIndex={-1}>光影写手</h1>
          <p>开始新的剧本，或继续上次的写作。</p>
        </div>
      </header>

      {warning ? <div className="startup__notice startup__notice--warning" role="status">
        <strong>自动恢复提示</strong><span>{warning}</span>
      </div> : null}
      {error ? <div className="startup__notice startup__notice--error" role="alert">
        <strong>操作未完成</strong><span>{error}</span>
      </div> : null}

      <div className="startup__workspace">
        <aside className="startup__actions" aria-label="开始写作">
          {onContinue ? <section className="startup__continue" aria-labelledby={`${id}-continue-title`}>
            <h2 id={`${id}-continue-title`}>继续写作</h2>
            <p>{continueLabel || '回到当前剧本'}</p>
            <button type="button" className="startup__button startup__button--primary"
              disabled={unavailable} onClick={onContinue}>
              <span>继续写作</span><StartupIcon name="arrow" />
            </button>
          </section> : null}

          <div className="startup__file-actions">
            <button type="button" className="startup__action" disabled={unavailable} onClick={onNew}>
              <span className="startup__action-icon"><StartupIcon name="new" /></span>
              <span><strong>新建剧本</strong><small>从空白开始</small></span>
            </button>
            <button type="button" className="startup__action" disabled={unavailable} onClick={onOpen}>
              <span className="startup__action-icon"><StartupIcon name="folder" /></span>
              <span><strong>打开工程…</strong><small>选择本地工程文件</small></span>
            </button>
          </div>

          <fieldset className="startup__preference" disabled={unavailable}>
            <legend>启动时</legend>
            <label><input type="radio" name={`${id}-preference`} value="home" checked={preference === 'home'}
              onChange={() => onPreferenceChange('home')} /><span>显示启动页</span></label>
            <label><input type="radio" name={`${id}-preference`} value="resume" checked={preference === 'resume'}
              onChange={() => onPreferenceChange('resume')} /><span>继续上次写作</span></label>
          </fieldset>
        </aside>

        <section className="startup__recent" aria-labelledby={`${id}-recent-title`}>
          <div className="startup__recent-heading">
            <h2 id={`${id}-recent-title`}>最近项目</h2>
            <span className="startup__count" role="status">{loading ? '读取中…' : query.trim()
              ? `${visibleItems.length} / ${recentItems.length} 个项目` : `${recentItems.length} 个项目`}</span>
          </div>
          <div className="startup__search">
            <StartupIcon name="search" />
            <input ref={searchRef} type="search" value={query} aria-label="搜索最近项目的名称或路径"
              placeholder="搜索名称或路径" data-native-edit-history="true"
              onChange={event => setQuery(event.target.value)} />
            {query ? <button type="button" className="startup__clear" aria-label="清除搜索"
              onClick={() => { setQuery(''); searchRef.current?.focus(); }}>×</button> : null}
          </div>

          <div className="startup__recent-content" aria-busy={loading}>
            {loading ? <div className="startup__empty" role="status"><p>正在读取最近项目…</p></div>
              : !visibleItems.length ? <div className="startup__empty">
                <StartupIcon name={normalizedQuery ? 'search' : 'document'} />
                <h3>{normalizedQuery ? '没有找到匹配的项目' : '还没有最近项目'}</h3>
                <p>{normalizedQuery ? '试试其他名称或路径。' : '新建剧本，或打开已有工程后，会显示在这里。'}</p>
                {normalizedQuery ? <button type="button" className="startup__text-button"
                  onClick={() => { setQuery(''); searchRef.current?.focus(); }}>清除搜索</button> : null}
              </div> : <ul className="startup__list" ref={listRef}>
                {visibleItems.map((item, index) => {
                  const opened = openedTime(item.updatedAt);
                  const relocate = !!(item.missing || item.needsAuthorization);
                  return <li className="startup__project" key={item.id}>
                    <button type="button" className="startup__project-open" disabled={unavailable}
                      aria-label={`${relocate ? '重新定位' : '打开'}项目：${item.name}`}
                      title={item.path} onClick={() => relocate ? onRelocate(item.id) : onOpenRecent(item.id)}>
                      <span className="startup__project-title">
                        {item.pinned ? <span className="startup__pinned" title="已置顶"><StartupIcon name="pin" /><span className="startup__sr-only">已置顶：</span></span> : null}
                        <strong>{item.name || '未命名剧本'}</strong>
                      </span>
                      <span className="startup__path" dir="auto">{item.path}</span>
                      <span className="startup__metadata">
                        <span>上次打开 <time dateTime={opened.iso}>{opened.text}</time></span>
                        {relocate ? <span className="startup__file-status">{item.missing ? '文件已移动或不存在' : '需要重新授权'}</span> : null}
                      </span>
                    </button>
                    <div className="startup__project-actions" role="group" aria-label={`${item.name}的记录操作`}>
                      {relocate ? <button type="button" className="startup__text-button" disabled={unavailable}
                        onClick={() => onRelocate(item.id)}>重新定位…</button> : null}
                      <button type="button" className="startup__text-button" aria-pressed={!!item.pinned}
                        aria-label={`${item.pinned ? '取消置顶' : '置顶'}：${item.name}`} disabled={unavailable}
                        onClick={() => onPin(item.id, !item.pinned)}>{item.pinned ? '取消置顶' : '置顶'}</button>
                      <button type="button" className="startup__text-button startup__remove" disabled={unavailable}
                        title="仅从最近项目中移除，不会删除工程文件" aria-label={`仅移除记录：${item.name}，不会删除工程文件`}
                        onClick={() => removeRecent(item.id, index)}>移除记录</button>
                    </div>
                  </li>;
                })}
              </ul>}
          </div>
          <p className="startup__recent-note">移除记录只影响此列表，不会删除工程文件。</p>
        </section>
      </div>
      <div className="startup__busy" role="status" aria-live="polite">{busy ? '正在处理，请稍候…' : ''}</div>
    </div>
  </main>;
}
