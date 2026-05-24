import { synthesizeText, getAudioUrlPath } from "./tts.js";
import { callClaude, callClaudeStream, parseResponse } from "./claudio.js";
import { buildPrompt } from "./context.js";
import { searchSongs, playSong, controlPlayback } from "./music/netease.js";
import { broadcastState } from "./api/ws.js";
import { saveMessage } from "./db.js";
import { getCurrentWeather } from "./external/weather.js";
import { getTodayEvents } from "./external/calendar.js";

// ── Intent classification ─────────────────────────────────────────────────────

// 直接音乐指令：消息以这些前缀开头时，直接搜索播放
const DIRECT_MUSIC_PREFIXES = [
  "播放", "放一首", "放首", "来首", "放", "唱首", "听首",
  "play ",
];

// 对话式音乐请求关键词：在同一条消息中同时出现"想听"+"歌/音乐"时仍走 DJ
const CONVERSATION_PATTERNS = [
  /想听.*(?:歌|音乐|曲|什么|推荐)/,
  /推荐.*(?:歌|音乐|曲|歌曲)/,
  /(?:来点|来些).*(?:歌|音乐)/,
  /有什么.*(?:歌|音乐|曲)/,
  /心情.*(?:歌|音乐|曲)/,
  /(?:放首|放一首|来一首).*(?:适合|符合)/,
];

function classifyIntent(message) {
  const trimmed = message.trim().toLowerCase();

  // 检查是否为对话式请求（走 DJ）
  for (const pattern of CONVERSATION_PATTERNS) {
    if (pattern.test(message)) return "chat_message";
  }

  // 检查消息中间是否包含音乐指令关键词（如"来首轻松的音乐"）
  if (/(?:^|\s)(?:来首|放\s|播放\s|唱首|听首)\b.*(?:音乐|歌|曲|轻松|浪漫)/i.test(message)) {
    return "music_command";
  }

  // 检查是否为直接音乐指令
  for (const prefix of DIRECT_MUSIC_PREFIXES) {
    if (trimmed.startsWith(prefix.toLowerCase())) return "music_command";
  }

  // 包含明确播放关键词
  if (/^(?:play|song|music|listen)\b/i.test(trimmed)) return "music_command";

  return "chat_message";
}

function extractMusicQuery(message) {
  let query = message.trim();
  for (const prefix of DIRECT_MUSIC_PREFIXES) {
    if (query.toLowerCase().startsWith(prefix.toLowerCase())) {
      query = query.slice(prefix.length).trim();
      break;
    }
  }
  return query || message.trim();
}

// ── Music command routing ─────────────────────────────────────────────────────

async function handleMusicCommand(query) {
  const searchQuery = extractMusicQuery(query);
  if (!searchQuery) {
    return { error: "no_query", message: "请输入你想听的歌曲名称" };
  }

  const result = await searchSongs(searchQuery);
  if (result.status !== "ok" || result.songs.length === 0) {
    return { error: "no_results", message: `没有找到"${searchQuery}"相关的歌曲` };
  }

  const song = result.songs[0];
  const playResult = await playSong(song);

  if (playResult.status !== "ok") {
    return { error: playResult.status, message: `无法播放${song.title}，${playResult.error}` };
  }

  // 广播播放状态，让前端更新播放器 UI
  broadcastState({ state: "playing", track: song, position: 0 });

  return {
    song,
    allSongs: result.songs,
    audioUrl: playResult.url || null,
    message: `正在播放：${song.title} - ${song.artist}`,
  };
}

// ── Chat routing ──────────────────────────────────────────────────────────────

async function handleChatMessage(message) {
  saveMessage("user", message);

  const { prompt } = await buildPrompt(message);
  const response = await callClaude(prompt, message);

  const replyText = response.params?.text
    || response.params?.say
    || response.params?.reason
    || response.action;
  saveMessage("assistant", replyText);

  return response;
}

// ── Action dispatcher ──────────────────────────────────────────────────────────

