import { callClaude, callClaudeStream, parseResponse } from "./claudio.js";
import { buildPrompt, buildContinuePrompt } from "./context.js";
import { searchSongs, playSong, controlPlayback, unlockSong } from "./music/netease.js";

import { broadcastState, broadcast, broadcastAudio, broadcastTtsStart, broadcastTtsEnd, broadcastTtsError } from "./api/ws.js";
import { getTTS } from "./tts-adapter.js";
import { getSession, setSession, clearSession, addPlayedSong, getPlayedIds, clearQueue } from "./radio-session.js";
import config from "./config.js";
import { saveMessage, getPlayedSongIds } from "./db.js";
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

// 切换歌曲类型指令：用户想换风格/类型/心情（优先于对话模式检查）
const SWITCH_MUSIC_PATTERNS = [
  /换首|换个|换点|换种|切换|来点别的|不想听|[换切]一|[换切]些|不要这个|听点别的|来点新/,
  /不想听.*(?:这个|[歌音乐曲]|了)/,
  /(?:来点别的|听点别的).*(?:歌|[音乐曲])/,
];

function classifyIntent(message) {
  const trimmed = message.trim().toLowerCase();

  // 检查是否为切换歌曲类型指令（优先于对话模式，因为"来点别的音乐"应切换而非闲聊）
  for (const pattern of SWITCH_MUSIC_PATTERNS) {
    if (pattern.test(message)) return "switch_music_type";
  }

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

function extractSwitchKeyword(message) {
  // 剥掉切换指令词，提取目标音乐类型
  const switchWords = /^(?:换首|换个|切换|来点别的|不想听|[换切]一|[换切]些|不要这个|听点别的|来点新|换种|换点|切到)/;
  let keyword = message.trim().replace(switchWords, "").trim();
  // 去掉常见后缀词和语气词
  keyword = keyword.replace(/[的了呢吧吗啊]$/, "").trim();
  keyword = keyword.replace(/^(?:这个|这首|那种|这种)/, "").trim();
  return keyword || message.trim();
}

// ── Music command routing ─────────────────────────────────────────────────────

async function handleMusicCommand(query, opts = {}) {
  const searchQuery = extractMusicQuery(query);
  if (!searchQuery) {
    return { error: "no_query", message: "请输入你想听的歌曲名称" };
  }

  const { excludeIds = [], radioMode = false } = opts;

  // 合并：会话级 excludeIds + 数据库中最近 N 天已播放的 songId
  const dbPlayedIds = getPlayedSongIds(config.playHistoryDays);
  const mergedExcludeIds = [...new Set([...excludeIds, ...dbPlayedIds])];

  const searchLimit = radioMode ? 50 : 30;
  const result = await searchSongs(searchQuery, searchLimit, mergedExcludeIds);
  if (result.status !== "ok" || result.songs.length === 0) {
    return { error: "no_results", message: `没有找到"${searchQuery}"相关的歌曲` };
  }

  const song = result.songs[0];
  const playResult = await playSong(song);

  if (playResult.status !== "ok") {
    return { error: playResult.status, message: `无法播放${song.title}，${playResult.error}` };
  }

  addPlayedSong(song.originalId);

  // 构建队列（搜索结果除第一首外）
  const queueSongs = result.songs.slice(1);
  const queue = queueSongs.map((s) => ({
    song: s,
    audioUrl: null,
    message: `即将播放：${s.title} - ${s.artist}`,
  }));

  // 检测场景是否变化，变化时需要停止旧音频并替换队列
  const existingSession = getSession();
  const isSceneChange = !!(existingSession && existingSession.scene);

  // 立即广播，让前端停止旧音频
  broadcastState({ state: "playing", track: song, position: 0, shouldStopCurrent: isSceneChange });

  return {
    song,
    allSongs: result.songs,
    audioUrl: playResult.url || null,
    message: `正在播放：${song.title} - ${song.artist}`,
    replaceQueue: isSceneChange,
    queue,
  };
}

// ── Switch music type handler ──────────────────────────────────────────────────

async function handleSwitchMusicType(message) {
  const keyword = extractSwitchKeyword(message);

  // 清空当前队列并停止播放
  clearQueue();
  broadcastState({ state: "stopped", track: null, position: 0, shouldStopCurrent: true });

  // 获取已播放 ID 用于去重
  const excludeIds = getPlayedIds();

  // 搜索新类型歌曲（电台模式：至少 5 首，排除已播放）
  const result = await handleMusicCommand(keyword, { excludeIds, radioMode: true });
  if (result.error) {
    return { error: result.error, message: result.message };
  }

  // 确保至少 5 首：如果搜索结果不足，尝试用更宽泛的关键词补充
  const queue = result.queue || [];
  const totalSongs = 1 + queue.length; // 第一首 + 队列
  if (totalSongs < 5) {
    const additionalExcludes = [...excludeIds, result.song.originalId];
    const supplementResult = await searchSongs(keyword, 20, additionalExcludes);
    if (supplementResult.status === "ok") {
      const existingIds = new Set([result.song.originalId, ...queue.map((q) => q.song.originalId)]);
      for (const s of supplementResult.songs) {
        if (!existingIds.has(s.id) && queue.length < 9) {
          queue.push({ song: s, audioUrl: null, message: `即将播放：${s.title} - ${s.artist}` });
          existingIds.add(s.id);
        }
      }
    }
  }

  // 同步调用 Claude 生成简短过渡语
  let transitionText = `好的，为你切换成${keyword}风格的歌曲`;
  try {
    const { prompt } = await buildPrompt(message);
    const fullText = await new Promise((resolve, reject) => {
      let text = "";
      callClaudeStream(prompt, `[系统切换请求] 用户说："${message}"。请用一句话简短回复（15字以内），像电台DJ一样自然地过渡到新歌曲类型。不要返回JSON，直接回复文本。`, {
        onTextDelta: (delta) => { text += delta; },
      }).then(() => resolve(text)).catch(reject);
    });
    // 清理可能的 JSON 标记
    const cleaned = fullText.replace(/```[\s\S]*?```/g, "").replace(/[{}]/g, "").trim();
    if (cleaned && cleaned.length > 0 && cleaned.length < 50) {
      transitionText = cleaned;
    }
  } catch {
    // 使用默认过渡语
  }

  return {
    ok: true,
    song: result.song,
    audioUrl: result.audioUrl,
    message: result.message,
    queue,
    replaceQueue: true,
    say: transitionText,
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
      return { ok: true, type: "tts", text };
    }

    case "announce_weather": {
      try {
        const weather = await getCurrentWeather();
        const text = weather.error
          ? "无法获取天气信息"
          : `今天天气：${weather.temperature}度，${weather.condition}，${weather.city}`;
        return { ok: true, type: "tts", text };
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
        return { ok: true, type: "tts", text };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    case "mood_check": {
      const text = action.params?.text || "你今天心情怎么样？";
      return { ok: true, type: "tts", text };
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
  const { say, play, reason, segue, session: sessionInfo } = djParams;

  // 更新 session（仅当与当前不同时）
  const existingSession2 = getSession();
  if (sessionInfo?.scene) {
    if (!existingSession2 || existingSession2.scene !== sessionInfo.scene) {
      const firstQuery = play?.[0]
        ? (typeof play[0] === "string" ? play[0] : play[0].query || play[0].keyword || "")
        : "";
      setSession({
        scene: sessionInfo.scene,
        mood: sessionInfo.mood || null,
        description: sessionInfo.description || null,
        context: firstQuery,
        playedIds: [],
      });
    }
  } else if (sessionInfo && !existingSession2) {
    setSession({
      scene: sessionInfo.description || sessionInfo.mood || "default",
      mood: sessionInfo.mood || null,
      description: sessionInfo.description || null,
      context: "",
      playedIds: [],
    });
  }

  // TTS 文本直接返回（非 streaming 路径不实际播放音频）
  const ttsResult = say
    ? { ok: true, type: "tts", text: say, step: "say" }
    : null;

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
          return { ok: true, type: "music", query, ...musicResult, step: "play[0]", replaceQueue: true, session: sessionInfo };
        })()
      : Promise.resolve(null);

  // 等待第一个音乐搜索完成（TTS 文本已直接返回）
  const firstMusicResult = await firstMusicPromise;

  if (ttsResult) results.push(ttsResult);
  if (firstMusicResult) results.push(firstMusicResult);

  // 后续歌曲并行获取
  if (play && Array.isArray(play) && play.length > 1) {
    const restResults = await Promise.all(
      play.slice(1).map(async (item, i) => {
        const query = typeof item === "string" ? item : item.query || item.keyword || "";
        if (!query) return null;
        try {
          const musicResult = await handleMusicCommand(query);
          if (musicResult.error) {
            return { ok: false, type: "music", query, error: musicResult.error, message: musicResult.message, step: `play[${i + 1}]` };
          }
          return { ok: true, type: "music", query, ...musicResult, step: `play[${i + 1}]` };
        } catch (err) {
          return { ok: false, type: "music", query, error: err.message, step: `play[${i + 1}]` };
        }
      })
    );
    for (const r of restResults) {
      if (r) results.push(r);
    }
  }

  // 推荐理由和过渡语
  if (reason) results.push({ ok: true, type: "reason", text: reason, step: "reason" });
  if (segue) results.push({ ok: true, type: "segue", text: segue, step: "segue" });

  return results;
}

// ── Radio continuation ────────────────────────────────────────────────────────

/**
 * 续播请求处理：当队列即将耗尽时，由前端调用。
 * 根据当前电台 session（或默认品味）请求更多歌曲。
 */
export async function handleContinueRadio() {
  const session = getSession();
  const prompt = await buildContinuePrompt(session);

  let fullText = "";
  await callClaudeStream(prompt, "[系统自动续播]", {
    onTextDelta: (delta) => {
      fullText += delta;
    },
  });

  const response = parseResponse(fullText);

  // 提取搜索结果
  const queries = [];
  if (response.action === "dj_response" && response.params?.play) {
    for (const item of response.params.play) {
      const q = typeof item === "string" ? item : item.query || item.keyword || "";
      if (q) queries.push(q);
    }
  } else if (response.action === "play_music" && response.params?.query) {
    queries.push(response.params.query);
  }

  if (queries.length === 0) {
    // Claude 没有返回可播放的歌曲，尝试用默认搜索
    queries.push(session?.scene ? `${session.scene} 背景音乐` : "中文流行");
  }

  // 同步获取第一首，并行获取剩余（传入已播放 ID 用于去重）
  const excludeIds = session ? (session.playedIds || []) : [];
  const first = await handleMusicCommand(queries[0], { excludeIds, radioMode: true });
  const rest =
    queries.length > 1
      ? await Promise.all(queries.slice(1).map((q) => handleMusicCommand(q, { excludeIds, radioMode: true }).catch(() => null)))
      : [];

  const queue = [];
  if (first && !first.error) {
    queue.push({ song: first.song, audioUrl: first.audioUrl, message: first.message });
  }
  for (const r of rest) {
    if (r && !r.error) {
      queue.push({ song: r.song, audioUrl: r.audioUrl, message: r.message });
    }
  }

  return {
    queue,
    session: session ? { description: session.description } : null,
    say: response.params?.say || null,
    reason: response.params?.reason || null,
  };
}

// ── TTS streaming helper ─────────────────────────────────────────────────────

/**
 * 检测文本是否为问候语
 */
function isGreeting(text) {
  if (!text) return false;
  const greetings = ["你好", "您好", "hi", "hello", "嗨", "嘿"];
  const trimmed = text.trim().toLowerCase();
  return greetings.some((g) => trimmed.startsWith(g));
}

/**
 * 判断是否应该触发 TTS 语音播报
 * 首次问候不触发 TTS（服务重启后第一句"你好"只有文字）
 */
let isFirstGreeting = true;

function shouldSpeakTts(text) {
  if (isFirstGreeting && isGreeting(text)) {
    isFirstGreeting = false;
    return false;
  }
  return true;
}

/**
 * 通过 MiniMax WebSocket 合成语音并流式推送到前端
 * 发送 tts_start / tts_end / tts_error 信令协调音乐暂停恢复
 */
async function streamTtsSay(text, emotion) {
  if (!text || text.trim() === "") return;

  if (!shouldSpeakTts(text)) {
    return;
  }

  console.log(`[router] streamTtsSay called, text: "${text.slice(0, 40)}...", emotion: ${emotion || "none"}`);

  broadcastTtsStart(text);

  const ttsEngine = getTTS();

  try {
    const t0 = Date.now();
    await ttsEngine.synthesize(text.trim(), (chunk) => {
      broadcastAudio(chunk);
    }, emotion);
    console.log(`[router] [timing] TTS synthesize: ${Date.now() - t0}ms`);
    broadcastTtsEnd(true);
  } catch (err) {
    console.error(`[router] TTS failed: ${err.message}`);
    broadcastTtsError(err.message);
    throw err;
  }
}

// ── Music stream preparation (parallel with TTS) ────────────────────────────────

/**
 * 纯 I/O 阶段：搜索歌曲并获取播放 URL，无副作用。
 * 与 TTS 合成并行执行，返回预取数据供 TTS 完成后提交。
 */
async function prepareMusicStreamData(response) {
  if (response.action === "play_music") {
    const query = response.params?.query || "中文流行";
    const searchResult = await searchSongs(query, 30);
    if (searchResult.status !== "ok" || searchResult.songs.length === 0) {
      return { type: "play_music", error: "no_results", query };
    }
    const song = searchResult.songs[0];
    // 立即后台解锁，不阻塞（与 TTS 并行）
    unlockSong(song);
    return {
      type: "play_music",
      song,
      allSongs: searchResult.songs,
      audioUrl: `/api/audio/${song.originalId}`,
      query,
    };
  }

  if (response.action === "dj_response" && response.params?.play?.length > 0) {
    const items = response.params.play;
    const queries = items
      .map((item) => (typeof item === "string" ? item : item.query || item.keyword || ""))
      .filter(Boolean);

    const t0 = Date.now();
    const results = await Promise.all(
      queries.map(async (query, index) => {
        const tSearch = Date.now();
        const searchResult = await searchSongs(query, 30);
        console.log(`[router] [timing] searchSongs[${index}] "${query}": ${Date.now() - tSearch}ms, songs: ${searchResult.songs?.length || 0}`);
        if (searchResult.status !== "ok" || searchResult.songs.length === 0) {
          return { error: "no_results", query };
        }
        const song = searchResult.songs[0];
        // 只解锁第一首歌，后续歌曲在播放时才解锁，减少响应延迟
        if (index === 0) {
          unlockSong(song);
        }
        return {
          song,
          allSongs: searchResult.songs,
          audioUrl: `/api/audio/${song.originalId}`,
          query,
        };
      })
    );
    console.log(`[router] [timing] prepareMusicStreamData (dj_response): ${Date.now() - t0}ms, ${queries.length} queries`);

    return {
      type: "dj_response",
      results,
      queries,
      params: response.params,
    };
  }

  return null;
}

/**
 * 副作用阶段：TTS 完成后提交音乐数据。
 * 执行 mpv 播放、session 更新、broadcastState、SSE music 事件发送。
 */
async function commitMusicStreamAndEmit(musicData, emitter) {
  if (!musicData) return;

  if (musicData.type === "play_music") {
    if (musicData.error) return;
    const { song, allSongs, audioUrl } = musicData;

    // mpv 已在 prepareMusicStreamData → unlockSong 中触发过，这里只做 addPlayedSong 和广播
    addPlayedSong(song.originalId);
    broadcastState({ state: "playing", track: song, position: 0 });
    emitter.emit("music", {
      ok: true,
      song,
      allSongs,
      audioUrl,
      message: `正在播放：${song.title} - ${song.artist}`,
      replaceQueue: true,
      queue: [],
    });
    return;
  }

  if (musicData.type === "dj_response") {
    const { results, params } = musicData;
    const valid = results.filter((r) => !r.error);
    if (valid.length === 0) return;

    const first = valid[0];
    const rest = valid.slice(1);

    // Session management
    const sessionInfo = params.session || null;
    const existingSession = getSession();
    if (sessionInfo?.scene) {
      const isNewScene = !existingSession || existingSession.scene !== sessionInfo.scene;
      if (isNewScene) {
        setSession({
          scene: sessionInfo.scene,
          mood: sessionInfo.mood || null,
          description: sessionInfo.description || null,
          context: first.query,
          playedIds: [],
        });
      }
    } else if (sessionInfo && !existingSession) {
      setSession({
        scene: sessionInfo.description || sessionInfo.mood || "default",
        mood: sessionInfo.mood || null,
        description: sessionInfo.description || null,
        context: first.query,
        playedIds: [],
      });
    }

    // mpv 已在 prepareMusicStreamData → unlockSong 中触发过，这里只做 addPlayedSong 和广播
    addPlayedSong(first.song.originalId);
    const curSession = getSession();
    broadcastState({ state: "playing", track: first.song, position: 0 });

    const queue = rest.map((r) => ({
      song: r.song,
      audioUrl: r.audioUrl,
      message: `即将播放：${r.song.title} - ${r.song.artist}`,
    }));

    emitter.emit("music", {
      ok: true,
      song: first.song,
      allSongs: first.allSongs,
      audioUrl: first.audioUrl,
      message: `正在播放：${first.song.title} - ${first.song.artist}`,
      replaceQueue: true,
      queue,
      session: sessionInfo || (curSession ? { description: curSession.description } : null),
    });
  }
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

  // 切换歌曲类型：清空队列 + 停止播放 + 搜索新歌 + DJ 过渡语
  if (intent === "switch_music_type") {
    saveMessage("user", message);
    const result = await handleSwitchMusicType(message);
    if (result.error) {
      emitter.emit("text", { delta: result.message, done: false });
      emitter.emit("text", { delta: "", done: true });
      emitter.emit("done", {});
      emitter.close();
      return;
    }
    saveMessage("assistant", result.say);
    // 发送 action 事件
    emitter.emit("action", { action: "play_music", params: { query: extractSwitchKeyword(message) } });
    const sayText = result.say;

    // 并行：TTS 语音合成 + 文本流式推送
    const ttsPromise = sayText
      ? streamTtsSay(sayText).catch((err) => {
          broadcastTtsError(err.message)
        })
      : Promise.resolve();

    if (sayText) {
      emitter.emit("text", { delta: sayText, done: false });
    }
    emitter.emit("text", { delta: "", done: true });

    // 等待 TTS 完成后再发送音乐事件
    await ttsPromise;

    // 发送音乐事件（含 message 字段，前端用于展示"正在播放"）
    emitter.emit("music", { ok: true, ...result });
    emitter.emit("done", {});
    emitter.close();
    return;
  }

  // 对话：先保存用户消息，再流式调用 Claude
  saveMessage("user", message);

  const t0 = Date.now();
  const { prompt, staticContent, dynamicContent } = await buildPrompt(message);
  console.log(`[router] [timing] buildPrompt: ${Date.now() - t0}ms`);

  let fullText = "";

  // Claude 流式输出（使用 Prompt Caching 拆分格式降低首 token 延迟）
  const t1 = Date.now();
  await callClaudeStream({ staticContent, dynamicContent }, message, {
    onTextDelta: (delta) => {
      fullText += delta;
    },
  });
  console.log(`[router] [timing] claudeStream: ${Date.now() - t1}ms, chars: ${fullText.length}`);

  // Claude 响应完成，解析 action 并保存
  const response = parseResponse(fullText);
  const replyText = response.params?.say || response.params?.text || response.params?.reason || fullText;
  const sayText = response.params?.say || response.params?.text || "";
  saveMessage("assistant", replyText);

  // 打印回复内容
  console.log(`[router] Claude 回复: ${replyText}`);

  // 发送 action 事件
  emitter.emit("action", response);

  // 发送文本到前端
  if (sayText) {
    emitter.emit("text", { delta: sayText, done: false });
  }
  emitter.emit("text", { delta: "", done: true });

  // 并行：TTS 合成 + 歌曲检索/解锁
  const t2 = Date.now();
  const ttsPromise = sayText
    ? streamTtsSay(sayText, response.params?.emotion).catch(() => {})
    : Promise.resolve();

  const isMusicAction = response.action === "play_music" || response.action === "dj_response";
  const musicPrepPromise = isMusicAction
    ? prepareMusicStreamData(response)
    : Promise.resolve(null);

  // 等待 TTS 合成和歌曲数据准备同时完成
  const [ttsResult, musicData] = await Promise.all([ttsPromise, musicPrepPromise]);
  console.log(`[router] [timing] TTS+MusicPrep: ${Date.now() - t2}ms (TTS: ${ttsResult?.duration || 'N/A'}ms, Music: ${musicData ? 'ok' : 'null'})`);

  // TTS 完成后，提交音乐播放副作用
  if (musicData) {
    const t3 = Date.now();
    try {
      await commitMusicStreamAndEmit(musicData, emitter);
      console.log(`[router] [timing] commitMusicStreamAndEmit: ${Date.now() - t3}ms`);
    } catch (err) {
      console.error(`[router] commitMusicStreamAndEmit error: ${err.message}`);
    }
  }

  emitter.emit("done", {});
  emitter.close();
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
    const params = response.params;
    const items = params.play;
    const queries = items
      .map((item) => (typeof item === "string" ? item : item.query || item.keyword || ""))
      .filter(Boolean);

    if (queries.length === 0) return;

    // 用户主动对话产生的音乐响应，始终替换队列
    // session 信息用于后续续播定位，不影响替换决策
    const sessionInfo = params.session || null;
    const existingSession = getSession();

    if (sessionInfo?.scene) {
      const isNewScene = !existingSession || existingSession.scene !== sessionInfo.scene;
      if (isNewScene) {
        setSession({
          scene: sessionInfo.scene,
          mood: sessionInfo.mood || null,
          description: sessionInfo.description || null,
          context: queries[0],
          playedIds: [],
        });
      }
    } else if (sessionInfo && !existingSession) {
      setSession({
        scene: sessionInfo.description || sessionInfo.mood || "default",
        mood: sessionInfo.mood || null,
        description: sessionInfo.description || null,
        context: queries[0],
        playedIds: [],
      });
    }

    // 第一首歌：同步获取（优先，立即播放）
    const first = await handleMusicCommand(queries[0]);

    // 剩余歌曲：并行获取（用于播放队列）
    const rest =
      queries.length > 1
        ? await Promise.all(queries.slice(1).map((q) => handleMusicCommand(q).catch(() => null)))
        : [];

    if (!first.error) {
      // 用户主动对话产生的音乐 → 始终替换队列
      const curSession = getSession();
      emitter.emit("music", {
        ok: true,
        ...first,
        replaceQueue: true,
        session: sessionInfo || (curSession ? { description: curSession.description } : null),
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
    return { intent, actionResult: { type: "music", ok: !result.error, ...result }, queue: [] };
  }

  // 切换歌曲类型
  if (intent === "switch_music_type") {
    const result = await handleSwitchMusicType(message);
    if (result.error) {
      return { intent, response: null, actionResult: { type: "music", ok: false, ...result }, queue: [] };
    }
    return {
      intent: "switch_music_type",
      response: { action: "play_music", params: { query: extractSwitchKeyword(message), text: result.say } },
      actionResult: { type: "music", ok: true, ...result },
      queue: result.queue || [],
      replaceQueue: true,
    };
  }

  // 对话 — 走 Claude DJ
  const response = await handleChatMessage(message);

  // DJ 复合响应 {say, play[], reason, segue}
  if (response.action === "dj_response" && response.params) {
    const djResults = await executeDjResponse(response.params);
    // 提取所有成功的音乐结果，第一首作为 actionResult，其余作为播放队列
    const musicResults = djResults.filter((r) => r.type === "music" && r.ok);
    const queue = musicResults.slice(1).map((r) => ({
      song: r.song,
      audioUrl: r.audioUrl,
      message: r.message,
    }));
    const curSession = getSession();
    return {
      intent: "chat_message",
      response,
      actionResult: musicResults[0] || djResults[0] || null,
      actionResults: djResults,
      queue,
      replaceQueue: true,  // 用户主动对话产生的音乐 → 始终替换队列
      session: musicResults[0]?.session || (curSession ? { description: curSession.description } : null),
    };
  }

  // 普通 action（含 say）
  const execResult = await executeAction(response);

  return {
    intent: "chat_message",
    response,
    actionResult: execResult,
    actionResults: [execResult],
    queue: [],
  };
}

export async function dispatchAction(action) {
  return executeAction(action);
}

export default { routeMessage, dispatchAction };
