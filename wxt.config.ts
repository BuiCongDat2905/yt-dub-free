import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "YT Dub Free",
    description: "Long tieng YouTube sang tieng Viet bang dich va TTS mien phi.",
    version: "0.2.0",
    icons: {
      16: "icon/16.png",
      32: "icon/32.png",
      48: "icon/48.png",
      128: "icon/128.png",
    },
    permissions: ["storage", "activeTab", "scripting", "offscreen", "unlimitedStorage"],
    commands: {
      "toggle-dubbing": {
        suggested_key: { default: "Alt+D", mac: "Alt+D" },
        description: "Bật/tắt lồng tiếng",
      },
    },
    content_security_policy: {
      extension_pages:
        "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; worker-src 'self' blob:;",
    },
    host_permissions: [
      "*://www.youtube.com/*",
      "https://clients5.google.com/*",
      "https://translate.googleapis.com/*",
      "https://translate.google.com/*",
      "https://huggingface.co/*",
      "https://*.hf.co/*",
    ],
  },
});