async function executeAction(action) {
  switch (action.action) {
    case "play_music": {
      const query = action.params?.query || "中文流行";
      const result = await handleMusicCommand(query);
      if (result.error) {
        return { ok: false, error: result.error, message: result.message };
      }
      return { ok: true, type: "music", ...result };
    }

    case "say": {
      const text = action.params?.text || "";
      if (!text) return { ok: false, error: "no text to say" };
      try {
        const { hash } = await synthesizeText(text);
        const audioUrl = getAudioUrlPath(hash);
        return { ok: true, type: "tts", text, audioUrl };
      } catch (err) {
        return { ok: false, type: "tts", text, error: err.message };
      }
    }

    case "announce_weather": {
      try {
        const weather = await getCurrentWeather();
        const text = weather.error
          ? "无法获取天气信息"
          : `今天天气：${weather.temperature}度，${weather.condition}，${weather.city}`;
        const { hash } = await synthesizeText(text);
        return { ok: true, type: "tts", text, audioUrl: getAudioUrlPath(hash) };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    case "announce_schedule": {
      try {
        const events = await getTodayEvents();
        let text;
        if (!events || events.length === 0) {
          text = "今天没有日程安排";
        } else {
          text = "今天的日程：";
          for (const ev of events) {
            const time = ev.startTime ? ev.startTime.split("T")[1]?.slice(0, 5) || "" : "";
            text += `${time} ${ev.title}。`;
          }
        }
        const { hash } = await synthesizeText(text);
        return { ok: true, type: "tts", text, audioUrl: getAudioUrlPath(hash) };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    case "mood_check": {
      const text = action.params?.text || "你今天心情怎么样？";
      try {
        const { hash } = await synthesizeText(text);
        return { ok: true, type: "tts", text, audioUrl: getAudioUrlPath(hash) };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    case "control_player": {
      const { command, volume } = action.params || {};

      if (command && command !== "skip") {
        try {
          await controlPlayback(command);
        } catch {
          // ncm-cli 控制失败不阻塞
        }
      }

      broadcastState({
        state: command === "pause" ? "paused" : command === "resume" || command === "play" ? "playing" : "stopped",
        track: null,
        position: 0,
      });
      return { ok: true, type: "control", command, volume };
    }

    default:
      return { ok: false, error: `Unknown action: ${action.action}` };
  }
}

// ── DJ compound response handler ──────────────────────────────────────────────

/**
 * 处理完整的 DJ 复合响应 {say, play[], reason, segue}
 * TTS 和音乐搜索并行执行以加速响应。
 */
async function executeDjResponse(djParams) {
  const results = [];
  const { say, play, reason, segue } = djParams;

  // 并行执行 TTS 和第一个音乐搜索（占响应时间的绝大部分）
  const ttsPromise = say
    ? synthesizeText(say)
        .then(({ hash }) => ({ ok: true, type: "tts", text: say, audioUrl: getAudioUrlPath(hash), step: "say" }))
        .catch((err) => ({ ok: false, type: "tts", text: say, error: err.message, step: "say" }))
    : Promise.resolve(null);

  const firstMusicPromise =
    play && Array.isArray(play) && play.length > 0
      ? (async () => {
          const item = play[0];
          const query = typeof item === "string" ? item : item.query || item.keyword || "";
          if (!query) return null;
          const musicResult = await handleMusicCommand(query);
          if (musicResult.error) {
            return { ok: false, type: "music", query, error: musicResult.error, message: musicResult.message, step: "play[0]" };
          }
          broadcastState({ state: "playing", track: musicResult.song, position: 0 });
          return { ok: true, type: "music", query, ...musicResult, step: "play[0]" };
        })()
      : Promise.resolve(null);

  // 等待 TTS 和第一首歌并行完成
  const [ttsResult, firstMusicResult] = await Promise.all([ttsPromise, firstMusicPromise]);

  if (ttsResult) results.push(ttsResult);
  if (firstMusicResult) results.push(firstMusicResult);

  // 后续歌曲串行执行（不阻塞主响应）
  if (play && Array.isArray(play) && play.length > 1) {
    for (let i = 1; i < play.length; i++) {
      const item = play[i];
      const query = typeof item === "string" ? item : item.query || item.keyword || "";
      if (!query) continue;
      const musicResult = await handleMusicCommand(query);
      if (musicResult.error) {
        results.push({ ok: false, type: "music", query, error: musicResult.error, message: musicResult.message, step: `play[${i}]` });
      } else {
        results.push({ ok: true, type: "music", query, ...musicResult, step: `play[${i}]` });
      }
    }
  }

  // 推荐理由和过渡语
  if (reason) results.push({ ok: true, type: "reason", text: reason, step: "reason" });
  if (segue) results.push({ ok: true, type: "segue", text: segue, step: "segue" });

  return results;
}

// ── Stream router (SSE) ───────────────────────────────────────────────────────

/**
 * 流式路由：通过 SSE 向前端推送 text delta，action 完成后返回 action
 * 音乐播放由前端控制（等待 TTS 完成后才开始）
 */
export async function routeMessageStream(message, emitter) {
  const intent = classifyIntent(message);

  // 直接音乐指令：立即返回 music 事件
  if (intent === "music_command") {
    const result = await handleMusicCommand(message);
    emitter.emit("music", { ok: !result.error, ...result });
    emitter.emit("done", {});
    return;
  }

  // 对话：先保存用户消息，再流式调用 Claude
  saveMessage("user", message);
  const { prompt } = await buildPrompt(message);

  let fullText = "";

  // Claude 流式输出，收集完整响应（不推送给前端，避免显示原始 JSON）
  await callClaudeStream(prompt, message, {
    onTextDelta: (delta) => {
      fullText += delta;
    },
  });

  // Claude 响应完成，解析 action 并保存
  const response = parseResponse(fullText);
  const replyText = response.params?.say || response.params?.text || response.params?.reason || fullText;
  const sayText = response.params?.say || response.params?.text || "";
  saveMessage("assistant", replyText);

  // 打印回复内容
  console.log(`[router] Claude 回复: ${replyText}`);

  // 先发送 action 事件（前端立即开始 TTS 播报）
  emitter.emit("action", response);

  // 流式推送干净的 say 文本（用于前端视觉渐进展示）
  if (sayText) {
    for (let i = 0; i < sayText.length; i += 5) {
      const chunk = sayText.slice(i, i + 5);
      emitter.emit("text", { delta: chunk, done: false });
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  emitter.emit("text", { delta: "", done: true });

  // 如果是音乐指令，异步执行并在完成后关闭 SSE 连接
  if (response.action === "play_music" || response.action === "dj_response") {
    handleMusicStream(response, emitter)
      .catch((err) => {
        console.error(`[router] handleMusicStream error: ${err.message}`);
      })
      .finally(() => {
        emitter.emit("done", {});
        emitter.close();
      });
  } else {
    emitter.emit("done", {});
    emitter.close();
  }
}

/**
 * 处理音乐相关的流式 action
 */
async function handleMusicStream(response, emitter) {
  if (response.action === "play_music") {
    const query = response.params?.query || "中文流行";
    const result = await handleMusicCommand(query);
    if (!result.error) {
      emitter.emit("music", { ok: true, ...result });
    }
    return;
  }

  if (response.action === "dj_response" && response.params?.play?.length > 0) {
    const items = response.params.play;
    const queries = items
      .map((item) => (typeof item === "string" ? item : item.query || item.keyword || ""))
      .filter(Boolean);

    if (queries.length === 0) return;

    // 第一首歌：同步获取（优先，立即播放）
    const first = await handleMusicCommand(queries[0]);

    // 剩余歌曲：并行获取（用于播放队列）
    const rest =
      queries.length > 1
        ? await Promise.all(queries.slice(1).map((q) => handleMusicCommand(q).catch(() => null)))
        : [];

    if (!first.error) {
      emitter.emit("music", {
        ok: true,
        ...first,
        queue: rest
          .filter((r) => r && !r.error)
          .map((r) => ({ song: r.song, audioUrl: r.audioUrl, message: r.message })),
      });
    }
  }
}

// ── Main router ───────────────────────────────────────────────────────────────

export async function routeMessage(message) {
  const intent = classifyIntent(message);

  // 直接音乐指令
  if (intent === "music_command") {
    const result = await handleMusicCommand(message);
    return { intent, actionResult: { type: "music", ok: !result.error, ...result } };
  }

  // 对话 — 走 Claude DJ
  const response = await handleChatMessage(message);

  // DJ 复合响应 {say, play[], reason, segue}
  if (response.action === "dj_response" && response.params) {
    const djResults = await executeDjResponse(response.params);
    // 优先取 music 类型结果作为 actionResult，确保前端能触发播放
    const musicResult = djResults.find((r) => r.type === "music" && r.ok);
    return {
      intent: "chat_message",
      response,
      actionResult: musicResult || djResults[0] || null,
      actionResults: djResults,
    };
  }

  // 普通 action（含 say）
  const execResult = await executeAction(response);

  return {
    intent: "chat_message",
    response,
    actionResult: execResult,
    actionResults: [execResult],
  };
}

export async function dispatchAction(action) {
  return executeAction(action);
}

export default { routeMessage, dispatchAction };
