import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_PIPER_VOICE, PIPER_SYNTH_MESSAGE, PiperTtsProvider, base64ToBytes } from "../lib/tts/piper.ts";
import { PreferredTtsProvider } from "../lib/tts/preferred.ts";

const bytes = (length, fill) => new Uint8Array(length).fill(fill);

test("base64ToBytes round-trip", () => {
  const original = Uint8Array.from([0, 1, 2, 250, 255, 128]);
  const encoded = Buffer.from(original).toString("base64");
  assert.deepEqual(base64ToBytes(encoded), original);
});

test("PiperTtsProvider gửi đúng message và trả bytes", async () => {
  const sent = [];
  const provider = new PiperTtsProvider({
    send: async (message) => {
      sent.push(message);
      return { ok: true, base64: Buffer.from(bytes(1024, 7)).toString("base64") };
    },
  });

  const audio = await provider.synthesize("  xin   chào  ");
  assert.equal(audio.length, 1024);
  assert.equal(audio[0], 7);
  assert.deepEqual(sent[0], {
    type: PIPER_SYNTH_MESSAGE,
    text: "xin chào",
    voiceId: DEFAULT_PIPER_VOICE,
  });
});

test("PiperTtsProvider báo lỗi khi offscreen trả lỗi hoặc audio ngắn", async () => {
  const failing = new PiperTtsProvider({ send: async () => ({ ok: false, error: "model chưa tải" }) });
  await assert.rejects(() => failing.synthesize("một câu"), /model chưa tải/);

  const tiny = new PiperTtsProvider({
    send: async () => ({ ok: true, base64: Buffer.from(bytes(10, 1)).toString("base64") }),
  });
  await assert.rejects(() => tiny.synthesize("một câu"), /quá ngắn/);
});

test("PreferredTtsProvider rơi về provider phụ khi provider chính lỗi", async () => {
  const fallback = {
    name: "secondary",
    async synthesize() {
      return bytes(1000, 2);
    },
  };
  const preferred = new PreferredTtsProvider(
    {
      name: "primary",
      async synthesize() {
        throw new Error("piper hỏng");
      },
    },
    fallback,
  );

  const audio = await preferred.synthesize("câu");
  assert.equal(audio.length, 1000);
  assert.equal(audio[0], 2);
});

test("PreferredTtsProvider dùng provider chính khi thành công", async () => {
  const preferred = new PreferredTtsProvider(
    {
      name: "primary",
      async synthesize() {
        return bytes(777, 3);
      },
    },
    {
      name: "secondary",
      async synthesize() {
        return bytes(1, 4);
      },
    },
  );
  const audio = await preferred.synthesize("câu");
  assert.equal(audio.length, 777);
});
