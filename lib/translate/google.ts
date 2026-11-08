const ENDPOINT = "https://clients5.google.com/translate_a/t";
const MAX_QUERY_CHARS = 4000;

export interface TranslationCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export interface TranslateBatchOptions {
  targetLang?: string;
  sourceLang?: string;
  concurrency?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
  cache?: TranslationCache;
  signal?: AbortSignal;
}

export function buildTranslateUrl(text: string, targetLang: string, sourceLang = "auto"): string {
  const url = new URL(ENDPOINT);
  url.searchParams.set("client", "dict-chrome-ex");
  url.searchParams.set("sl", sourceLang);
  url.searchParams.set("tl", targetLang);
  url.searchParams.set("q", text);
  return url.toString();
}

/**
 * Hai định dạng đều được chấp nhận:
 * - `clients5` (client dict-chrome-ex): `[["câu dịch","en"], ...]`
 * - `googleapis` cũ: `[[["câu dịch","câu gốc",...],...],...]`
 */
export function parseGoogleResponse(payload: unknown): string {
  if (!Array.isArray(payload) || payload.length === 0) return "";

  const first = payload[0];
  if (typeof first === "string") return first.trim();

  if (Array.isArray(first) && typeof first[0] === "string") {
    return payload
      .map((item) => (Array.isArray(item) && typeof item[0] === "string" ? item[0] : ""))
      .join("")
      .trim();
  }

  const segments = first;
  if (Array.isArray(segments)) {
    return segments
      .map((segment) => (Array.isArray(segment) && typeof segment[0] === "string" ? segment[0] : ""))
      .join("")
      .trim();
  }
  return "";
}

export function splitForTranslation(text: string, maxChars = MAX_QUERY_CHARS): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > maxChars) {
    const slice = rest.slice(0, maxChars);
    const cut = Math.max(slice.lastIndexOf(" "), slice.lastIndexOf("."), slice.lastIndexOf(","));
    const end = cut > maxChars / 2 ? cut + 1 : maxChars;
    chunks.push(rest.slice(0, end));
    rest = rest.slice(end).trimStart();
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function translateOnce(
  text: string,
  options: Required<Pick<TranslateBatchOptions, "targetLang">> & TranslateBatchOptions,
): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sourceLang = options.sourceLang ?? "auto";
  const attempts = (options.retries ?? 2) + 1;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchImpl(buildTranslateUrl(text, options.targetLang, sourceLang), {
        headers: { accept: "application/json" },
        signal: options.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const translated = parseGoogleResponse(await response.json());
      if (translated === "") throw new Error("bản dịch rỗng");
      return translated;
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await sleep(300 * 2 ** attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Dịch danh sách câu, giữ đúng thứ tự, có cache và giới hạn song song. */
export async function translateBatch(
  texts: string[],
  options: TranslateBatchOptions = {},
): Promise<string[]> {
  const targetLang = options.targetLang ?? "vi";
  const concurrency = Math.max(1, options.concurrency ?? 3);
  const merged = { ...options, targetLang };
  const output = new Array<string>(texts.length);

  const translateOne = async (text: string, index: number): Promise<void> => {
    if (text.trim() === "") {
      output[index] = "";
      return;
    }
    const key = `${targetLang}|${text}`;
    if (options.cache) {
      const cached = await options.cache.get(key);
      if (cached !== null) {
        output[index] = cached;
        return;
      }
    }
    const translated = await translateOnce(text, merged);
    if (options.cache) await options.cache.set(key, translated);
    output[index] = translated;
  };

  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, texts.length)) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= texts.length) return;
      await translateOne(texts[index] ?? "", index);
    }
  });

  await Promise.all(workers);
  return output;
}
