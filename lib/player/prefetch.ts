import type { Cue } from "../subtitle/types.ts";

export interface PrefetchOptions {
  cues: Cue[];
  texts: string[];
  audioByIndex: Array<Uint8Array | null>;
  synthesize: (text: string) => Promise<Uint8Array | null>;
  /** Số câu nhìn trước khi một cue bắt đầu phát. */
  lookahead?: number;
  onReady?: (index: number, audio: Uint8Array | null) => void;
}

/**
 * Tổng hợp trước các câu sắp tới để lúc phát không bị khoảng lặng.
 * Tuần tự từng câu (không dồn request), bỏ qua câu đã có audio, huỷ được.
 */
export class PrefetchController {
  private readonly cues: Cue[];
  private readonly texts: string[];
  private readonly audioByIndex: Array<Uint8Array | null>;
  private readonly synthesize: (text: string) => Promise<Uint8Array | null>;
  private readonly lookahead: number;
  private readonly onReady?: (index: number, audio: Uint8Array | null) => void;

  private readonly queued = new Set<number>();
  private readonly started = new Set<number>();
  private queue: number[] = [];
  private active = 0;
  private peak = 0;
  private cancelled = false;
  private paused = false;

  constructor(options: PrefetchOptions) {
    this.cues = options.cues;
    this.texts = options.texts;
    this.audioByIndex = options.audioByIndex;
    this.synthesize = options.synthesize;
    this.lookahead = Math.max(0, options.lookahead ?? 4);
    this.onReady = options.onReady;
  }

  get stats(): { started: number; queued: number; active: number; peak: number; cancelled: boolean } {
    return {
      started: this.started.size,
      queued: this.queue.length,
      active: this.active,
      peak: this.peak,
      cancelled: this.cancelled,
    };
  }

  /** Tạm dừng khi tab bị ẩn; bật lại thì chạy tiếp phần còn trong hàng đợi. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!paused) this.pump();
  }

  /** Gọi mỗi khi con trỏ phát đổi cue; chỉ xếp các câu phía trước còn thiếu audio. */
  ensureFrom(index: number): void {
    if (this.cancelled) return;
    const last = Math.min(this.cues.length - 1, index + this.lookahead - 1);
    for (let cursor = Math.max(0, index); cursor <= last; cursor += 1) {
      if (this.audioByIndex[cursor]) continue;
      if (this.started.has(cursor)) continue;
      this.started.add(cursor);
      this.queue.push(cursor);
    }
    this.pump();
  }

  cancel(): void {
    this.cancelled = true;
    this.queue = [];
    this.queued.clear();
  }

  private pump(): void {
    if (this.cancelled || this.paused || this.active > 0) return;
    const index = this.queue.shift();
    if (index === undefined) return;

    this.active = 1;
    this.peak = Math.max(this.peak, this.active);
    const text = this.texts[index] ?? this.cues[index]?.text ?? "";

    void this.synthesize(text)
      .then((audio) => {
        if (this.cancelled) return;
        this.audioByIndex[index] = audio;
        this.onReady?.(index, audio);
      })
      .catch(() => {
        // câu lỗi để engine tự chuyển sang speechSynthesis khi phát
      })
      .finally(() => {
        this.active = 0;
        this.queued.delete(index);
        if (!this.cancelled && this.queue.length > 0) this.pump();
      });
  }
}
