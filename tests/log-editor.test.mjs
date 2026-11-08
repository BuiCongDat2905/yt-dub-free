import test from "node:test";
import assert from "node:assert/strict";

import { clearLogs, formatLogs, loadLogs, logEvent } from "../lib/log.ts";
import { loadEdits, saveEdits, clearEdits } from "../lib/editor/store.ts";

function installStorage() {
  const data = {};
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) {
          return key in data ? { [key]: data[key] } : {};
        },
        async set(items) {
          Object.assign(data, items);
        },
        async remove(key) {
          delete data[key];
        },
      },
    },
  };
  return data;
}

test("logEvent lưu tối đa 80 dòng và formatLogs xuất JSON", async () => {
  installStorage();
  await clearLogs();
  for (let index = 0; index < 5; index += 1) {
    await logEvent("error", "test", `lỗi ${index}`, { index });
  }
  const logs = await loadLogs();
  assert.equal(logs.length, 5);
  const parsed = JSON.parse(formatLogs(logs));
  assert.equal(parsed.count, 5);
  assert.match(parsed.exportedAt, /^\d{4}-/);
  assert.equal(parsed.entries[0].scope, "test");
  await clearLogs();
  assert.deepEqual(await loadLogs(), []);
});

test("editor store lưu và đọc bản dịch đã sửa theo videoId", async () => {
  installStorage();
  await saveEdits("abcdefghijk", { 2: "câu đã sửa" });
  const edits = await loadEdits("abcdefghijk");
  assert.deepEqual(edits, { 2: "câu đã sửa" });
  assert.deepEqual(await loadEdits("khac"), {});
  await clearEdits("abcdefghijk");
  assert.deepEqual(await loadEdits("abcdefghijk"), {});
});
