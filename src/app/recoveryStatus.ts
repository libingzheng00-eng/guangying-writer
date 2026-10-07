import { create } from 'zustand';

// UI-only state: never enters project, undo history, .zhsp or recovery payload.
export const useRecoveryStatus = create<{
  phase: 'idle' | 'pending' | 'saved' | 'error';
  lastSuccess: number | null;
  error: string | null;
}>(() => ({ phase: 'idle', lastSuccess: null, error: null }));
