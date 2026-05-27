import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import config from "./config.js";
import { getRecentMessages } from "./db.js";
import { getCached } from "./cache.js";

const TASTE_FILES = {
  taste: "taste.md",
  moodRules: "mood-rules.md",
  playlists: "playlists.json",
  routines: "routines.md",
};

const DEFAULT_DJ_PERSONA = `你是 Claudio，一位私人 AI 电台 DJ。你温暖、有品位、懂音乐，像一个深夜电台主持人那样与听众交流。
你必须始终以 JSON 格式回复：
{"say": "DJ 播报词", "play": [{"query": "搜索词"}], "reason": "推荐理由", "segue": "过渡语"}
用中文交流，根据用户的音乐品味、天气、时间和日程来推荐音乐。

## 重要行为规则
- 当用户明确要求切换歌曲类型/风格/心情时，你应该简短确认切换（一句话），然后返回新类型的歌曲搜索词。系统会自动清空旧队列并切换播放。
- 当用户只是聊天而非要求切换音乐时，正常回复，不要打断正在播放的歌曲。
- 搜索词应该具体明确，适合网易云音乐搜索（如"轻松的爵士乐"而不是"轻松的音乐"）。`;

// ── File readers ────────────────────────────────────────────────────────────────

function readFileSafe(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function readTasteFile(filename) {
  const path = resolve(config.paths.data, filename);
  return readFileSafe(path);
}

function loadPromptFile(name) {
  const path = resolve(config.paths.prompts, name);
  return readFileSafe(path);
}

// ── Taste profiles ──────────────────────────────────────────────────────────────

function loadTasteProfiles() {
  const results = {};
  const missing = [];

  for (const [key, filename] of Object.entries(TASTE_FILES)) {
    const content = readTasteFile(filename);
    if (content !== null) {
      results[key] = content;
    } else {
      missing.push(filename);
    }
  }

  if (missing.length > 0) {
    console.warn(`[context] Taste files missing: ${missing.join(", ")}`);
  }

  return { profiles: results, missing };
}

// ── Environment ─────────────────────────────────────────────────────────────────

function getEnvironmentData() {
  const weather = getCached("weather");
  const calendar = getCached("calendar");

  return {
    weather: weather || { error: "unavailable" },
    calendar: calendar || [],
  };
}

// ── History ─────────────────────────────────────────────────────────────────────

async function loadHistory(limit = 10) {
  try {
    const messages = getRecentMessages(limit);
    return messages.reverse().map((m) => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
    }));
  } catch {
    return [];
  }
}

// ── Prompt assembly ─────────────────────────────────────────────────────────────

function assemblePrompt({ djPersona, taste, moodRules, playlists, routines, weather, calendar, history }) {
  const sections = [];

  // DJ Persona — 优先从文件加载，否则用默认
  sections.push(djPersona || DEFAULT_DJ_PERSONA);
  sections.push("");

  // User taste profiles
  if (taste) {
    sections.push("## 用户音乐品味");
    sections.push(taste.trim());
    sections.push("");
  }

  if (moodRules) {
    sections.push("## 心情-音乐映射规则");
    sections.push(moodRules.trim());
    sections.push("");
  }

  if (playlists) {
    sections.push("## 用户歌单");
    try {
      const parsed = JSON.parse(playlists);
      sections.push(JSON.stringify(parsed, null, 2));
    } catch {
      sections.push(playlists.trim());
    }
    sections.push("");
  }

  if (routines) {
    sections.push("## 用户日常作息");
    sections.push(routines.trim());
    sections.push("");
  }

  // Current environment
  sections.push("## 当前环境");
  const now = new Date();
  sections.push(`当前时间: ${now.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`);

  if (weather && !weather.error) {
    sections.push(`天气: ${weather.temperature}°C, ${weather.condition}, 体感 ${weather.feels_like || weather.temperature}°C, 城市: ${weather.city || "未知"}`);
  } else {
    sections.push("天气: 数据不可用");
  }

  if (calendar && calendar.length > 0) {
    sections.push("今日日程:");
    for (const event of calendar) {
      const time = event.startTime ? event.startTime.split("T")[1]?.slice(0, 5) || "" : "";
      sections.push(`  - ${time} ${event.title}${event.location ? ` @${event.location}` : ""}`);
    }
  } else {
    sections.push("今日日程: 无安排");
  }

  sections.push("");

  // Conversation history
  sections.push("## 对话历史");
  if (history && history.length > 0) {
    for (const msg of history) {
      sections.push(`[${msg.role}] ${msg.content}`);
    }
  } else {
    sections.push("（新会话）");
  }

  sections.push("");
  sections.push("## 用户当前请求");

  return sections.join("\n");
}

