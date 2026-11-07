import { installCaptionHook } from "@/lib/youtube/captionHookMain";

export default defineContentScript({
  matches: ["*://www.youtube.com/*"],
  runAt: "document_start",
  world: "MAIN",
  main() {
    installCaptionHook();
  },
});
