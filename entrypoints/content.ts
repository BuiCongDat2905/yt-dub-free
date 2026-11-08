import { audioCache } from "@/lib/cache/audioCache";
import { translationCache } from "@/lib/cache/idb";
import { ALLOWED_HOST, APP_NAME, BADGE_ID, PREFERRED_CAPTION_LANG, TARGET_LANG } from "@/lib/config";
import { loadEdits, saveEdits } from "@/lib/editor/store";
import { logEvent } from "@/lib/log";
import { DubEngine } from "@/lib/player/engine";
import { PrefetchController } from "@/lib/player/prefetch";
import { prepareDubbing } from "@/lib/pipeline";
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  loadSettings,
  normalizeSettings,
  type Settings,
} from "@/lib/settings";
import { CaptionUnavailableError, type CaptionTrack, type Cue } from "@/lib/subtitle/types";
import { translateBatch } from "@/lib/translate/google";
import { createBackgroundFetch } from "@/lib/tts/backgroundFetch";
import { GoogleTtsProvider } from "@/lib/tts/google";
import { PiperTtsProvider } from "@/lib/tts/piper";
import { PreferredTtsProvider } from "@/lib/tts/preferred";
import type { TtsProvider } from "@/lib/tts/provider";
import { SystemTtsProvider } from "@/lib/tts/system";
import { SubtitleEditorPanel, formatTime } from "@/lib/ui/editorPanel";
import { SubtitleOverlay } from "@/lib/ui/overlay";
import { fetchCuesForTrack, pickTrack } from "@/lib/youtube/captions";
import {
  armCapturedCaptions,
  fetchCapturedCaptions,
  getCaptionButtonState,
  restoreCaptionButtonState,
  triggerCaptionRequest,
} from "@/lib/youtube/capturedCaptions";
import { getCaptionTracks } from "@/lib/youtube/innertube";
import {
  cuesFromLines,
  startLiveCaptions,
  type LiveCaptionHandle,
  type LiveCaptionStats,
} from "@/lib/youtube/liveCaption";
import { readTranscriptFromPage } from "@/lib/youtube/transcriptDom";
import {
  collectPageSource,
  fetchCaptionTracksViaPlayer,
  fetchTranscriptViaInnertube,
  fetchWatchPageSource,
  type TranscriptDiagnostic,
} from "@/lib/youtube/transcriptInnertube";

const HOST_STYLE = "position:fixed;right:16px;bottom:88px;z-index:2147483000;";
const CUE_TIMEOUT_MS = 25000;
const PANEL_TIMEOUT_MS = 12000;
const LIVE_LAG_SECONDS = 1.2;
const FORCE_LIVE_MODE = false;
const SHADOW_HTML = `
  <style>
    :host { all: initial; }
    button {
      font: 600 12px/1.1 system-ui, -apple-system, "Segoe UI", sans-serif;
      color: #fff; background: #1f6feb; border: 0; border-radius: 999px;
      padding: 9px 14px; cursor: pointer; box-shadow: 0 2px 10px rgba(0,0,0,.35);
      display: flex; align-items: center; gap: 7px; white-space: nowrap;
    }
    button:hover { filter: brightness(1.1); }
    button[data-on="true"] { background: #2ea043; }
    button[data-busy="true"] { background: #9e6a03; }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: #fff; opacity: .55; }
    button[data-on="true"] .dot { opacity: 1; }
  </style>
  <button type="button" data-on="false" data-busy="false" part="button">
    <span class="dot"></span><span class="label">Dub: OFF</span>
  </button>
`;

interface CaptionStatus {
  videoId: string;
  tracks?: number;
  lang?: string | null;
  asr?: boolean;
  cues?: number;
  segments?: number;
  source?: string;
  stats?: Record<string, number>;
  live?: { lines: number; cuts?: number; skips?: number; tracker?: LiveCaptionStats; debug?: unknown };
  diagnostics?: TranscriptDiagnostic[];
  settings?: Settings;
  voice?: string;
  error?: string;
}

interface ActiveSession {
  videoId: string;
  cues: Cue[];
  translated: string[];
  audioByIndex: Array<Uint8Array | null>;
  provider: TtsProvider;
  engine: DubEngine;
}

