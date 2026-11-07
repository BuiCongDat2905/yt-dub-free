import test from "node:test";
import assert from "node:assert/strict";

import {
  extractInnertubeConfig,
  extractTranscriptParams,
  parseTranscriptSegments,
} from "../lib/youtube/transcriptInnertube.ts";

const HTML = `
<script nonce="x">var ytcfg={};ytcfg.set({"INNERTUBE_API_KEY":"AIzaSyFAKE_KEY_123","INNERTUBE_CLIENT_VERSION":"2.20261105.05.01","VISITOR_DATA":"Cgt2aXNpdG9yRGF0YQ%3D%3D"});</script>
<script nonce="y">var ytInitialData={"engagementPanels":[{"panel":{"getTranscriptEndpoint":{"params":"CgtkUXc0dzlXZ1hjURIOQ2dBU0FtVnVHZ0ElM0QY"}}}]};</script>
`;

const TRANSCRIPT_PAYLOAD = {
  actions: [
    {
      updateEngagementPanelAction: {
        content: {
          transcriptRenderer: {
            content: {
              transcriptBodyRenderer: {
                transcriptSegmentListRenderer: {
                  initialSegments: [
                    {
                      transcriptSegmentRenderer: {
                        startMs: "0",
                        endMs: "1500",
                        snippet: { runs: [{ text: "Hello " }, { text: "everyone." }] },
                      },
                    },
                    {
                      transcriptSegmentRenderer: {
                        startMs: "1500",
                        endMs: "3000",
                        snippet: { simpleText: "Welcome back." },
                      },
                    },
                    { transcriptSegmentRenderer: { startMs: 3000, endMs: 4000, snippet: { runs: [{ text: "  " }] } } },
                  ],
                },
              },
            },
          },
        },
      },
    },
  ],
};

test("extractInnertubeConfig lấy api key, client version, visitor data", () => {
  const config = extractInnertubeConfig(HTML);
  assert.equal(config.apiKey, "AIzaSyFAKE_KEY_123");
  assert.equal(config.clientVersion, "2.20261105.05.01");
  assert.equal(config.visitorData, "Cgt2aXNpdG9yRGF0YQ%3D%3D");

  const empty = extractInnertubeConfig("<html></html>");
  assert.deepEqual(empty, { apiKey: null, clientVersion: null, visitorData: null });
});

test("extractTranscriptParams lấy params từ ytInitialData", () => {
  assert.equal(
    extractTranscriptParams(HTML),
    "CgtkUXc0dzlXZ1hjURIOQ2dBU0FtVnVHZ0ElM0QY",
  );
  assert.equal(extractTranscriptParams("<html></html>"), null);
});

test("parseTranscriptSegments đọc runs, simpleText, bỏ segment rỗng", () => {
  const cues = parseTranscriptSegments(TRANSCRIPT_PAYLOAD);
  assert.equal(cues.length, 2);
  assert.deepEqual(cues[0], { start: 0, end: 1.5, text: "Hello everyone." });
  assert.deepEqual(cues[1], { start: 1.5, end: 3, text: "Welcome back." });
});

test("parseTranscriptSegments chịu payload lạ", () => {
  assert.deepEqual(parseTranscriptSegments(null), []);
  assert.deepEqual(parseTranscriptSegments({}), []);
  assert.deepEqual(parseTranscriptSegments([]), []);
  assert.deepEqual(parseTranscriptSegments("string"), []);
});

test("parseTranscriptSegments dùng 800ms mặc định khi thiếu endMs", () => {
  const cues = parseTranscriptSegments({
    a: { transcriptSegmentRenderer: { startMs: 2000, snippet: { simpleText: "một câu" } } },
  });
  assert.equal(cues.length, 1);
  assert.equal(cues[0].start, 2);
  assert.ok(cues[0].end > 2);
});
