import test from "node:test";
import assert from "node:assert/strict";

import { PrefetchController } from "../lib/player/prefetch.ts";

const cue = (start, end, text) => ({ start, end, text });

function makeFixture(count, { failAt = [], delayMs = 0 } = {}) {
  const cues = Array.from({ length: count }, (_, index) => cue(index, index + 1, `câu ${index}`));
  const texts = cues.map((item) => `vi:${item.text}`);
  const audioByIndex = new Array(count).fill(null);
  const calls = [];
  let inFlight = 0;
  let peak = 0;

  const synthesize = async (text) => {
    const index = calls.length;
    calls.push(text);
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    try {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (failAt.includes(index)) throw new Error("hỏng");
      return new Uint8Array([index + 1]);
    } finally {
      inFlight -= 1;
    }
  };

  return { cues, texts, audioByIndex, calls, synthesize, get peak() { return peak; } };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

test("ensureFrom chỉ xếp trước lookahead câu và bỏ câu đã có audio", async () => {
  const fixture = makeFixture(10);
  const controller = new PrefetchController({ ...fixture, lookahead: 3 });

  controller.ensureFrom(0);
  await flush();
  assert.deepEqual(fixture.calls, ["vi:câu 0", "vi:câu 1", "vi:câu 2"]);
  assert.equal(controller.stats.started, 3);

  controller.ensureFrom(2);
  await flush();
  assert.equal(controller.stats.started, 5, "thêm 2 câu mới, không lặp câu 2");
  assert.equal(fixture.calls.length, 5);
});

test("audio đã có sẵn thì không gọi lại", async () => {
  const fixture = makeFixture(5);
  fixture.audioByIndex[0] = new Uint8Array([9]);
  const controller = new PrefetchController({ ...fixture, lookahead: 2 });

  controller.ensureFrom(0);
  await flush();
  assert.deepEqual(fixture.calls, ["vi:câu 1"]);
});

test("chạy tuần tự, không dồn song song", async () => {
  const fixture = makeFixture(8, { delayMs: 5 });
  const controller = new PrefetchController({ ...fixture, lookahead: 4 });

  controller.ensureFrom(0);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(fixture.peak, 1);
  assert.equal(fixture.audioByIndex.filter(Boolean).length, 4);
});

test("cancel dừng phần còn lại", async () => {
  const fixture = makeFixture(10, { delayMs: 5 });
  const controller = new PrefetchController({ ...fixture, lookahead: 10 });

  controller.ensureFrom(0);
  await new Promise((resolve) => setTimeout(resolve, 8));
  controller.cancel();
  const callsAtCancel = fixture.calls.length;
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.ok(callsAtCancel <= 2, `đã gọi ${callsAtCancel}`);
  assert.equal(controller.stats.cancelled, true);
  assert.ok(fixture.calls.length <= callsAtCancel + 1, "không chạy tiếp sau cancel");
});

test("câu lỗi không chặn các câu sau", async () => {
  const fixture = makeFixture(5, { failAt: [1] });
  const ready = [];
  const controller = new PrefetchController({
    ...fixture,
    lookahead: 4,
    onReady: (index) => ready.push(index),
  });

  controller.ensureFrom(0);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.ok(ready.includes(0));
  assert.ok(!ready.includes(1), "câu lỗi không báo ready");
  assert.ok(ready.includes(2));
  assert.ok(fixture.audioByIndex[0] instanceof Uint8Array);
  assert.equal(fixture.audioByIndex[1], null);
});

test("tạm dừng khi tab ẩn, bật lại thì chạy tiếp", async () => {
  const fixture = makeFixture(6);
  const controller = new PrefetchController({ ...fixture, lookahead: 5 });

  controller.setPaused(true);
  controller.ensureFrom(0);
  await flush();
  assert.equal(fixture.calls.length, 0, "đang ẩn thì không gọi");

  controller.setPaused(false);
  await flush();
  assert.equal(fixture.calls.length, 5);
});

test("ensureFrom ngoài biên không lỗi", async () => {
  const fixture = makeFixture(3);
  const controller = new PrefetchController({ ...fixture, lookahead: 4 });
  controller.ensureFrom(2);
  await flush();
  assert.deepEqual(fixture.calls, ["vi:câu 2"]);

  const empty = makeFixture(0);
  const emptyController = new PrefetchController({ ...empty, lookahead: 4 });
  emptyController.ensureFrom(0);
  await flush();
  assert.equal(empty.calls.length, 0);
});
