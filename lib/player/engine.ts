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
  /** Tốc độ tăng tốc tối đa cho fitToCue (mặc định 1.6). */
  maxFitRate?: number;
  /**
   * Chế độ live caption: đọc lần lượt từng câu có audio, không cắt giữa từ.
   * Lệch quá xa thì bỏ bớt câu để đuổi kịp video.
   */
  queueMode?: boolean;
  onDecision?: (decision: PlaybackDecision) => void;
}

/** Tốc độ phát để audio vừa khung cue; tối đa `maxRate`. */
export function computeFitRate(audioDuration: number, windowSeconds: number, maxRate = 1.6): number {
  if (!Number.isFinite(audioDuration) || audioDuration <= 0) return 1;
  const window = Math.max(0.8, windowSeconds);
  const rate = audioDuration / window;
  if (!Number.isFinite(rate)) return 1;
  return Math.min(Math.max(1, maxRate), Math.max(1, rate));
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
  private readonly maxFitRate: number;
  private readonly queueMode: boolean;
  private readonly onDecision?: (decision: PlaybackDecision) => void;
  private readonly scheduler: PlaybackScheduler;
  private readonly objectUrls = new Map<number, string>();
  private pending: { index: number; offset: number; due: number } | null = null;
  private pendingStop: number | null = null;
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
    if (this.queueMode) {
      const timeline = this.scheduler.update(this.video.currentTime, 0);
      this.queueIndex = timeline.action === "stop" ? -1 : Math.max(-1, timeline.index - 1);
      this.audio.pause();
      this.audio.removeAttribute("src");
    }
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
    this.maxFitRate = Math.max(1, options.maxFitRate ?? 1.6);
    this.queueMode = options.queueMode ?? false;
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

  get queueStats(): { index: number; skips: number } {
    return { index: this.queueIndex, skips: this.skips };
  }

  /** Trạng thái để ghi vào dataset, phục vụ kiểm thử tự động. */
  get debug(): {
    cuts: number;
    skips: number;
    speaking: boolean;
    audioTime: number;
    audioPaused: boolean;
    rate: number;
    index: number;
    pending: boolean;
    pendingStop: boolean;
  } {
    const audioTime = this.audio.currentTime;
    return {
      cuts: this.cuts,
      skips: this.skips,
      speaking: this.isSpeaking(),
      audioTime: Number.isFinite(audioTime) ? Number(audioTime.toFixed(2)) : -1,
      audioPaused: this.audio.paused,
      rate: Number.isFinite(this.audio.playbackRate) ? Number(this.audio.playbackRate.toFixed(2)) : -1,
      index: this.scheduler.index,
      pending: this.pending !== null,
      pendingStop: this.pendingStop !== null,
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
    const baseRate = this.fitToCue
      ? computeFitRate(this.audio.duration, this.cueWindow(index, offset), this.maxFitRate)
      : 1;
    this.audio.playbackRate = baseRate * this.video.playbackRate;
    if (!this.video.paused) void this.audio.play().catch(() => {});
  }

  private applyFitRate(index: number, offset: number): void {
    if (!this.fitToCue) return;
    const duration = this.audio.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    const target =
      computeFitRate(duration, this.cueWindow(index, offset), this.maxFitRate) * this.video.playbackRate;
    if (!Number.isFinite(target) || target <= 0) return;
    if (Math.abs(this.audio.playbackRate - target) > 0.02) this.audio.playbackRate = target;
  }

  private queueIndex = -1;
  private skips = 0;

  private tickQueue(): void {
    if (this.video.paused) {
      if (!this.audio.paused) this.audio.pause();
      return;
    }

    // Đuổi kịp: nếu tụt lại quá 2 câu thì nhảy tới vị trí hiện tại của video.
    const timeline = this.scheduler.update(this.video.currentTime, this.audio.currentTime);
    if (timeline.action !== "stop" && this.queueIndex >= 0 && timeline.index > this.queueIndex + 2) {
      this.queueIndex = Math.max(-1, timeline.index - 1);
      this.skips += 1;
    }

    if (this.audio.paused || this.audio.ended) {
      let next = this.queueIndex + 1;
      while (next < this.cues.length && !this.audioByIndex[next]) next += 1;
      if (next < this.cues.length) {
        this.queueIndex = next;
        this.startCue(next, 0);
      }
    }

    if (this.queueIndex >= 0) {
      this.onDecision?.({ action: "continue", index: this.queueIndex, offset: 0 });
    }
  }

  private tick(): void {
    if (!this.running) return;

    if (this.queueMode) {
      this.tickQueue();
      return;
    }

    const decision = this.scheduler.update(this.video.currentTime, this.audio.currentTime);
    this.onDecision?.(decision);

    if (decision.action === "stop") {
      // Video đang chạy: cho câu đang nói nói nốt, chỉ cắt khi quá trễ.
      if (!this.video.paused && this.isSpeaking()) {
        if (this.pendingStop === null) {
          this.pendingStop = performance.now() + this.holdMs;
        } else if (performance.now() > this.pendingStop) {
          this.cuts += 1;
          this.pendingStop = null;
          this.audio.pause();
        }
        return;
      }
      this.pendingStop = null;
      this.pending = null;
      if (!this.audio.paused) this.audio.pause();
      return;
    }

    this.pendingStop = null;

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

    this.applyFitRate(decision.index, decision.offset);

    if (!this.video.paused && this.audio.paused) {
      const source = this.sourceFor(decision.index);
      if (source) {
        if (this.audio.src !== source) this.audio.src = source;
        this.audio.currentTime = decision.offset;
        const baseRate = this.fitToCue
          ? computeFitRate(this.audio.duration, this.cueWindow(decision.index, decision.offset), this.maxFitRate)
          : 1;
        this.audio.playbackRate = baseRate * this.video.playbackRate;
        void this.audio.play().catch(() => {});
      }
    }
  }
}
