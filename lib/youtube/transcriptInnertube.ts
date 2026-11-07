import type { Cue } from "../subtitle/types.ts";
import { CaptionUnavailableError } from "../subtitle/types.ts";
import { normalizeCues } from "../subtitle/parse.ts";

export interface TranscriptDiagnostic {
  source: string;
  ok: boolean;
  status?: number;
  bytes?: number;
  head?: string;
  cues?: number;
  error?: string;
}

interface InnertubeConfig {
  apiKey: string | null;
  clientVersion: string | null;
  visitorData: string | null;
}

interface SegmentLike {
  startMs?: number | string;
  endMs?: number | string;
  snippet?: { runs?: Array<{ text?: string }>; simpleText?: string };
}

const PAGE_HEADERS = {
  "accept-language": "en-US,en;q=0.9",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0",
};

function firstMatch(source: string, pattern: RegExp): string | null {
  const match = pattern.exec(source);
  return match?.[1] ?? null;
}

export function extractInnertubeConfig(source: string): InnertubeConfig {
  return {
    apiKey: firstMatch(source, /"INNERTUBE_API_KEY":"([^"]+)"/),
    clientVersion: firstMatch(source, /"INNERTUBE_CLIENT_VERSION":"([^"]+)"/),
    visitorData: firstMatch(source, /"VISITOR_DATA":"([^"]+)"/),
  };
}

/** params của getTranscriptEndpoint nằm trong ytInitialData của trang watch. */
export function extractTranscriptParams(source: string): string | null {
  return (
    firstMatch(source, /"getTranscriptEndpoint":\{"params":"([^"]+)"/) ??
    firstMatch(source, /"getTranscriptEndpoint":\s*\{\s*"params":\s*"([^"]+)"/)
  );
}

export function parseTranscriptSegments(payload: unknown): Cue[] {
  const cues: Cue[] = [];

  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    const record = node as Record<string, unknown>;
    const segment = record.transcriptSegmentRenderer as SegmentLike | undefined;
    if (segment) {
      const text = (segment.snippet?.runs?.map((run) => run.text ?? "").join("") ?? segment.snippet?.simpleText ?? "")
        .replace(/\s+/g, " ")
        .trim();
      const startMs = Number(segment.startMs ?? 0);
      const endMs = Number(segment.endMs ?? 0);
      if (text !== "") {
        cues.push({
          start: Number.isFinite(startMs) ? startMs / 1000 : 0,
          end: Number.isFinite(endMs) && endMs > startMs ? endMs / 1000 : (startMs + 800) / 1000,
          text,
        });
      }
    }
    for (const value of Object.values(record)) walk(value);
  };

  walk(payload);
  return normalizeCues(cues);
}

/** Gom text của mọi thẻ script trên trang để lấy ytcfg + params. */
export function collectPageSource(doc: Document = document): string {
  return Array.from(doc.querySelectorAll("script"))
    .map((script) => script.textContent ?? "")
    .join("\n");
}

/** Không ném lỗi: luôn trả diagnostic để hiển thị cho người dùng. */
export async function fetchTranscriptViaInnertube(options: {
  videoId: string;
  pageSource: string;
  fetchImpl?: typeof fetch;
}): Promise<{ cues: Cue[]; diagnostic: TranscriptDiagnostic }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const diagnostic: TranscriptDiagnostic = { source: "innertube-transcript", ok: false };
  const { apiKey, clientVersion, visitorData } = extractInnertubeConfig(options.pageSource);
  const params = extractTranscriptParams(options.pageSource);

  if (!params) {
    diagnostic.error = "không tìm thấy getTranscriptEndpoint.params";
    return { cues: [], diagnostic };
  }

  const context = {
    client: {
      clientName: "WEB",
      clientVersion: clientVersion ?? "2.20260101.00.00",
      hl: "en",
      gl: "US",
      originalUrl: `https://www.youtube.com/watch?v=${options.videoId}`,
      ...(visitorData ? { visitorData } : {}),
    },
    request: { useSsl: true },
  };

  const endpoint = new URL("https://www.youtube.com/youtubei/v1/get_transcript");
  if (apiKey) endpoint.searchParams.set("key", apiKey);
  endpoint.searchParams.set("prettyPrint", "false");

  let response: Response;
  try {
    response = await fetchImpl(endpoint.toString(), {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        "x-youtube-client-name": "1",
        ...(clientVersion ? { "x-youtube-client-version": clientVersion } : {}),
        ...(visitorData ? { "x-goog-visitor-id": visitorData } : {}),
      },
      body: JSON.stringify({ context, params }),
    });
  } catch (error) {
    diagnostic.error = `mạng: ${error instanceof Error ? error.message : String(error)}`;
    return { cues: [], diagnostic };
  }

  diagnostic.status = response.status;
  const text = await response.text();
  diagnostic.bytes = text.length;
  diagnostic.head = text.slice(0, 120);

  if (!response.ok) {
    diagnostic.error = `HTTP ${response.status}`;
    return { cues: [], diagnostic };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    diagnostic.error = "JSON không hợp lệ";
    return { cues: [], diagnostic };
  }

  const cues = parseTranscriptSegments(payload);
  diagnostic.cues = cues.length;
  if (cues.length === 0) {
    diagnostic.error = "không có transcriptSegmentRenderer";
    return { cues: [], diagnostic };
  }

  diagnostic.ok = true;
  return { cues, diagnostic };
}

/** Lấy HTML watch page khi content script không đọc được script nội trang. */
export async function fetchWatchPageSource(
  videoId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
    headers: PAGE_HEADERS,
    credentials: "include",
  });
  if (!response.ok) throw new CaptionUnavailableError(`tải trang video thất bại: HTTP ${response.status}`);
  return response.text();
}
