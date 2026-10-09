export type StartupPreference = 'home' | 'resume';
export const STARTUP_PREFERENCE_KEY = 'guangying:startup-preference';

/** This setting controls the landing screen, never file access or draft validity. */
export function readStartupPreference(): StartupPreference {
  try { return window.localStorage.getItem(STARTUP_PREFERENCE_KEY) === 'resume' ? 'resume' : 'home'; }
  catch { return 'home'; }
}

export function writeStartupPreference(preference: StartupPreference): boolean {
  try {
    window.localStorage.setItem(STARTUP_PREFERENCE_KEY, preference);
    return window.localStorage.getItem(STARTUP_PREFERENCE_KEY) === preference;
  } catch { return false; }
}
