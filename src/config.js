import { config as loadEnv } from "dotenv";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { mkdirSync } from "node:fs";

loadEnv();

const REQUIRED_KEYS = ["ANTHROPIC_API_KEY", "FISH_AUDIO_API_KEY"];

const missing = REQUIRED_KEYS.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.warn(`[config] Missing environment variables: ${missing.join(", ")}. Some features may not work.`);
}

const claudioHome = join(homedir(), ".claudio");
mkdirSync(claudioHome, { recursive: true });

const ttsCacheDir = join(claudioHome, "tts-cache");
mkdirSync(ttsCacheDir, { recursive: true });

const config = Object.freeze({
  port: parseInt(process.env.PORT, 10) || 8080,
  model: process.env.CLAUDIO_MODEL || process.env.CLAUDE_MODEL || "claude-sonnet-4-6",

  // 三方大模型 API 代理地址（MiniMax 等 Anthropic 兼容 API）
  anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL || null,

  apiKeys: Object.freeze({
    anthropic: process.env.ANTHROPIC_API_KEY || null,
    fishAudio: process.env.FISH_AUDIO_API_KEY || null,
    openWeather: process.env.OPENWEATHER_API_KEY || null,
    feishuAppId: process.env.FEISHU_APP_ID || null,
    feishuAppSecret: process.env.FEISHU_APP_SECRET || null,
    neteaseAppId: process.env.NETEASE_APP_ID || null,
    neteasePrivateKey: process.env.NETEASE_PRIVATE_KEY || null,
    neteaseCookie: process.env.NETEASE_COOKIE || null,
  }),

  paths: Object.freeze({
    db: join(claudioHome, "state.db"),
    ttsCache: ttsCacheDir,
    data: resolve("data"),
    prompts: resolve("prompts"),
    frontend: resolve("src/frontend"),
  }),
});

export default config;