let settings: Settings = { ...DEFAULT_SETTINGS };
let enabled = false;
let busy = false;
let host: HTMLElement | null = null;
let button: HTMLButtonElement | null = null;
let activeTrack: CaptionTrack | null = null;
let engine: DubEngine | null = null;
let audioElement: HTMLAudioElement | null = null;
let prefetch: PrefetchController | null = null;
let liveHandle: LiveCaptionHandle | null = null;
let liveTicker: number | null = null;
let currentVideo: string | null = null;
let session: ActiveSession | null = null;
let captionStateBefore: boolean | null = null;
const editorPanel = new SubtitleEditorPanel();
const overlay = new SubtitleOverlay();
const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

/** Piper offline (nữ) là mặc định; lỗi thì rơi về Google TTS (nữ). */
function createTtsProvider(): TtsProvider {
  const google = new GoogleTtsProvider({ lang: TARGET_LANG, fetchImpl: createBackgroundFetch() });
  if (settings.voiceEngine === "piper") {
    return new PreferredTtsProvider(new PiperTtsProvider(), google);
  }
  return google;
}

function publishStatus(status: CaptionStatus): void {
  document.documentElement.dataset.ytdubfree = JSON.stringify({ ...status, settings });
}

function currentVideoId(): string | null {
  if (location.pathname !== "/watch") return null;
  const id = new URLSearchParams(location.search).get("v");
  return id && id.length === 11 ? id : null;
}

function findVideoElement(): HTMLVideoElement | null {
  return (
    document.querySelector<HTMLVideoElement>("video.html5-main-video") ??
    document.querySelector<HTMLVideoElement>("video")
  );
}

function render(): void {
  if (!button) return;
  button.dataset.on = String(enabled);
  button.dataset.busy = String(busy);
  const label = button.querySelector(".label");
  if (label) {
    if (busy) label.textContent = "Đang chuẩn bị…";
    else label.textContent = enabled ? "Dub: ON" : "Dub: OFF";
  }
}

/** Ẩn badge khi vào fullscreen để không đè lên nút điều khiển. */
function updateBadgeVisibility(): void {
  if (!host) return;
  host.style.display = document.fullscreenElement ? "none" : "";
}

function mount(): void {
  if (host) return;
  host = document.createElement("div");
  host.id = BADGE_ID;
  host.style.cssText = HOST_STYLE;
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = SHADOW_HTML;

  button = root.querySelector("button");
  button?.addEventListener("click", (event) => {
    event.stopPropagation();
    event.preventDefault();
    void onToggle();
  });

  document.documentElement.appendChild(host);
  document.addEventListener("fullscreenchange", updateBadgeVisibility);
  document.addEventListener("webkitfullscreenchange", updateBadgeVisibility);
  updateBadgeVisibility();
  render();
}

function applyVolumes(): void {
  if (engine) engine.setOriginalVolume(settings.originalVolume);
  if (audioElement) audioElement.volume = settings.dubVolume;
}

/** Chỉ vẽ phụ đề khi người dùng bật trong popup. */
function showSubtitleText(text: string): void {
  if (!settings.showSubtitle || text.trim() === "") {
    overlay.clear();
    return;
  }
  overlay.setText(text);
}

function stopDubbing(): void {
  if (liveTicker !== null) {
    window.clearInterval(liveTicker);
    liveTicker = null;
  }
  liveHandle?.stop();
  liveHandle = null;
  prefetch?.cancel();
  prefetch = null;
  engine?.destroy();
  engine = null;
  audioElement = null;
  session = null;
  editorPanel.close();
  restoreCaptionButtonState(captionStateBefore);
  captionStateBefore = null;
  overlay.destroy();
  new SystemTtsProvider().cancel();
}

function unmount(): void {
  stopDubbing();
  document.removeEventListener("fullscreenchange", updateBadgeVisibility);
  document.removeEventListener("webkitfullscreenchange", updateBadgeVisibility);
  host?.remove();
  host = null;
  button = null;
  activeTrack = null;
  enabled = false;
  busy = false;
}

async function loadCaptionTracks(videoId: string): Promise<void> {
  try {
    const tracks = await getCaptionTracks(videoId, { document });
    activeTrack = pickTrack(tracks, PREFERRED_CAPTION_LANG) ?? null;
    publishStatus({
      videoId,
      tracks: tracks.length,
      lang: activeTrack?.languageCode ?? null,
      asr: activeTrack?.kind === "asr",
    });
  } catch (error) {
    activeTrack = null;
    publishStatus({
      videoId,
      error: error instanceof CaptionUnavailableError ? error.message : String(error),
    });
  }
}

