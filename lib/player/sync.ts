import type { Cue } from "../subtitle/types.ts";

export type PlaybackAction = "play" | "continue" | "resync" | "stop";

export interface PlaybackDecision {
  action: PlaybackAction;
  /** Chỉ số cue đang phát, -1 khi đang ở khoảng lặng. */
  index: number;
  /** Vị trí cần phát trong audio của cue này (giây). */
  offset: number;
}

export interface PlaybackSchedulerOptions {
  /** Sai lệch (giây) vượt ngưỡng thì phải tua lại audio cho khớp video. */
  resyncThreshold?: number;
}

/** Tìm cue chứa thời điểm `time`; trả -1 nếu đang ở khoảng lặng giữa hai cue. */
export function findCueIndexAt(cues: Cue[], time: number): number {
  let low = 0;
  let high = cues.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const cue = cues[mid];
    if (!cue) break;
    if (time < cue.start) high = mid - 1;
    else if (time >= cue.end) low = mid + 1;
    else return mid;
  }
  return -1;
}

/**
 * Quyết định phát dựa trên đồng hồ video, không dựa vào thời gian trôi của audio.
 * Nhờ vậy seek, pause, đổi tốc độ đều tự khớp mà không trôi sai số.
 */
export class PlaybackScheduler {
  private readonly cues: Cue[];
  private readonly threshold: number;
  private currentIndex = -1;
  private resyncs = 0;

  constructor(cues: Cue[], options: PlaybackSchedulerOptions = {}) {
    this.cues = cues;
    this.threshold = Math.max(0.05, options.resyncThreshold ?? 0.2);
  }

  get index(): number {
    return this.currentIndex;
  }

  get resyncCount(): number {
    return this.resyncs;
  }

  reset(): void {
    this.currentIndex = -1;
  }

  update(videoTime: number, audioTime: number): PlaybackDecision {
    const index = findCueIndexAt(this.cues, videoTime);
    const cue = index >= 0 ? this.cues[index] : undefined;

    if (index < 0 || !cue) {
      this.currentIndex = -1;
      return { action: "stop", index: -1, offset: 0 };
    }

    const offset = Math.max(0, videoTime - cue.start);

    if (index !== this.currentIndex) {
      this.currentIndex = index;
      return { action: "play", index, offset };
    }

    if (!Number.isFinite(audioTime) || Math.abs(audioTime - offset) > this.threshold) {
      this.resyncs += 1;
      return { action: "resync", index, offset };
    }

    return { action: "continue", index, offset };
  }
}
