export type SubtitleEdits = Record<number, string>;

const keyFor = (videoId: string): string => `ytdubfree.edits.${videoId}`;

interface StorageLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

function storage(): StorageLike | null {
  const area = (globalThis as { chrome?: { storage?: { local?: StorageLike } } }).chrome?.storage?.local;
  return area ?? null;
}

export async function loadEdits(videoId: string): Promise<SubtitleEdits> {
  const area = storage();
  if (!area) return {};
  try {
    const stored = await area.get(keyFor(videoId));
    const value = stored[keyFor(videoId)];
    if (!value || typeof value !== "object") return {};
    const result: SubtitleEdits = {};
    for (const [key, text] of Object.entries(value as Record<string, unknown>)) {
      const index = Number(key);
      if (Number.isInteger(index) && index >= 0 && typeof text === "string") result[index] = text;
    }
    return result;
  } catch {
    return {};
  }
}

export async function saveEdits(videoId: string, edits: SubtitleEdits): Promise<void> {
  const area = storage();
  if (!area) return;
  try {
    await area.set({ [keyFor(videoId)]: edits });
  } catch {
    // lưu lỗi không được chặn phát
  }
}

export async function clearEdits(videoId: string): Promise<void> {
  const area = storage();
  if (!area) return;
  try {
    await area.remove(keyFor(videoId));
  } catch {
    // bỏ qua
  }
}