async function loadCues(
  videoId: string,
): Promise<{ cues: Cue[]; source: string; diagnostics: TranscriptDiagnostic[] }> {
  const diagnostics: TranscriptDiagnostic[] = [];
  const pageSource = collectPageSource(document);
  const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

  const tryTrack = async (
    track: CaptionTrack | null | undefined,
    label: string,
  ): Promise<Cue[] | null> => {
    if (!track) return null;
    try {
      const cues = await fetchCuesForTrack(track);
      diagnostics.push({ source: label, ok: true, cues: cues.length });
      return cues;
    } catch (error) {
      diagnostics.push({ source: label, ok: false, error: message(error) });
      return null;
    }
  };

  const fromPageTrack = await tryTrack(activeTrack, "timedtext");
  if (fromPageTrack) return { cues: fromPageTrack, source: "timedtext", diagnostics };
  if (!activeTrack) diagnostics.push({ source: "timedtext", ok: false, error: "không có caption track" });

  // Cách của extension gốc: lấy URL timedtext do chính trang gọi (có token hợp lệ).
  try {
    const captured = await fetchCapturedCaptions(videoId, 5000);
    if (captured) {
      diagnostics.push({
        source: "page-timedtext",
        ok: true,
        cues: captured.cues.length,
        bytes: captured.bytes,
        note: captured.fromFormat,
      });
      return { cues: captured.cues, source: "page-timedtext", diagnostics };
    }
    diagnostics.push({ source: "page-timedtext", ok: false, error: "chưa bắt được request timedtext của trang" });
  } catch (error) {
    diagnostics.push({ source: "page-timedtext", ok: false, error: message(error) });
  }

  try {
    const cues = await readTranscriptFromPage(document, PANEL_TIMEOUT_MS);
    diagnostics.push({ source: "transcript-panel", ok: true, cues: cues.length });
    return { cues, source: "transcript-panel", diagnostics };
  } catch (error) {
    diagnostics.push({ source: "transcript-panel", ok: false, error: message(error) });
  }

  const fromPageTranscript = await fetchTranscriptViaInnertube({ videoId, pageSource });
  diagnostics.push(fromPageTranscript.diagnostic);
  if (fromPageTranscript.cues.length > 0) {
    return { cues: fromPageTranscript.cues, source: "innertube-transcript", diagnostics };
  }

  let htmlSource = "";
  try {
    htmlSource = await fetchWatchPageSource(videoId);
  } catch (error) {
    diagnostics.push({ source: "html", ok: false, error: message(error) });
  }
  if (htmlSource !== "") {
    const fromHtml = await fetchTranscriptViaInnertube({ videoId, pageSource: htmlSource });
    diagnostics.push({ ...fromHtml.diagnostic, source: "innertube-transcript-html" });
    if (fromHtml.cues.length > 0) {
      return { cues: fromHtml.cues, source: "innertube-transcript-html", diagnostics };
    }
  }

  const player = await fetchCaptionTracksViaPlayer({
    videoId,
    pageSource: htmlSource || pageSource,
    fetchImpl: fetch,
  });
  diagnostics.push(...player.diagnostics);
  for (const track of player.tracks.slice(0, 4)) {
    const label = `timedtext-player:${track.languageCode}${track.kind === "asr" ? "/asr" : ""}`;
    const cues = await tryTrack(track, label);
    if (cues) return { cues, source: "timedtext-player", diagnostics };
  }

  return { cues: [], source: "", diagnostics };
}

