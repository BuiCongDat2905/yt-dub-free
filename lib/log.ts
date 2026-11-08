export interface LogEntry {
  at: string;
  level: "error" | "warn" | "info";
  scope: string;
  message: string;
  detail?: string;
}

export const LOG_KEY = "ytdubfree.logs";
const MAX_ENTRIES = 80;

let entries: LogEntry[] | null = null;

interface StorageLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

function storage(): StorageLike | null {
  const area = (globalThis as { chrome?: { storage?: { local?: StorageLike } } }).chrome?.storage?.local;
  return area ?? null;
}

export async function loadLogs(): Promise<LogEntry[]> {
  if (entries) return entries;
  const area = storage();
  if (!area) return (entries = []);
  try {
    const stored = await area.get(LOG_KEY);
    const value = stored[LOG_KEY];
    entries = Array.isArray(value) ? (value as LogEntry[]) : [];
  } catch {
    entries = [];
  }
  return entries;
}

export async function logEvent(
  level: LogEntry["level"],
  scope: string,
  message: string,
  detail?: unknown,
): Promise<void> {
  const entry: LogEntry = {
    at: new Date().toISOString(),
    level,
    scope,
    message: message.slice(0, 500),
    detail:
      detail === undefined
        ? undefined
        : String(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 2000),
  };
  const current = await loadLogs();
  const next = [...current, entry].slice(-MAX_ENTRIES);
  entries = next;
  const area = storage();
  if (!area) return;
  try {
    await area.set({ [LOG_KEY]: next });
  } catch {
    // log lỗi không được làm hỏng luồng chính
  }
}

export async function clearLogs(): Promise<void> {
  entries = [];
  const area = storage();
  if (!area) return;
  try {
    await area.remove(LOG_KEY);
  } catch {
    // bỏ qua
  }
}

export function formatLogs(list: LogEntry[]): string {
  return JSON.stringify({ exportedAt: new Date().toISOString(), count: list.length, entries: list }, null, 2);
}
