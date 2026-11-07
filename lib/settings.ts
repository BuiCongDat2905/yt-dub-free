export interface Settings {
  enabled: boolean;
  originalVolume: number;
  dubVolume: number;
}

export const SETTINGS_KEY = "ytdubfree.settings";

export const DEFAULT_SETTINGS: Settings = {
  enabled: false,
  originalVolume: 0.1,
  dubVolume: 1,
};

function clamp01(value: unknown, fallback: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(1, Math.max(0, numeric));
}

export function normalizeSettings(input: unknown): Settings {
  const raw = (input ?? {}) as Partial<Record<keyof Settings, unknown>>;
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_SETTINGS.enabled,
    originalVolume: clamp01(raw.originalVolume, DEFAULT_SETTINGS.originalVolume),
    dubVolume: clamp01(raw.dubVolume, DEFAULT_SETTINGS.dubVolume),
  };
}

interface StorageAreaLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

function storageArea(): StorageAreaLike | null {
  const chromeApi = (globalThis as { chrome?: { storage?: { sync?: StorageAreaLike } } }).chrome;
  return chromeApi?.storage?.sync ?? null;
}

export async function loadSettings(): Promise<Settings> {
  const area = storageArea();
  if (!area) return { ...DEFAULT_SETTINGS };
  try {
    const stored = await area.get(SETTINGS_KEY);
    return normalizeSettings(stored[SETTINGS_KEY]);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await loadSettings();
  const next = normalizeSettings({ ...current, ...patch });
  const area = storageArea();
  if (area) {
    try {
      await area.set({ [SETTINGS_KEY]: next });
    } catch {
      // bỏ qua: giữ giá trị trong bộ nhớ để phiên hiện tại vẫn dùng được
    }
  }
  return next;
}
