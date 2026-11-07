import test from "node:test";
import assert from "node:assert/strict";

import { prepareDubbing } from "../lib/pipeline.ts";

const cue = (start, end, text) => ({ start, end, text });

function fakeTranslateFetch(prefix = "vi:") {
  return async (url) => {
    const q = new URL(url).searchParams.get("q");
    return { ok: true, json: async () => [[[`${prefix}${q}`, q, null, null, 1]], null, "en"] };
  };
}

const fakeProvider = (options = {}) => {
  const state = { calls: 0 };
  return {
    state,
    provider: {
      name: "fake-tts",
      async synthesize(text) {
        state.calls += 1;
        if (options.failAll) throw new Error("tts hỏng");
        return new Uint8Array(32).fill(text.length % 255 || 1);
      },
    },
  };
};

test("prepareDubbing giữ thuật ngữ CNTT bằng tiếng Anh", async () => {
  const { provider } = fakeProvider();
  const prepared = await prepareDubbing({
    cues: [cue(0, 2, "Dùng React và API để build giao diện.")],
    provider,
    fetchImpl: fakeTranslateFetch(),
  });

  const translated = prepared.translated[0] ?? "";
  assert.ok(translated.includes("React"), "giữ React");
  assert.ok(translated.includes("API"), "giữ API");
  assert.ok(translated.includes("build"), "giữ build");
  assert.ok(!translated.includes("[["), "không còn token đánh dấu");
});

test("prepareDubbing cắt câu, dịch và tổng hợp theo đúng thứ tự", async () => {
  const { state, provider } = fakeProvider();
  const prepared = await prepareDubbing({
    cues: [
      cue(0, 1.2, "và đây là"),
      cue(1.2, 2.4, "một ví dụ."),
      cue(4.0, 5.0, "câu thứ hai."),
    ],
    provider,
    fetchImpl: fakeTranslateFetch(),
  });

  assert.equal(prepared.cues.length, 2, "hai câu sau khi gộp/cắt");
  assert.deepEqual(prepared.translated, ["vi:và đây là một ví dụ.", "vi:câu thứ hai."]);
  assert.equal(prepared.audioByIndex.length, 2);
  assert.ok(prepared.audioByIndex.every((audio) => audio instanceof Uint8Array));
  assert.deepEqual(prepared.stats, { cues: 2, translated: 2, audio: 2, system: 0, failed: 0 });
  assert.equal(state.calls, 2);
});

test("prepareDubbing chuyển sang speechSynthesis khi provider hỏng", async () => {
  const { provider } = fakeProvider({ failAll: true });
  const spoken = [];
  const prepared = await prepareDubbing({
    cues: [cue(0, 1, "một câu."), cue(2, 3, "câu hai.")],
    provider,
    fallback: {
      name: "system-tts",
      async speak(text) {
        spoken.push(text);
      },
    },
    fetchImpl: fakeTranslateFetch(),
    concurrency: 1,
  });

  assert.deepEqual(prepared.audioByIndex, [null, null]);
  assert.equal(prepared.stats.system, 2);
  assert.equal(prepared.stats.audio, 0);
  assert.deepEqual(spoken, ["vi:một câu.", "vi:câu hai."]);
});

test("prepareDubbing dùng cache dịch và cache audio ở lần hai", async () => {
  const translationStore = new Map();
  const audioStore = new Map();
  const translationCache = {
    async get(key) {
      return translationStore.has(key) ? translationStore.get(key) : null;
    },
    async set(key, value) {
      translationStore.set(key, value);
    },
  };
  const audioCache = {
    async get(key) {
      return audioStore.has(key) ? audioStore.get(key) : null;
    },
    async set(key, value) {
      audioStore.set(key, value);
    },
  };

  let network = 0;
  const fetchImpl = async (url) => {
    network += 1;
    return fakeTranslateFetch()(url);
  };

  const { state, provider } = fakeProvider();
  const options = {
    cues: [cue(0, 1, "một câu.")],
    provider,
    fetchImpl,
    translationCache,
    audioCache,
  };

  await prepareDubbing(options);
  const callsAfterFirst = state.calls;
  assert.equal(network, 1);

  const second = await prepareDubbing(options);
  assert.equal(network, 1, "không gọi lại dịch");
  assert.equal(state.calls, callsAfterFirst, "không gọi lại TTS");
  assert.ok(second.audioByIndex[0] instanceof Uint8Array);
});

test("prepareDubbing ném lỗi khi không có cue", async () => {
  const { provider } = fakeProvider();
  await assert.rejects(
    () => prepareDubbing({ cues: [], provider, fetchImpl: fakeTranslateFetch() }),
    /không có câu nào/,
  );
});
