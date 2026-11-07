import { audioCache } from "@/lib/cache/audioCache";
import { translationCache } from "@/lib/cache/idb";
import { ALLOWED_HOST, APP_NAME, BADGE_ID, PREFERRED_CAPTION_LANG, TARGET_LANG } from "@/lib/config";
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
import { GoogleTtsProvider } from "@/lib/tts/google";
import { SystemTtsProvider } from "@/lib/tts/system";
import { SubtitleOverlay } from "@/lib/ui/overlay";
import { fetchCuesForTrack, pickTrack } from "@/lib/youtube/captions";
import { getCaptionTracks } from "@/lib/youtube/innertube";
import { readTranscriptFromPage } from "@/lib/youtube/transcriptDom";

const HOST_STYLE = "position:fixed;right:16px;bottom:88px;z-index:2147483000;";
const CUE_TIMEOUT_MS = 25000;
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
  settings?: Settings;
  error?: string;
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
let currentVideo: string | null = null;
const overlay = new SubtitleOverlay();

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
  render();
}

function applyVolumes(): void {
  if (engine) engine.setOriginalVolume(settings.originalVolume);
  if (audioElement) audioElement.volume = settings.dubVolume;
}

function stopDubbing(): void {
  prefetch?.cancel();
  prefetch = null;
  engine?.destroy();
  engine = null;
  audioElement = null;
  overlay.destroy();
  new SystemTtsProvider().cancel();
}

function unmount(): void {
  stopDubbing();
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

async function loadCues(): Promise<{ cues: Cue[]; source: string }> {
  const failures: string[] = [];

  if (activeTrack) {
    try {
      return { cues: await fetchCuesForTrack(activeTrack), source: "timedtext" };
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  } else {
    failures.push("không có caption track");
  }

  try {
    return { cues: await readTranscriptFromPage(document, CUE_TIMEOUT_MS), source: "transcript-panel" };
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }

  throw new CaptionUnavailableError(failures.join(" | "));
}

async function startDubbing(videoId: string): Promise<void> {
  const video = findVideoElement();
  if (!video) {
    publishStatus({ videoId, error: "không tìm thấy thẻ video" });
    return;
  }

  busy = true;
  render();

  try {
    const { cues, source } = await loadCues();
    if (!enabled) return;

    const provider = new GoogleTtsProvider({ lang: TARGET_LANG });
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
      onDecision: (decision) => {
        if (decision.action === "stop" || decision.index < 0) {
          overlay.clear();
          return;
        }
        overlay.setText(prepared.cues[decision.index]?.text ?? "");
        prefetch?.ensureFrom(decision.index + 1);
      },
    });

    overlay.attach(video);
    engine.start();

    publishStatus({
      videoId,
      source,
      cues: prepared.stats.cues,
      segments: prepared.stats.cues,
      stats: prepared.stats,
    });
  } catch (error) {
    publishStatus({ videoId, error: error instanceof Error ? error.message : String(error) });
  } finally {
    busy = false;
    render();
  }
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
  // SPA đổi chất lượng/param vẫn cùng video: giữ nguyên phiên lồng tiếng đang chạy.
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
  const storage = (globalThis as { chrome?: { storage?: { onChanged?: { addListener(cb: (changes: Record<string, { newValue?: unknown }>, area: string) => void): void } } } }).chrome?.storage;
  storage?.onChanged?.addListener((changes, area) => {
    if (area !== "sync" || !changes[SETTINGS_KEY]) return;
    settings = normalizeSettings(changes[SETTINGS_KEY]?.newValue);
    applyVolumes();
    render();
  });
}

function watchCommands(): void {
  const runtime = (globalThis as { chrome?: { runtime?: { onMessage?: { addListener(cb: (message: unknown) => void): void } } } }).chrome?.runtime;
  runtime?.onMessage?.addListener((message) => {
    if ((message as { type?: string } | null)?.type === "ytdubfree:toggle") void onToggle();
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
