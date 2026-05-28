import cron from "node-cron";
import { buildContext } from "./context.js";
import { callClaude } from "./claudio.js";
import { getTTS } from "./tts-adapter.js";
import { broadcastAudio, broadcast } from "./api/ws.js";
import { getPreference } from "./db.js";
import { getCurrentWeather } from "./external/weather.js";
import { getTodayEvents } from "./external/calendar.js";

const tasks = new Map();

function defaultErrorHandler(name, err) {
  console.error(`[scheduler] Task "${name}" failed: ${err.message}`);
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerTask(name, cronExpr, handler, options = {}) {
  if (tasks.has(name)) {
    console.warn(`[scheduler] Task "${name}" already registered, skipping`);
    return;
  }

  if (!cron.validate(cronExpr)) {
    throw new Error(`Invalid cron expression: ${cronExpr}`);
  }

  const errorHandler = options.onError || defaultErrorHandler;

  const task = cron.schedule(cronExpr, async () => {
    try {
      console.log(`[scheduler] Running task: ${name}`);
      await handler();
      console.log(`[scheduler] Task "${name}" completed`);
    } catch (err) {
      errorHandler(name, err);
    }
  }, { scheduled: true });

  tasks.set(name, { task, cronExpr });
  console.log(`[scheduler] Registered task "${name}" with cron: ${cronExpr}`);
}

export function cancelTask(name) {
  const entry = tasks.get(name);
  if (entry) {
    entry.task.stop();
    tasks.delete(name);
  }
}

export function listTasks() {
  return Array.from(tasks.entries()).map(([name, { cronExpr }]) => ({ name, cronExpr }));
}

// ── Individual task handlers ────────────────────────────────────────────────────

async function morningPlanningHandler() {
  console.log("[scheduler] Running morning planning...");
  // 强制刷新天气和日历数据，确保规划基于最新信息
  const [weatherResult, calendarResult] = await Promise.allSettled([
    getCurrentWeather("Beijing", true),
    getTodayEvents(true),
  ]);

  const weather = weatherResult.status === "fulfilled" ? weatherResult.value : null;
  const calendar = calendarResult.status === "fulfilled" ? calendarResult.value : null;

  const context = {
    ...(await buildContext()),
    weather,
    calendar,
  };

  const planningPrompt = `Based on the user's taste profile, current weather, and schedule, provide a brief music recommendation for the morning. Return JSON: { "recommendation": "..." }`;
  try {
    const result = await callClaude(
      `You are Claudio's planning assistant. The user's context is: ${JSON.stringify(context)}`,
      planningPrompt
    );
    console.log("[scheduler] Morning planning result:", result);
  } catch (err) {
    console.warn("[scheduler] Morning planning failed:", err.message);
  }
}

async function morningBroadcastHandler() {
  console.log("[scheduler] Running morning broadcast...");
  try {
    // 强制刷新天气和日历数据，确保播报内容最新
    const [weatherResult, calendarResult] = await Promise.allSettled([
      getCurrentWeather("Beijing", true),
      getTodayEvents(true),
    ]);

    const weather = weatherResult.status === "fulfilled" ? weatherResult.value : { error: "unavailable" };
    const calendar = calendarResult.status === "fulfilled" ? calendarResult.value : [];

    let greeting = "早上好！";
    if (weather && !weather.error) {
      greeting += `今天天气${weather.temperature}度，${weather.condition}。`;
    } else {
      greeting += "今天天气信息暂时无法获取。";
    }

    if (calendar && calendar.length > 0) {
      greeting += "今天的日程有：";
      for (const ev of calendar.slice(0, 3)) {
        const time = ev.startTime ? ev.startTime.split("T")[1]?.slice(0, 5) || "" : "";
        greeting += `${time}${ev.title}。`;
      }
    } else {
      greeting += "今天没有日程安排。";
    }

    console.log(`[scheduler] Morning broadcast: "${greeting.slice(0, 50)}..."`);

    // 使用 TTS 引擎直接流式推送语音
    broadcast({ type: "tts_start", text: greeting });
    const ttsEngine = getTTS();
    await ttsEngine.synthesize(greeting.trim(), (chunk) => {
      broadcastAudio(chunk);
    }, "cheerful");
    broadcast({ type: "tts_end" });
  } catch (err) {
    console.error("[scheduler] Morning broadcast failed:", err.message);
  }
}

async function moodCheckHandler() {
  console.log("[scheduler] Running mood check...");
  try {
    const text = "嗨，你今天心情怎么样？想听点什么音乐吗？";
    broadcast({ type: "tts_start", text });
    const ttsEngine = getTTS();
    await ttsEngine.synthesize(text.trim(), (chunk) => {
      broadcastAudio(chunk);
    }, "gentle");
    broadcast({ type: "tts_end" });
  } catch (err) {
    console.error("[scheduler] Mood check failed:", err.message);
  }
}

// ── Setup all scheduled tasks ───────────────────────────────────────────────────

export function initScheduler() {
  const morningPlanningTime = getPreference("scheduler_morning_planning") || "0 7 * * *";
  const morningBroadcastTime = getPreference("scheduler_morning_broadcast") || "0 9 * * *";
  const moodCheckInterval = getPreference("scheduler_mood_check") || "0 */3 * * *";

  registerTask("morning_planning", morningPlanningTime, morningPlanningHandler);
  registerTask("morning_broadcast", morningBroadcastTime, morningBroadcastHandler);
  registerTask("mood_check", moodCheckInterval, moodCheckHandler);
}

export default { registerTask, cancelTask, listTasks, initScheduler };