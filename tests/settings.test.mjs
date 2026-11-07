import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_SETTINGS, normalizeSettings } from "../lib/settings.ts";

test("normalizeSettings trả mặc định khi input rỗng hoặc lạ", () => {
  assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings("rác"), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings({}), DEFAULT_SETTINGS);
});

test("normalizeSettings kẹp âm lượng vào [0,1]", () => {
  assert.equal(normalizeSettings({ originalVolume: 2 }).originalVolume, 1);
  assert.equal(normalizeSettings({ originalVolume: -1 }).originalVolume, 0);
  assert.equal(normalizeSettings({ dubVolume: 0.35 }).dubVolume, 0.35);
  assert.equal(normalizeSettings({ dubVolume: "0.5" }).dubVolume, 0.5);
});

test("normalizeSettings bỏ giá trị không phải số", () => {
  const settings = normalizeSettings({ originalVolume: "abc", dubVolume: Number.NaN, enabled: "yes" });
  assert.equal(settings.originalVolume, DEFAULT_SETTINGS.originalVolume);
  assert.equal(settings.dubVolume, DEFAULT_SETTINGS.dubVolume);
  assert.equal(settings.enabled, DEFAULT_SETTINGS.enabled);
});

test("normalizeSettings chỉ nhận boolean cho enabled", () => {
  assert.equal(normalizeSettings({ enabled: true }).enabled, true);
  assert.equal(normalizeSettings({ enabled: false }).enabled, false);
  assert.equal(normalizeSettings({ enabled: 1 }).enabled, false);
});
