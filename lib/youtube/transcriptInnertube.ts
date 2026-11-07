import type { CaptionTrack, Cue } from "../subtitle/types.ts";
import { toCaptionTracks } from "./innertube.ts";
import { normalizeCues } from "../subtitle/parse.ts";

export interface TranscriptDiagnostic {
  source: string;
  ok: boolean;
  status?: number;
  bytes?: number;
  head?: string;
  cues?: number;
  error?: string;
  note?: string;
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

function safeDecode(value: string | null): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function extractInnertubeConfig(source: string): InnertubeConfig {
  return {
    apiKey: firstMatch(source, /"INNERTUBE_API_KEY":"([^"]+)"/),
    clientVersion: firstMatch(source, /"INNERTUBE_CLIENT_VERSION":"([^"]+)"/),
    visitorData: safeDecode(
      firstMatch(source, /"VISITOR_DATA":"([^"]+)"/) ?? firstMatch(source, /"visitorData":"([^"]+)"/),
    ),
  };
}

export function extractTranscriptParamsCandidates(source: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /"getTranscriptEndpoint":\{"params":"([^"]+)"/g,
    /"getTranscriptEndpoint":\s*\{\s*"params":\s*"([^"]+)"/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) found.add(match[1]);
    }
  }
  return [...found];
}

function decodeBase64Loose(value: string): string {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return atob(padded);
  } catch {
    return "";
  }
}

/** params phải chứa videoId; nhiều trang có nhiều endpoint của video khác trên sidebar. */
export function pickTranscriptParams(
  source: string,
  videoId: string,
): { params: string | null; candidates: number; matched: boolean } {
  const candidates = extractTranscriptParamsCandidates(source);
  for (const params of candidates) {
    if (decodeBase64Loose(params).includes(videoId)) {
      return { params, candidates: candidates.length, matched: true };
    }
  }
  return { params: candidates[0] ?? null, candidates: candidates.length, matched: false };
}

/** Tự dựng params tối thiểu (protobuf field 1 = videoId) khi trang không có endpoint. */
export function buildTranscriptParams(videoId: string): string {
  const idBytes = new TextEncoder().encode(videoId);
  const bytes = new Uint8Array(2 + idBytes.length);
  bytes[0] = 0x0a;
  bytes[1] = idBytes.length;
  bytes.set(idBytes, 2);
  return btoa(String.fromCharCode(...bytes));
}

export function extractTranscriptParams(source: string): string | null {
  return extractTranscriptParamsCandidates(source)[0] ?? null;
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

export function collectPageSource(doc: Document = document): string {
  return Array.from(doc.querySelectorAll("script"))
    .map((script) => script.textContent ?? "")
    .join("\n");
}

function buildContext(config: InnertubeConfig, videoId: string, clientName: string) {
  return {
    client: {
      clientName,
      clientVersion: config.clientVersion ?? "2.20260101.00.00",
      hl: "en",
      gl: "US",
      originalUrl: `https://www.youtube.com/watch?v=${videoId}`,
      ...(config.visitorData ? { visitorData: config.visitorData } : {}),
    },
    request: { useSsl: true },
  };
}

export async function fetchTranscriptViaInnertube(options: {
  videoId: string;
  pageSource: string;
  fetchImpl?: typeof fetch;
}): Promise<{ cues: Cue[]; diagnostic: TranscriptDiagnostic }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const diagnostic: TranscriptDiagnostic = { source: "innertube-transcript", ok: false };
  const config = extractInnertubeConfig(options.pageSource);
  const picked = pickTranscriptParams(options.pageSource, options.videoId);
  const params = picked.params ?? buildTranscriptParams(options.videoId);
  diagnostic.note = `candidates=${picked.candidates} matchedVideo=${picked.matched} visitor=${config.visitorData ? "yes" : "no"}`;

  const endpoint = new URL("https://www.youtube.com/youtubei/v1/get_transcript");
  if (config.apiKey) endpoint.searchParams.set("key", config.apiKey);
  endpoint.searchParams.set("prettyPrint", "false");

  let response: Response;
  try {
    response = await fetchImpl(endpoint.toString(), {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        "x-youtube-client-name": "1",
        ...(config.clientVersion ? { "x-youtube-client-version": config.clientVersion } : {}),
        ...(config.visitorData ? { "x-goog-visitor-id": config.visitorData } : {}),
      },
      body: JSON.stringify({
        context: buildContext(config, options.videoId, "WEB"),
        params,
        contentCheckOk: true,
        racyCheckOk: true,
      }),
    });
  } catch (error) {
    diagnostic.error = `mạng: ${error instanceof Error ? error.message : String(error)}`;
    return { cues: [], diagnostic };
  }

  diagnostic.status = response.status;
  const text = await response.text();
  diagnostic.bytes = text.length;
  diagnostic.head = text.slice(0, 160);

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

