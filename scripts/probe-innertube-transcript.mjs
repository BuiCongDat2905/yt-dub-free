import { fetchTranscriptViaInnertube, fetchWatchPageSource } from "../lib/youtube/transcriptInnertube.ts";
const videoId = process.argv[2] ?? "Rm0t1KwFmBw";
const page = await fetchWatchPageSource(videoId);
const result = await fetchTranscriptViaInnertube({ videoId, pageSource: page });
console.log("diagnostic=" + JSON.stringify(result.diagnostic));
console.log("cues=" + result.cues.length);
if (result.cues[0]) console.log("first=[" + result.cues[0].start.toFixed(2) + "-" + result.cues[0].end.toFixed(2) + "] " + result.cues[0].text.slice(0, 70));
