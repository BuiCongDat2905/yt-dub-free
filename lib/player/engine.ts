import type { Cue } from "../subtitle/types.ts";
import { PlaybackScheduler, type PlaybackDecision } from "./sync.ts";

export interface DubEngineOptions {
  video: HTMLVideoElement;
  audio: HTMLAudioElement;
  cues: Cue[];
  /** Audio đã tổng hợp cho từng cue; null nghĩa là câu đó do speechSynthesis đọc. */
  audioByIndex: Array<Uint8Array | null>;
  /** Âm lượng tiếng gốc khi đang lồng tiếng (0..1). */
  originalVolume?: number;
  tickMs?: number;
  onDecision?: (decision: PlaybackDecision) => void;
}

/**
 * Phát audio lồng tiếng bám theo video gốc.
 * Đồng hồ duy nhất là `video.currentTime`; audio chỉ là đầu ra, không phải nguồn thời gian.
 */
export class DubEngine {
  private readonly video: HTMLVideoElement;
  private readonly audio: HTMLAudioElement;
  private readonly cues: Cue[];
  private readonly audioByIndex: Array<Uint8Array | null>;
  private readonly originalVolume: number;
  private readonly tickMs: number;
  private readonly onDecision?: (decision: PlaybackDecision) => void;
  private readonly scheduler: PlaybackScheduler;
  private readonly objectUrls = new Map<number, string>();
  private previousVolume: number;
  private timer: number | null = null;
  private running = false;

  private readonly handlePlay = (): void => {
    if (this.scheduler.index >= 0) void this.audio.play().catch(() => {});
  };
  private readonly handlePause = (): void => {
    this.audio.pause();
  };
  private readonly handleSeeked = (): void => {
    this.tick();
  };
  private readonly handleRate = (): void => {
    this.audio.playbackRate = this.video.playbackRate;
  };

  constructor(options: DubEngineOptions) {
    this.video = options.video;
    this.audio = options.audio;
    this.cues = options.cues;
    this.audioByIndex = options.audioByIndex;
    this.originalVolume = Math.min(1, Math.max(0, options.originalVolume ?? 0.1));
    this.tickMs = Math.max(50, options.tickMs ?? 100);
    this.onDecision = options.onDecision;
    this.scheduler = new PlaybackScheduler(this.cues);
    this.previousVolume = this.video.volume;
  }

  get stats(): { index: number; resyncs: number; running: boolean } {
    return { index: this.scheduler.index, resyncs: this.scheduler.resyncCount, running: this.running };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.previousVolume = this.video.volume;
    this.video.volume = this.originalVolume;
    this.video.addEventListener("play", this.handlePlay);
    this.video.addEventListener("pause", this.handlePause);
    this.video.addEventListener("seeked", this.handleSeeked);
    this.video.addEventListener("ratechange", this.handleRate);
    this.timer = window.setInterval(() => this.tick(), this.tickMs);
    this.tick();
  }

  /** Đổi âm lượng tiếng gốc khi đang lồng tiếng (0..1). */
  setOriginalVolume(volume: number): void {
    const clamped = Math.min(1, Math.max(0, volume));
    if (this.running) this.video.volume = clamped;
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.video.removeEventListener("play", this.handlePlay);
    this.video.removeEventListener("pause", this.handlePause);
    this.video.removeEventListener("seeked", this.handleSeeked);
    this.video.removeEventListener("ratechange", this.handleRate);
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.video.volume = this.previousVolume;
    this.scheduler.reset();
  }

  destroy(): void {
    this.stop();
    for (const url of this.objectUrls.values()) URL.revokeObjectURL(url);
    this.objectUrls.clear();
  }

  private sourceFor(index: number): string | null {
    const cached = this.objectUrls.get(index);
    if (cached) return cached;
    const bytes = this.audioByIndex[index] ?? null;
    if (!bytes || bytes.length === 0) return null;
    const buffer = bytes.slice().buffer;
    const url = URL.createObjectURL(new Blob([buffer], { type: "audio/mpeg" }));
    this.objectUrls.set(index, url);
    return url;
  }

  private tick(): void {
    if (!this.running) return;

    const decision = this.scheduler.update(this.video.currentTime, this.audio.currentTime);
    this.onDecision?.(decision);

    if (decision.action === "stop") {
      this.audio.pause();
      return;
    }

    if (decision.action === "play") {
      const source = this.sourceFor(decision.index);
      if (!source) {
        this.audio.pause();
        return;
      }
      if (this.audio.src !== source) this.audio.src = source;
      this.audio.currentTime = decision.offset;
      this.audio.playbackRate = this.video.playbackRate;
      if (!this.video.paused) void this.audio.play().catch(() => {});
      return;
    }

    if (decision.action === "resync") {
      this.audio.currentTime = decision.offset;
      return;
    }

    if (this.audio.playbackRate !== this.video.playbackRate) {
      this.audio.playbackRate = this.video.playbackRate;
    }
  }
}
