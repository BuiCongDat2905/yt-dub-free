import { TTS_MAX_CHARS } from "../config.ts";
import { TtsUnavailableError, concatBytes, type TtsProvider } from "./provider.ts";

const ENDPOINT = "https://translate.google.com/translate_tts";

export function buildTtsUrl(text: string, lang = "vi"): string {
  const url = new URL(ENDPOINT);
  url.searchParams.set("ie", "UTF-8");
  url.searchParams.set("client", "tw-ob");
  url.searchParams.set("tl", lang);
  url.searchParams.set("q", text);
  return url.toString();
}

/** Google TTS giới hạn ~200 ký tự mỗi request; cắt ở khoảng trắng để không gãy từ. */
export function splitForTts(text: string, maxChars = TTS_MAX_CHARS): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized === "") return [];
  if (normalized.length <= maxChars) return [normalized];

  const chunks: string[] = [];
  let rest = normalized;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    const cut = Math.max(window.lastIndexOf(" "), window.lastIndexOf(","), window.lastIndexOf("."));
    const end = cut > maxChars / 3 ? cut + 1 : maxChars;
    chunks.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trimStart();
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks.filter((chunk) => chunk.length > 0);
}

export class GoogleTtsProvider implements TtsProvider {
  readonly name = "google-tts";
  private readonly lang: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: { lang?: string; fetchImpl?: typeof fetch } = {}) {
    this.lang = options.lang ?? "vi";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async synthesize(text: string, signal?: AbortSignal): Promise<Uint8Array> {
    const chunks = splitForTts(text);
    if (chunks.length === 0) throw new TtsUnavailableError("câu rỗng, không có gì để đọc");

    const buffers: Uint8Array[] = [];
    for (const chunk of chunks) {
      const response = await this.fetchImpl(buildTtsUrl(chunk, this.lang), { signal });
      if (!response.ok) {
        throw new TtsUnavailableError(`Google TTS trả HTTP ${response.status}`, response.status);
      }
      const buffer = new Uint8Array(await response.arrayBuffer());
      if (buffer.length < 512) throw new TtsUnavailableError(`audio quá ngắn: ${buffer.length} byte`);
      buffers.push(buffer);
    }
    return concatBytes(buffers);
  }
}