/** Dự phòng cuối: đọc phụ đề đang hiện trên player, dịch + TTS ngay khi câu xuất hiện. */
async function startLiveMode(
  video: HTMLVideoElement,
  videoId: string,
  diagnostics: TranscriptDiagnostic[],
): Promise<void> {
  const provider = createTtsProvider();
  const liveCues: Cue[] = [];
  const liveAudio: Array<Uint8Array | null> = [];
  const translated: string[] = [];

  const publish = (): void => {
    publishStatus({
      videoId,
      source: "live-captions",
      live: {
        lines: liveCues.length,
        cuts: engine?.stats.cuts ?? 0,
        skips: engine?.queueStats.skips ?? 0,
        tracker: liveHandle?.stats(),
        debug: engine?.debug,
      },
      diagnostics,
      stats: {
        cues: liveCues.length,
        translated: translated.filter((text) => text !== "").length,
        audio: liveAudio.filter((audio) => audio !== null).length,
        system: 0,
        failed: 0,
      },
    });
  };

  audioElement = new Audio();
  audioElement.preload = "auto";
  audioElement.volume = settings.dubVolume;

  engine = new DubEngine({
    video,
    audio: audioElement,
    cues: liveCues,
    audioByIndex: liveAudio,
    originalVolume: settings.originalVolume,
    queueMode: true,
    fitToCue: false,
    onDecision: (decision) => {
      if (decision.action === "stop" || decision.index < 0) {
        overlay.clear();
        return;
      }
      showSubtitleText(translated[decision.index] || liveCues[decision.index]?.text || "");
    },
  });

  overlay.attach(video);
  engine.start();

  liveHandle = startLiveCaptions(video, (line) => {
    const cue = cuesFromLines([line], LIVE_LAG_SECONDS)[0];
    if (!cue) return;
    const index = liveCues.length;
    liveCues.push(cue);
    liveAudio.push(null);
    translated.push("");
    publish();

    void (async () => {
      try {
        const [vietnamese] = await translateBatch([line.text], {
          targetLang: TARGET_LANG,
          fetchImpl: fetch,
        });
        const text = vietnamese || line.text;
        translated[index] = text;
        const audio = await provider.synthesize(text);
        liveAudio[index] = audio;
        await audioCache.set(`${TARGET_LANG}|${text}`, audio);
      } catch {
        // engine sẽ phát im lặng cho câu này
      } finally {
        publish();
      }
    })();
  });

  liveTicker = window.setInterval(() => publish(), 1000);
  publish();
}

