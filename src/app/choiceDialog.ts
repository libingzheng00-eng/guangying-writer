/** Promise-based in-app choice dialog. Every option is named, so no button means
 * something different from what it says (unlike OK/Cancel in window.confirm). */
export interface ChoiceOption<T extends string = string> {
  value: T;
  label: string;
  tone?: 'primary' | 'danger';
}

export interface ChoiceRequest<T extends string = string> {
  title: string;
  message: string;
  warning?: string;
  options: ChoiceOption<T>[];
  /** Returned for Esc, backdrop click, close button, or when no host is mounted. */
  cancelValue: T;
}

type Host = (request: ChoiceRequest, resolve: (value: string) => void) => void;
let host: Host | null = null;

/** The mounted dialog host (App) or a test double registers here. */
export function setChoiceHost(next: Host | null) {
  host = next;
  return () => { if (host === next) host = null; };
}

export function askChoice<T extends string>(request: ChoiceRequest<T>): Promise<T> {
  // Without a host there is nobody to ask: choose the safe cancel value.
  if (!host) return Promise.resolve(request.cancelValue);
  const current = host;
  return new Promise<T>(resolve => current(request as ChoiceRequest, value => resolve(value as T)));
}
