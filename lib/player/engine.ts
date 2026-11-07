import type { Cue } from "../subtitle/types.ts";
import { PlaybackScheduler, type PlaybackDecision } from "./sync.ts";

export interface DubEngineOptions {
  video: HTMLVideoElement;
  audio: HTMLAudioElement;
  cues: Cue[];
  /** Audio đã tổng hợp cho từng cue; null nghĩa là chưa có. */
  audioByIndex: Array<Uint8Array | null>;
  /** Âm lượng tiếng gốc khi đang lồng tiếng (0..1). */
  originalVolume?: number;
  tickMs?: number;
  /** Chờ tối đa (ms) cho câu đang nói xong trước khi cắt sang câu mới. */
  holdMs?: number;
  /** Tăng tốc audio cho vừa khung thời gian của cue. */
  fitToCue?: boolean;
  onDecision?: (decision: PlaybackDecision) => void;
}

/** Tốc độ phát để audio vừa khung cue; tối đa 1.6x. */
export function computeFitRate(audioDuration: number, windowSeconds: number): number {
  if (!Number.isFinite(audioDuration) || audioDuration <= 0) return 1;
  const window = Math.max(0.8, windowSeconds);
  const rate = audioDuration / window;
  if (!Number.isFinite(rate)) return 1;
  return Math.min(1.6, Math.max(1, rate));
}

/**
 * Phát audio lồng tiếng bám theo video gốc.
 * Đồng hồ duy nhất là `video.currentTime`. Câu đang nói không bị cắt giữa từ:
 * engine chờ nói xong (tối đa `holdMs`) rồi mới chuyển câu, trừ khi quá trễ.
 */
export class DubEngine {
  private readonly video: HTMLVideoElement;
  private readonly audio: HTMLAudioElement;
  private readonly cues: Cue[];
  private readonly audioByIndex: Array<Uint8Array | null>;
  private readonly originalVolume: number;
  private readonly tickMs: number;
  private readonly holdMs: number;
  private readonly fitToCue: boolean;
  private readonly onDecision?: (decision: PlaybackDecision) => void;
  private readonly scheduler: PlaybackScheduler;
  private readonly objectUrls = new Map<number, string>();
  private pending: { index: number; offset: number; due: number } | null = null;
  private previousVolume: number;
  private timer: number | null = null;
  private running = false;
  private cuts = 0;

  private readonly handlePlay = (): void => {
    if (this.scheduler.index >= 0) void this.audio.play().catch(() => {});
  };
  private readonly handlePause = (): void => {
    this.audio.pause();
    this.pending = null;
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
    this.holdMs = Math.max(0, options.holdMs ?? 1500);
    this.fitToCue = options.fitToCue ?? true;
    this.onDecision = options.onDecision;
    this.scheduler = new PlaybackScheduler(this.cues);
    this.previousVolume = this.video.volume;
  }

  get stats(): { index: number; resyncs: number; running: boolean; cuts: number } {
    return {
      index: this.scheduler.index,
      resyncs: this.scheduler.resyncCount,
      running: this.running,
      cuts: this.cuts,
    };
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
    this.pending = null;
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

  private isSpeaking(): boolean {
    return !this.audio.paused && !this.audio.ended && this.audio.currentTime > 0;
  }

  private cueWindow(index: number, offset: number): number {
    const cue = this.cues[index];
    if (!cue) return 2;
    return Math.max(0.8, cue.end - Math.max(cue.start, cue.start + offset));
  }

  private startCue(index: number, offset: number): void {
    const source = this.sourceFor(index);
    if (!source) {
      this.audio.pause();
      return;
    }
    if (this.audio.src !== source) this.audio.src = source;
    this.audio.currentTime = offset;
    const baseRate = this.fitToCue ? computeFitRate(this.audio.duration, this.cueWindow(index, offset)) : 1;
    this.audio.playbackRate = baseRate * this.video.playbackRate;
    if (!this.video.paused) void this.audio.play().catch(() => {});
  }

  private tick(): void {
    if (!this.running) return;

    const decision = this.scheduler.update(this.video.currentTime, this.audio.currentTime);
    this.onDecision?.(decision);

    if (decision.action === "stop") {
      this.pending = null;
      if (!this.audio.paused) this.audio.pause();
      return;
    }

    if (decision.action === "play") {
      if (this.isSpeaking()) {
        if (!this.pending) {
          this.pending = { index: decision.index, offset: decision.offset, due: performance.now() + this.holdMs };
          return;
        }
        if (performance.now() < this.pending.due) return;
        // quá trễ: đành cắt câu đang nói để bám video
        this.cuts += 1;
        this.pending = null;
        this.startCue(decision.index, decision.offset);
        return;
      }
      this.pending = null;
      this.startCue(decision.index, decision.offset);
      return;
    }

    if (decision.action === "resync") {
      if (!this.isSpeaking()) this.audio.currentTime = decision.offset;
    }

    if (this.pending && !this.isSpeaking()) {
      const target = this.pending;
      this.pending = null;
      this.startCue(target.index, target.offset);
      return;
    }

    if (!this.video.paused && this.audio.paused) {
      const source = this.sourceFor(decision.index);
      if (source) {
        if (this.audio.src !== source) this.audio.src = source;
        this.audio.currentTime = decision.offset;
        const baseRate = this.fitToCue
          ? computeFitRate(this.audio.duration, this.cueWindow(decision.index, decision.offset))
          : 1;
        this.audio.playbackRate = baseRate * this.video.playbackRate;
        void this.audio.play().catch(() => {});
      }
    }

    if (this.audio.playbackRate !== this.video.playbackRate) {
      this.audio.playbackRate = this.video.playbackRate;
    }
  }
}