// ── Public API ──────────────────────────────────────────────────────────────────

export async function buildContext(tasteLimit = 20) {
  const { profiles, missing } = loadTasteProfiles();
  const env = getEnvironmentData();
  const history = await loadHistory(tasteLimit);
  const djPersona = loadPromptFile("dj-persona.md");

  return {
    djPersona,
    taste: profiles.taste || null,
    moodRules: profiles.moodRules || null,
    playlists: profiles.playlists || null,
    routines: profiles.routines || null,
    weather: env.weather,
    calendar: env.calendar,
    history,
    missingTasteFiles: missing,
  };
}

export async function buildPrompt(userMessage, tasteLimit = 20) {
  const context = await buildContext(tasteLimit);
  const prompt = assemblePrompt({ ...context, history: context.history });
  return { prompt, context };
}

// ── Radio continuation prompt ─────────────────────────────────────────────────

/**
 * 构建电台续播提示词。
 * 当有活跃 session 时，基于场景上下文请求更多歌曲。
 * 当无 session 时，基于用户品味档案默认推荐。
 */
export async function buildContinuePrompt(session) {
  const { profiles } = loadTasteProfiles();
  const env = getEnvironmentData();
  const djPersona = loadPromptFile("dj-persona.md");

  const sections = [];
  sections.push(djPersona || DEFAULT_DJ_PERSONA);
  sections.push("");

  // 用户品味（续播也需要参考）
  if (profiles.taste) {
    sections.push("## 用户音乐品味");
    sections.push(profiles.taste.trim());
    sections.push("");
  }

  if (profiles.moodRules) {
    sections.push("## 心情-音乐映射规则");
    sections.push(profiles.moodRules.trim());
    sections.push("");
  }

  // 当前环境
  const now = new Date();
  sections.push("## 当前环境");
  sections.push(`当前时间: ${now.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`);
  if (env.weather && !env.weather.error) {
    sections.push(`天气: ${env.weather.temperature}°C, ${env.weather.condition}, 城市: ${env.weather.city || "未知"}`);
  }
  sections.push("");

  // 续播请求（核心）
  sections.push("## 用户请求（系统自动续播）");

  if (session) {
    const playedList = (session.playedIds || []).join(", ");
    sections.push(`继续为当前电台场景推荐歌曲。`);
    sections.push(`当前模式：${session.description || session.scene || "未知"}`);
    if (session.scene) sections.push(`场景：${session.scene}`);
    if (session.mood) sections.push(`心情：${session.mood}`);
    if (session.context) sections.push(`用户原始需求：${session.context}`);
    if (playedList) {
      sections.push(`已播放歌曲ID（请避免重复）：${playedList}`);
    }
    sections.push("请返回至少 5 首风格匹配但不同于已播放列表的歌曲。保持 session 字段与当前会话一致。");
  } else {
    sections.push("请根据用户的音乐品味推荐至少 5 首歌。结合当前时间和天气，像电台一样自然混搭。");
    sections.push("这是默认电台模式，不需要设置 session 字段。");
  }

  return sections.join("\n");
}

export default { buildContext, buildPrompt, buildContinuePrompt };
