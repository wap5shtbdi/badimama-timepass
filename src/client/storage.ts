// Things this device remembers (localStorage). Wrapped in try/catch: storage can be blocked.

const KEY = {
  token: 'bt.token',
  name: 'bt.name',
  lastTable: 'bt.lastTable',
  fourColor: 'bt.fourColor',
} as const;

function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function set(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode etc.: the session still works, it just won't be remembered.
  }
}

let memoryToken: string | null = null;

/** Secret that proves "this is the same player" after a reconnect. Never shown to others. */
export function deviceToken(): string {
  const saved = get(KEY.token) ?? memoryToken;
  if (saved) return saved;
  const token = crypto.randomUUID();
  memoryToken = token;
  set(KEY.token, token);
  return token;
}

export const savedName = () => get(KEY.name) ?? '';
export const saveName = (name: string) => set(KEY.name, name.trim());
export const lastTable = () => get(KEY.lastTable);
export const saveLastTable = (code: string) => set(KEY.lastTable, code);
export const fourColorDeck = () => get(KEY.fourColor) !== 'false';
export const saveFourColorDeck = (on: boolean) => set(KEY.fourColor, String(on));
