import { useState } from 'react';

const PROGRESS_COLLAPSED_KEY = 'guangying:progress-collapsed';

/** 进度栏可像侧栏一样收起；只是本机界面偏好，不写入工程。 */
export function useProgressCollapsed(): [boolean, (collapsed: boolean) => void] {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(PROGRESS_COLLAPSED_KEY) === '1'; } catch { return false; }
  });
  const toggle = (next: boolean) => {
    setCollapsed(next);
    try { localStorage.setItem(PROGRESS_COLLAPSED_KEY, next ? '1' : '0'); } catch { /* 偏好未保存不影响写作 */ }
  };
  return [collapsed, toggle];
}
