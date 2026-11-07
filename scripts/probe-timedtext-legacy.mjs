const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0";
const ids = ["Rm0t1KwFmBw", "dQw4w9WgXcQ"];
const forms = [
  ["legacy-en", (id) => `https://www.youtube.com/api/timedtext?v=${id}&lang=en&fmt=json3`],
  ["legacy-en-asr", (id) => `https://www.youtube.com/api/timedtext?v=${id}&lang=en&kind=asr&fmt=json3`],
  ["legacy-c-WEB", (id) => `https://www.youtube.com/api/timedtext?v=${id}&lang=en&c=WEB&fmt=json3`],
  ["video-google", (id) => `https://video.google.com/timedtext?lang=en&v=${id}`],
  ["legacy-no-fmt", (id) => `https://www.youtube.com/api/timedtext?v=${id}&lang=en`],
];
for (const id of ids) {
  console.log(`--- ${id} ---`);
  for (const [name, build] of forms) {
    try {
      const response = await fetch(build(id), { headers: { "user-agent": ua, "accept-language": "en-US,en;q=0.9" } });
      const body = await response.text();
      console.log(`${name} status=${response.status} bytes=${body.length} head=${JSON.stringify(body.slice(0, 60))}`);
    } catch (error) {
      console.log(`${name} FAIL ${String(error).slice(0, 100)}`);
    }
  }
}
