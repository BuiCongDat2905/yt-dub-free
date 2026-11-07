import test from "node:test";
import assert from "node:assert/strict";

import {
  GoogleTtsProvider,
  buildTtsUrl,
  splitForTts,
} from "../lib/tts/google.ts";
import { TtsQueue } from "../lib/tts/queue.ts";

const bytes = (length, fill) => new Uint8Array(length).fill(fill);

const okAudio = (length = 1000, fill = 1) => ({
  ok: true,
  arrayBuffer: async () => bytes(length, fill).buffer,
});

test("buildTtsUrl đặt đủ tham số và mã hoá câu", () => {
  const url = new URL(buildTtsUrl("xin chào & tạm biệt", "vi"));
  assert.equal(url.origin, "https://translate.google.com");
  assert.equal(url.pathname, "/translate_tts");
  assert.equal(url.searchParams.get("ie"), "UTF-8");
  assert.equal(url.searchParams.get("client"), "tw-ob");
  assert.equal(url.searchParams.get("tl"), "vi");
  assert.equal(url.searchParams.get("q"), "xin chào & tạm biệt");
});

test("splitForTts giữ nguyên câu ngắn, cắt câu dài mà không mất chữ", () => {
  assert.deepEqual(splitForTts("  xin   chào  "), ["xin chào"]);
  const long = `${"từ ngắn ".repeat(40)}cuối`;
  const chunks = splitForTts(long);
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((chunk) => chunk.length <= 190));
  assert.equal(chunks.join(" ").replace(/\s+/g, " "), long.replace(/\s+/g, " ").trim());
  assert.deepEqual(splitForTts("   "), []);
});

test("GoogleTtsProvider ghép nhiều chunk MP3 theo thứ tự", async () => {
  const requested = [];
  let call = 0;
  const fetchImpl = async (url) => {
    requested.push(new URL(url).searchParams.get("q"));
    call += 1;
    return okAudio(1000, call);
  };

  const provider = new GoogleTtsProvider({ fetchImpl });
  const text = `${"a".repeat(150)} ${"b".repeat(150)}`;
  const audio = await provider.synthesize(text);

  assert.deepEqual(requested, splitForTts(text));
  assert.equal(audio.length, requested.length * 1000);
  assert.equal(audio[0], 1);
  assert.equal(audio[1000], 2);
});

test("GoogleTtsProvider ném lỗi khi HTTP lỗi hoặc audio quá ngắn", async () => {
  const httpError = new GoogleTtsProvider({
    fetchImpl: async () => ({ ok: false, status: 429, arrayBuffer: async () => new ArrayBuffer(0) }),
  });
  await assert.rejects(() => httpError.synthesize("một câu"), /HTTP 429/);

  const tiny = new GoogleTtsProvider({ fetchImpl: async () => okAudio(10) });
  await assert.rejects(() => tiny.synthesize("một câu"), /audio quá ngắn/);

  const empty = new GoogleTtsProvider({ fetchImpl: async () => okAudio() });
  await assert.rejects(() => empty.synthesize("   "), /câu rỗng/);
});

function makeProvider({ delays = [], failIndexes = [], name = "fake-tts" } = {}) {
  const state = { calls: 0, inFlight: 0, peak: 0, order: [] };
  return {
    state,
    provider: {
      name,
      async synthesize(text) {
        const index = state.calls;
        state.calls += 1;
        state.inFlight += 1;
        state.peak = Math.max(state.peak, state.inFlight);
        state.order.push(text);
        try {
          await new Promise((resolve) => setTimeout(resolve, delays[index] ?? 0));
          if (failIndexes.includes(index)) throw new Error(`fake lỗi ${index}`);
          return bytes(64, index + 1);
        } finally {
          state.inFlight -= 1;
        }
      },
    },
  };
}

test("TtsQueue giới hạn song song và giữ thứ tự kết quả", async () => {
  const { state, provider } = makeProvider({ delays: [40, 30, 20, 10, 5, 1] });
  const queue = new TtsQueue({ provider, concurrency: 3 });
  const texts = ["một", "hai", "ba", "bốn", "năm", "sáu"];
  const results = await queue.synthesizeAll(texts);

  assert.deepEqual(results.map((result) => result.text), texts);
  assert.ok(state.peak <= 3, `peak=${state.peak}`);
  assert.ok(state.peak > 1, "phải chạy song song");
  assert.equal(results.filter((result) => result.audio !== null).length, texts.length);
});

test("TtsQueue dùng cache, lần hai không gọi provider", async () => {
  const store = new Map();
  const cache = {
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async set(key, value) {
      store.set(key, value);
    },
  };

  const { state, provider } = makeProvider();
  const queue = new TtsQueue({ provider, cache });
  await queue.synthesizeAll(["xin chào", "tạm biệt"]);
  const callsAfterFirst = state.calls;
  const second = await new TtsQueue({ provider, cache }).synthesizeAll(["xin chào", "tạm biệt"]);

  assert.equal(state.calls, callsAfterFirst, "lần hai phải lấy cache");
  assert.ok(second.every((result) => result.fromCache === true));
});

test("TtsQueue chuyển sang speechSynthesis sau 2 lỗi liên tiếp", async () => {
  const { state, provider } = makeProvider({ failIndexes: [0, 1] });
  const spoken = [];
  const fallback = {
    name: "system-tts",
    async speak(text) {
      spoken.push(text);
    },
  };

  const queue = new TtsQueue({ provider, fallback, maxFailures: 2, concurrency: 1 });
  const results = await queue.synthesizeAll(["một", "hai", "ba", "bốn"]);

  assert.equal(queue.stats.systemMode, true);
  assert.match(queue.stats.firstError ?? "", /fake lỗi 0/);
  assert.equal(results[0]?.provider, "system-tts", "câu lỗi được đọc ngay bằng dự phòng");
  assert.equal(results[0]?.audio, null);
  assert.equal(results[0]?.error, undefined);
  assert.equal(results[3]?.provider, "system-tts");
  assert.deepEqual(spoken, ["một", "hai", "ba", "bốn"]);
  assert.equal(state.calls, 2, "sau khi chuyển dự phòng không gọi provider nữa");
});

test("TtsQueue không có dự phòng thì trả lỗi từng câu", async () => {
  const { provider } = makeProvider({ failIndexes: [0] });
  const results = await new TtsQueue({ provider }).synthesizeAll(["một", "hai"]);
  assert.equal(results[0]?.audio, null);
  assert.match(results[0]?.error ?? "", /fake lỗi 0/);
  assert.ok(results[1]?.audio instanceof Uint8Array);
});

test("TtsQueue.cancel huỷ các câu còn lại", async () => {
  const { provider } = makeProvider({ delays: [50, 50, 50, 50] });
  const queue = new TtsQueue({ provider, concurrency: 1 });
  const promise = queue.synthesizeAll(["một", "hai", "ba", "bốn"]);
  queue.cancel();
  const results = await promise;
  assert.equal(results[0]?.provider, "fake-tts", "câu đang chạy dở thì hoàn tất");
  assert.ok(results[0]?.audio instanceof Uint8Array);
  assert.deepEqual(
    results.slice(1).map((result) => result.provider),
    ["cancelled", "cancelled", "cancelled"],
  );
});