/** Thử cả client ANDROID và WEB để xin caption track (baseUrl có thể kèm pot). */
export async function fetchCaptionTracksViaPlayer(options: {
  videoId: string;
  pageSource: string;
  fetchImpl?: typeof fetch;
}): Promise<{ tracks: CaptionTrack[]; diagnostics: TranscriptDiagnostic[] }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const config = extractInnertubeConfig(options.pageSource);
  const diagnostics: TranscriptDiagnostic[] = [];
  const clients: Array<{
    label: string;
    client: Record<string, string | number>;
    headers: Record<string, string>;
    userAgent: string;
  }> = [
    {
      label: "player-android",
      client: { clientName: "ANDROID", clientVersion: "19.44.38", androidSdkVersion: 30 },
      headers: { "x-youtube-client-name": "3", "x-youtube-client-version": "19.44.38" },
      userAgent: "com.google.android.youtube/19.44.38 (Linux; U; Android 11) gzip",
    },
    {
      label: "player-web",
      client: { clientName: "WEB", clientVersion: config.clientVersion ?? "2.20260101.00.00" },
      headers: { "x-youtube-client-name": "1" },
      userAgent: PAGE_HEADERS["user-agent"],
    },
  ];

  for (const entry of clients) {
    const diagnostic: TranscriptDiagnostic = { source: entry.label, ok: false };
    const endpoint = new URL("https://www.youtube.com/youtubei/v1/player");
    if (config.apiKey) endpoint.searchParams.set("key", config.apiKey);
    endpoint.searchParams.set("prettyPrint", "false");

    let response: Response;
    try {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "user-agent": entry.userAgent,
        ...entry.headers,
      };
      if (config.visitorData) headers["x-goog-visitor-id"] = config.visitorData;

      response = await fetchImpl(endpoint.toString(), {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({
          context: { client: { ...entry.client, hl: "en", gl: "US", ...(config.visitorData ? { visitorData: config.visitorData } : {}) } },
          videoId: options.videoId,
          contentCheckOk: true,
          racyCheckOk: true,
        }),
      });
    } catch (error) {
      diagnostic.error = `mạng: ${error instanceof Error ? error.message : String(error)}`;
      diagnostics.push(diagnostic);
      continue;
    }

    diagnostic.status = response.status;
    const text = await response.text();
    diagnostic.bytes = text.length;
    diagnostic.head = text.slice(0, 160);

    if (!response.ok) {
      diagnostic.error = `HTTP ${response.status}`;
      diagnostics.push(diagnostic);
      continue;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      diagnostic.error = "JSON không hợp lệ";
      diagnostics.push(diagnostic);
      continue;
    }

    const tracks = toCaptionTracks(payload as Parameters<typeof toCaptionTracks>[0]);
    diagnostic.cues = tracks.length;
    if (tracks.length === 0) diagnostic.error = "không có captionTracks";
    else diagnostic.ok = true;
    diagnostics.push(diagnostic);
    if (tracks.length > 0) return { tracks, diagnostics };
  }

  return { tracks: [], diagnostics };
}

export async function fetchWatchPageSource(
  videoId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
    headers: PAGE_HEADERS,
    credentials: "include",
  });
  if (!response.ok) throw new Error(`tải trang video thất bại: HTTP ${response.status}`);
  return response.text();
}
