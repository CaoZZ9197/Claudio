import { config as loadEnv } from "dotenv";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { mkdirSync } from "node:fs";

loadEnv();

const REQUIRED_KEYS = ["ANTHROPIC_API_KEY"];

const missing = REQUIRED_KEYS.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.warn(`[config] Missing environment variables: ${missing.join(", ")}. Some features may not work.`);
}

const claudioHome = join(homedir(), ".claudio");
mkdirSync(claudioHome, { recursive: true });

const config = Object.freeze({
  port: parseInt(process.env.PORT, 10) || 8080,
  model: process.env.CLAUDIO_MODEL || process.env.CLAUDE_MODEL || "claude-sonnet-4-6",

  // 三方大模型 API 代理地址（MiniMax 等 Anthropic 兼容 API）
  anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL || null,

  // 播放历史保留天数（默认14天）
  playHistoryDays: parseInt(process.env.PLAY_HISTORY_DAYS, 10) || 14,

  apiKeys: Object.freeze({
    anthropic: process.env.ANTHROPIC_API_KEY || null,

    openWeather: process.env.OPENWEATHER_API_KEY || null,
    feishuAppId: process.env.FEISHU_APP_ID || null,
    feishuAppSecret: process.env.FEISHU_APP_SECRET || null,
    neteaseAppId: process.env.NETEASE_APP_ID || null,
    neteasePrivateKey: process.env.NETEASE_PRIVATE_KEY || null,
    neteaseCookie: process.env.NETEASE_COOKIE || null,
    minimax: process.env.MINIMAX_API_KEY || null,
  }),

  tts: Object.freeze({
    provider: process.env.TTS_PROVIDER || "minimax",  // "minimax" | "edge-tts"
    // MiniMax TTS 配置（provider=minimax 时生效）
    voiceId: process.env.MINIMAX_TTS_VOICE_ID || "female-shaonv",
    speed: parseFloat(process.env.MINIMAX_TTS_SPEED) || 1.0,
    vol: parseFloat(process.env.MINIMAX_TTS_VOL) || 1.0,
    pitch: parseInt(process.env.MINIMAX_TTS_PITCH, 10) || 0,
    // Edge-TTS 配置（provider=edge-tts 时生效）
    edgeVoice: process.env.EDGE_TTS_VOICE || "zh-CN-XiaoxiaoNeural",
    edgeRate: process.env.EDGE_TTS_RATE || "+0%",
    edgePitch: process.env.EDGE_TTS_PITCH || "+0Hz",
  }),

  paths: Object.freeze({
    db: join(claudioHome, "state.db"),

    data: resolve("data"),
    prompts: resolve("prompts"),
    frontend: resolve("src/frontend"),
  }),
});

export default config;
