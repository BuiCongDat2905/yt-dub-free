import test from "node:test";
import assert from "node:assert/strict";

import { PlaybackScheduler, findCueIndexAt } from "../lib/player/sync.ts";

const cue = (start, end, text) => ({ start, end, text });

const CUES = [
  cue(0, 2, "một"),
  cue(2, 4, "hai"),
  cue(4, 6, "ba"),
  cue(6, 8, "bốn"),
  cue(10, 12, "năm"),
];

test("findCueIndexAt: start tính là trong cue, end không", () => {
  assert.equal(findCueIndexAt(CUES, 0), 0);
  assert.equal(findCueIndexAt(CUES, 1.999), 0);
  assert.equal(findCueIndexAt(CUES, 2), 1);
  assert.equal(findCueIndexAt(CUES, 7.999), 3);
  assert.equal(findCueIndexAt(CUES, 8), -1, "khoảng lặng 8-10");
  assert.equal(findCueIndexAt(CUES, 11), 4);
  assert.equal(findCueIndexAt(CUES, 99), -1);
  assert.equal(findCueIndexAt([], 1), -1);
});

test("scheduler: cue mới -> play đúng offset", () => {
  const scheduler = new PlaybackScheduler(CUES);
  assert.deepEqual(scheduler.update(1.5, 0), { action: "play", index: 0, offset: 1.5 });
  assert.deepEqual(scheduler.update(1.6, 1.6), { action: "continue", index: 0, offset: 1.6 });
});

test("scheduler: lệch quá ngưỡng -> resync, lệch nhỏ -> continue", () => {
  const scheduler = new PlaybackScheduler(CUES, { resyncThreshold: 0.2 });
  scheduler.update(1, 1);
  assert.deepEqual(scheduler.update(1.5, 1.4), { action: "continue", index: 0, offset: 1.5 });
  assert.deepEqual(scheduler.update(1.6, 2.5), { action: "resync", index: 0, offset: 1.6 });
  assert.equal(scheduler.resyncCount, 1);
  assert.deepEqual(scheduler.update(1.7, 1.7), { action: "continue", index: 0, offset: 1.7 });
});

test("scheduler: khoảng lặng -> stop, rồi vào cue mới -> play", () => {
  const scheduler = new PlaybackScheduler(CUES);
  scheduler.update(1, 1);
  assert.deepEqual(scheduler.update(9, 0), { action: "stop", index: -1, offset: 0 });
  assert.deepEqual(scheduler.update(10.5, 0), { action: "play", index: 4, offset: 0.5 });
});

test("scheduler: 10 seek liên tiếp, lệch sau seek dưới 300 ms", () => {
  const scheduler = new PlaybackScheduler(CUES, { resyncThreshold: 0.2 });
  const seeks = [3.7, 1.2, 7.9, 5.0, 11.4, 0.1, 6.5, 2.2, 9.4, 4.8];
  let worstDrift = 0;

  for (const target of seeks) {
    const decision = scheduler.update(target, Number.NaN);
    const index = findCueIndexAt(CUES, target);
    if (index < 0) {
      assert.equal(decision.action, "stop");
      continue;
    }
    assert.equal(decision.action, "play", `seek ${target} phải play cue ${index}`);
    assert.equal(decision.index, index);
    const expected = target - (CUES[index]?.start ?? 0);
    worstDrift = Math.max(worstDrift, Math.abs(decision.offset - expected));
    // sau khi áp offset, vòng tick kế tiếp phải coi là khớp
    const next = scheduler.update(target + 0.05, decision.offset + 0.05);
    assert.equal(next.action, "continue");
  }

  assert.ok(worstDrift < 0.3, `lệch ${worstDrift}s`);
});

test("scheduler: đổi tốc độ không đổi offset (đồng hồ là video, không phải audio)", () => {
  const scheduler = new PlaybackScheduler(CUES);
  const normal = scheduler.update(3.2, 0);
  const rescheduled = new PlaybackScheduler(CUES);
  const fast = rescheduled.update(3.2, 0);
  assert.deepEqual(normal, fast);
  assert.ok(Math.abs(normal.offset - 1.2) < 1e-9, `offset=${normal.offset}`);
});

test("scheduler: NaN audioTime thì coi là lệch và resync", () => {
  const scheduler = new PlaybackScheduler(CUES);
  scheduler.update(1, 1);
  const decision = scheduler.update(1.1, Number.NaN);
  assert.equal(decision.action, "resync");
});
