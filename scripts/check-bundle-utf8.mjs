import { readFileSync } from "node:fs";

const file = ".output/chrome-mv3/content-scripts/content.js";
const js = readFileSync(file, "utf8");

const good = js.includes("\u0110ang chu\u1EA9n b\u1ECB");
const bad = js.includes("\u00C4ang chu") || js.includes("chu\u00e1\u00ba\u00a9n");
console.log(`bundle_utf8_good=${good} mojibake_present=${bad}`);

if (!good || bad) {
  console.log("FAIL: bundle còn hỏng UTF-8");
  process.exit(1);
}