async function startDubbing(videoId: string): Promise<void> {
  const video = findVideoElement();
  if (!video) {
    publishStatus({ videoId, error: "không tìm thấy thẻ video" });
    return;
  }

  busy = true;
  render();
  let diagnostics: TranscriptDiagnostic[] = [];

  try {
    // Bật CC + ép trang gọi timedtext; hook MAIN world bắt URL đó.
    // Ghi nhớ trạng thái CC trước khi can thiệp để trả lại đúng như người dùng đặt.
    armCapturedCaptions();
    captionStateBefore = getCaptionButtonState(document);
    await triggerCaptionRequest(document);
    await sleep(400);
    const loaded = await loadCues(videoId);
    diagnostics = loaded.diagnostics;
    if (loaded.cues.length > 0) restoreCaptionButtonState(captionStateBefore);
    if (FORCE_LIVE_MODE || loaded.cues.length === 0) {
      await startLiveMode(video, videoId, diagnostics);
      return;
    }
    const { cues, source } = loaded;
    if (!enabled) return;

    const provider = createTtsProvider();
    const prepared = await prepareDubbing({
      cues,
      provider,
      fallback: new SystemTtsProvider({ lang: "vi-VN" }),
      translationCache,
      audioCache,
      targetLang: TARGET_LANG,
      fetchImpl: fetch,
    });
    if (!enabled) return;

    // Áp dụng bản dịch đã sửa tay từ lần trước (nếu có).
    const savedEdits = await loadEdits(videoId);
    for (const [key, text] of Object.entries(savedEdits)) {
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0 || index >= prepared.cues.length) continue;
      prepared.translated[index] = text;
      prepared.audioByIndex[index] = null;
    }

    audioElement = new Audio();
    audioElement.preload = "auto";
    audioElement.volume = settings.dubVolume;

    prefetch = new PrefetchController({
      cues: prepared.cues,
      texts: prepared.translated,
      audioByIndex: prepared.audioByIndex,
      lookahead: 4,
      synthesize: async (text) => {
        const audio = await provider.synthesize(text);
        await audioCache.set(`${TARGET_LANG}|${text}`, audio);
        return audio;
      },
    });

    engine = new DubEngine({
      video,
      audio: audioElement,
      cues: prepared.cues,
      audioByIndex: prepared.audioByIndex,
      originalVolume: settings.originalVolume,
      holdMs: 4000,
      onDecision: (decision) => {
        if (decision.action === "stop" || decision.index < 0) {
          overlay.clear();
          return;
        }
        showSubtitleText(prepared.cues[decision.index]?.text ?? "");
        prefetch?.ensureFrom(decision.index + 1);
      },
    });

    overlay.attach(video);
    engine.start();

    session = {
      videoId,
      cues: prepared.cues,
      translated: prepared.translated,
      audioByIndex: prepared.audioByIndex,
      provider,
      engine,
    };

    publishStatus({
      videoId,
      source,
      cues: prepared.stats.cues,
      segments: prepared.stats.cues,
      stats: prepared.stats,
      diagnostics,
      voice: provider.name,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logEvent("error", "startDubbing", message, { diagnostics });
    publishStatus({
      videoId,
      diagnostics,
      error: message,
    });
  } finally {
    busy = false;
    render();
  }
}

function openEditor(): void {
  if (!session) return;
  const active = session;
  editorPanel.open({
    title: `Sửa bản dịch · ${active.cues.length} câu`,
    rows: active.cues.map((cue, index) => ({
      index,
      time: formatTime(cue.start),
      source: cue.text,
      text: active.translated[index] ?? "",
    })),
    onApply: applyEditorChanges,
  });
}

async function applyEditorChanges(changes: Record<number, string>): Promise<void> {
  const active = session;
  if (!active) return;

  const saved = await loadEdits(active.videoId);
  const failed: number[] = [];
  for (const [key, rawValue] of Object.entries(changes)) {
    const index = Number(key);
    const text = rawValue.trim();
    if (!Number.isInteger(index) || index < 0 || index >= active.cues.length || text === "") continue;
    active.translated[index] = text;
    active.audioByIndex[index] = null;
    active.engine.invalidate(index);
    saved[index] = text;
    try {
      const audio = await active.provider.synthesize(text);
      active.audioByIndex[index] = audio;
      await audioCache.set(`${TARGET_LANG}|${text}`, audio);
    } catch (error) {
      failed.push(index);
      await logEvent("warn", "editor", `tổng hợp lại câu ${index} thất bại`, error);
    }
  }
  await saveEdits(active.videoId, saved);
  if (failed.length > 0) throw new Error(`đã lưu, ${failed.length} câu chưa có audio`);
}

async function onToggle(): Promise<void> {
  const videoId = currentVideoId();
  enabled = !enabled;
  render();
  console.info(`[${APP_NAME}] toggle=${enabled} video=${videoId ?? "(none)"}`);

  if (!enabled || !videoId) {
    stopDubbing();
    return;
  }
  await startDubbing(videoId);
}

function sync(): void {
  const videoId = currentVideoId();
  if (!videoId) {
    currentVideo = null;
    unmount();
    delete document.documentElement.dataset.ytdubfree;
    return;
  }
  if (videoId === currentVideo && enabled) {
    render();
    return;
  }
  if (currentVideo !== null && currentVideo !== videoId) stopDubbing();
  currentVideo = videoId;
  mount();
  render();
  void loadCaptionTracks(videoId);
}

function watchSettings(): void {
  const storage = (
    globalThis as {
      chrome?: {
        storage?: {
          onChanged?: {
            addListener(cb: (changes: Record<string, { newValue?: unknown }>, area: string) => void): void;
          };
        };
      };
    }
  ).chrome?.storage;
  storage?.onChanged?.addListener((changes, area) => {
    if (area !== "sync" || !changes[SETTINGS_KEY]) return;
    settings = normalizeSettings(changes[SETTINGS_KEY]?.newValue);
    applyVolumes();
    if (!settings.showSubtitle) overlay.clear();
    render();
  });
}

function watchCommands(): void {
  const runtime = (
    globalThis as {
      chrome?: { runtime?: { onMessage?: { addListener(cb: (message: unknown) => void): void } } };
    }
  ).chrome?.runtime;
  runtime?.onMessage?.addListener((message) => {
    const type = (message as { type?: string } | null)?.type;
    if (type === "ytdubfree:toggle") void onToggle();
    if (type === "ytdubfree:open-editor") openEditor();
  });

  window.addEventListener("keydown", (event) => {
    if (!event.altKey || event.key.toLowerCase() !== "d") return;
    if (event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    void onToggle();
  });
}

async function init(): Promise<void> {
  settings = await loadSettings();
  watchSettings();

  if (location.hostname !== ALLOWED_HOST) return;

  sync();
  watchCommands();
  window.addEventListener("error", (event) => {
    void logEvent("error", "window", event.message, event.filename ? `${event.filename}:${event.lineno}` : undefined);
  });
  window.addEventListener("unhandledrejection", (event) => {
    void logEvent("error", "promise", String(event.reason instanceof Error ? event.reason.message : event.reason));
  });
  document.addEventListener("visibilitychange", () => prefetch?.setPaused(document.hidden));
  document.addEventListener("yt-navigate-finish", () => sync());
  window.addEventListener("popstate", () => sync());

  if (settings.enabled) {
    window.setTimeout(() => {
      if (!enabled && currentVideoId()) void onToggle();
    }, 800);
  }
}

export default defineContentScript({
  matches: ["*://www.youtube.com/*"],
  runAt: "document_idle",
  main() {
    void init();
  },
});
