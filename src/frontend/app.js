const API_BASE = "";
const WS_URL = `ws://${window.location.host}/stream`;

// ── State ─────────────────────────────────────────────────────────────────────

let ws = null;
let mainAudioEl = document.getElementById("audio-player");
let ttsAudioEl = document.getElementById("tts-player");
let isConnected = false;
let ttsPendingChunks = [];
let ttsBlobUrl = null;
let lastTtsText = ""; // 保存 TTS 文本用于降级播放
let musicQueue = [];          // 待播放歌曲队列
let isMusicPlaying = false;   // 当前是否正在播放音乐（区别于 TTS）
let fetchGeneration = 0;      // 续播请求代际，队列替换时递增，过期响应直接丢弃
let isTtsActive = false;         // TTS 语音播报进行中
let pendingMusicData = null;      // TTS 期间到达的 music 事件数据（延迟播放）

// ── Pixel Avatars ────────────────────────────────────────────────────────────

const AVATAR_CLAUDIO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges" class="avatar avatar-assistant">
  <rect x="7" y="0" width="2" height="1"/>
  <rect x="4" y="1" width="8" height="1"/>
  <rect x="2" y="2" width="2" height="4"/>
  <rect x="12" y="2" width="2" height="4"/>
  <rect x="5" y="2" width="6" height="1"/>
  <rect x="5" y="3" width="6" height="1"/>
  <rect x="6" y="3" width="2" height="2"/>
  <rect x="9" y="3" width="2" height="2"/>
  <rect x="5" y="5" width="6" height="1"/>
  <rect x="5" y="6" width="6" height="1"/>
  <rect x="7" y="6" width="2" height="1"/>
  <rect x="6" y="7" width="4" height="1"/>
</svg>`;

const AVATAR_USER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges" class="avatar avatar-user">
  <rect x="6" y="1" width="4" height="1"/>
  <rect x="5" y="2" width="6" height="2"/>
  <rect x="6" y="3" width="2" height="1"/>
  <rect x="9" y="3" width="2" height="1"/>
  <rect x="6" y="4" width="4" height="1"/>
  <rect x="7" y="5" width="2" height="1"/>
  <rect x="4" y="6" width="8" height="1"/>
  <rect x="3" y="7" width="10" height="2"/>
</svg>`;

// ── WebSocket ─────────────────────────────────────────────────────────────────

function connectWS() {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  // 显式关闭旧连接，防止僵尸 WebSocket 导致音频 chunk 重复
  if (ws) {
    try { ws.close(); } catch (_) {}
    ws = null;
  }

  ws = new WebSocket(WS_URL);

  ws.addEventListener("open", () => {
    isConnected = true;
    console.log("[ws] Connected, readyState:", ws.readyState, "total clients will be counted server-side");
  });

  ws.addEventListener("message", (event) => {
    if (typeof event.data === "string") {
      try {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case "state":
            handlePlayerState(msg);
            break;
          case "tts_start":
            handleTtsStart(msg);
            break;
          case "tts_end":
            handleTtsEnd();
            break;
          case "tts_error":
            handleTtsError(msg);
            break;
        }
      } catch {
        // ignore
      }
    } else if (event.data instanceof Blob) {
      // Binary audio chunk (TTS streaming)
      handleTtsAudioChunk(event.data);
    }
  });

  ws.addEventListener("close", () => {
    isConnected = false;
    console.log("[ws] Disconnected, reconnecting in 3s...");
    setTimeout(connectWS, 3000);
  });

  ws.addEventListener("error", (e) => {
    e.target.close();
  });
}

// 页面卸载时主动关闭 WebSocket，防止僵尸连接
window.addEventListener("beforeunload", () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }
});

function handlePlayerState(state) {
  const { state: playerState, track, shouldStopCurrent } = state;

  // 场景切换时：立即停止旧音频
  if (shouldStopCurrent) {
    mainAudioEl.pause();
    mainAudioEl.removeAttribute("src");
    console.log("[audio] State broadcast with shouldStopCurrent - stopped current");
  }

  if (playerState === "stopped") {
    // 只停止 TTS 音频，不干扰音乐播放
    if (!isMusicPlaying) {
      mainAudioEl.pause();
    }
  }

  if (track) {
    updateNowPlaying(track, playerState);
  }
}

// ── TTS lifecycle handlers ────────────────────────────────────────────────────

function handleTtsStart({ text }) {
  console.log("[tts] MiniMax TTS starting:", text?.slice(0, 40));
  isTtsActive = true;
  ttsPendingChunks = [];
  lastTtsText = text || "";
  // 先停止当前播放的 TTS 音频，再释放 Blob URL
  if (!ttsAudioEl.paused) {
    ttsAudioEl.pause();
    ttsAudioEl.removeAttribute("src");
  }
  releaseTtsBlobUrl();

  // 压低音乐音量（ducking），不暂停
  mainAudioEl.volume = (volumeSlider.value / 100) * 0.3;
}

function handleTtsEnd() {
  // 防重入：若非活跃 TTS 会话，忽略重复的 tts_end 事件
  if (!isTtsActive) {
    console.log("[tts] handleTtsEnd called but TTS not active, ignoring");
    return;
  }
  console.log("[tts] MiniMax TTS ended, starting playback");
  isTtsActive = false;

  if (ttsPendingChunks.length > 0) {
    lastTtsText = "";
    // 所有 chunk 已收齐，合并为单个 Blob 一次性播放
    const totalSize = ttsPendingChunks.reduce((sum, c) => sum + c.size, 0);
    console.log("[tts] Creating blob from", ttsPendingChunks.length, "chunks, total size:", totalSize, "bytes");
    const blob = new Blob(ttsPendingChunks, { type: "audio/mpeg" });
    console.log("[tts] Blob created, size:", blob.size, "bytes");
    releaseTtsBlobUrl();
    ttsBlobUrl = URL.createObjectURL(blob);
    ttsAudioEl.src = ttsBlobUrl;
    ttsPendingChunks = [];
    ttsAudioEl.play().catch((err) => {
      console.warn("[tts] Play failed, retrying in 500ms:", err.message);
      setTimeout(() => {
        ttsAudioEl.play().catch((e) => console.warn("[tts] Retry failed:", e.message));
      }, 500);
    }).then(() => {
      console.log("[tts] Audio started playing, duration:", ttsAudioEl.duration, "s");
    });
  } else if (lastTtsText) {
    console.warn("[tts] No audio chunks received, using browser TTS fallback");
    speakWithBrowserTts(lastTtsText);
    lastTtsText = "";
  }
  // 音频播完后 ended 事件触发 finishTts()
}

function handleTtsError({ error }) {
  console.warn("[tts] MiniMax TTS error:", error);
  isTtsActive = false;
  finishTts();
}

/**
 * 统一音乐播放逻辑：更新 UI、替换/追加队列、播放音频
 */
function processMusicAction(data) {
  if (!data.ok || !data.song) return;

  // 场景切换：停止旧音频
  if (data.shouldStopCurrent) {
    mainAudioEl.pause();
    mainAudioEl.removeAttribute("src");
    console.log("[audio] Scene change - stopped current");
  }

  // 替换或追加队列
  if (data.replaceQueue) {
    musicQueue = [];
    fetchGeneration++;
  }

  // 更新"正在播放"显示
  updateNowPlaying(data.song, "playing");

  // 更新电台模式标签
  if (data.session?.description) {
    updateSessionLabel(data.session.description);
  }

  // 追加队列
  if (data.queue && data.queue.length > 0) {
    musicQueue.push(...data.queue);
    renderQueue();
  }

  // 播放音频
  if (data.audioUrl) {
    playAudio(data.audioUrl);
  }
}

// ── Audio chunk buffering (WebSocket binary TTS) ──────────────────────────────

function handleTtsAudioChunk(blob) {
  ttsPendingChunks.push(blob);
  console.log("[tts] Chunk received:", blob.size, "bytes, total chunks:", ttsPendingChunks.length);
}

function releaseTtsBlobUrl() {
  if (ttsBlobUrl) {
    URL.revokeObjectURL(ttsBlobUrl);
    ttsBlobUrl = null;
  }
}

connectWS();

// TTS 音频播放完毕或浏览器 TTS 播完后，恢复音量并处理 pending 音乐
function finishTts() {
  console.log("[tts] TTS playback fully finished");
  lastTtsText = "";
  mainAudioEl.volume = volumeSlider.value / 100;
  if (pendingMusicData) {
    const data = pendingMusicData;
    pendingMusicData = null;
    processMusicAction(data);
  }
}

// TTS 一次性播放完毕后，恢复音量并播放音乐
ttsAudioEl.addEventListener("ended", () => {
  console.log("[tts] TTS audio playback finished, duration:", ttsAudioEl.duration, "s, currentTime:", ttsAudioEl.currentTime);
  finishTts();
});

// ── Audio Playback ─────────────────────────────────────────────────────────────

mainAudioEl.addEventListener("ended", () => {
  updateNowPlaying(null, "stopped");
  isMusicPlaying = false;
  playNextInQueue();
});

mainAudioEl.addEventListener("play", () => {
  updatePlayButtons("playing");
});

mainAudioEl.addEventListener("pause", () => {
  updatePlayButtons("paused");
});

mainAudioEl.addEventListener("error", () => {
  const err = mainAudioEl.error;
  console.warn("[audio] Element error:", err?.code, err?.message, "src:", mainAudioEl.src);
  isMusicPlaying = false;
  updatePlayButtons("paused");
});

mainAudioEl.addEventListener("timeupdate", updateProgressBar);
mainAudioEl.addEventListener("loadedmetadata", updateProgressBar);

/**
 * 播放音频 URL。
 * 先 removeAttribute('src') 确保浏览器完全释放旧源，再设置新 src。
 * 这是 HTML5 Audio 切换音源的已知最佳实践。
 */
function playAudio(url) {
  if (!url) return;

  console.log("[audio] playAudio called:", url);
  isMusicPlaying = true;
  ttsPendingChunks = [];
  releaseTtsBlobUrl();

  // 先暂停并移除 src，确保旧源完全释放
  mainAudioEl.pause();
  mainAudioEl.removeAttribute("src");

  // 微任务延迟后再设新源，给浏览器时间清理旧状态
  mainAudioEl.src = url;
  mainAudioEl.play().then(() => {
    console.log("[audio] Now playing:", url);
  }).catch((err) => {
    console.warn("[audio] Play failed:", err.message, "url:", url);
    isMusicPlaying = false;
  });
}

/**
 * 播放音乐队列中的下一首，队列快空时自动续播
 */
function playNextInQueue() {
  if (musicQueue.length === 0) {
    isMusicPlaying = false;
    renderQueue();
    // 队列耗尽，自动请求更多歌曲
    fetchMoreSongs();
    return;
  }
  // 只剩 1 首时预加载更多（不阻塞当前播放）
  if (musicQueue.length === 1) {
    fetchMoreSongs();
  }
  const next = musicQueue.shift();
  renderQueue();
  // 队列歌曲的 audioUrl 可能为 null（延迟获取），根据 song.originalId 构造
  const audioUrl = next.audioUrl || (next.song?.originalId ? `/api/audio/${next.song.originalId}` : null);
  if (audioUrl) {
    if (next.song) updateNowPlaying(next.song, "playing");
    playAudio(audioUrl);
  }
}

/**
 * 自动续播：从服务端获取更多匹配当前电台会话的歌曲。
 * 使用代际计数器防止旧请求污染已替换的队列。
 */
let isFetchingMore = false;

async function fetchMoreSongs() {
  if (isFetchingMore) return; // 防止并发请求
  isFetchingMore = true;

  const myGeneration = fetchGeneration; // 记录发起请求时的代际

  try {
    const res = await fetch(`${API_BASE}/api/radio/continue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json();

    // 请求期间队列被替换过了，丢弃过期响应
    if (myGeneration !== fetchGeneration) {
      console.log("[radio] fetchMoreSongs discarded (generation changed)");
      return;
    }

    if (data.ok && data.queue && data.queue.length > 0) {
      musicQueue.push(...data.queue);
      renderQueue();

      // 更新会话显示
      if (data.session?.description) {
        updateSessionLabel(data.session.description);
      }

      // 如果当前没有在播放，立即开始播放第一首
      if (!isMusicPlaying && musicQueue.length > 0) {
        const next = musicQueue.shift();
        renderQueue();
        const audioUrl = next.audioUrl || (next.song?.originalId ? `/api/audio/${next.song.originalId}` : null);
        if (next.song) updateNowPlaying(next.song, "playing");
        if (audioUrl) playAudio(audioUrl);
      }
    }
  } catch (err) {
    console.warn("[radio] fetchMoreSongs failed:", err.message);
  } finally {
    isFetchingMore = false;
  }
}

/**
 * 更新电台模式标签
 */
function updateSessionLabel(description) {
  const label = document.getElementById("session-label");
  if (label) {
    label.textContent = description || "";
    label.hidden = !description;
  }
}

/**
 * 渲染播放队列 UI
 */
function renderQueue() {
  const section = document.getElementById("queue-section");
  const list = document.getElementById("queue-list");
  if (!section || !list) return;

  if (musicQueue.length === 0) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  list.innerHTML = musicQueue.map((item, i) => {
    const title = item.song?.title || "未知歌曲";
    const artist = item.song?.artist || "";
    return `<div class="queue-item"><span class="queue-idx">${i + 1}</span><span class="queue-title">${escapeHtml(title)}</span><span class="queue-artist">${escapeHtml(artist)}</span></div>`;
  }).join("");
}

function updateProgressBar() {
  const bar = document.getElementById("progress-bar");
  const currentTimeEl = document.getElementById("current-time");
  const totalTimeEl = document.getElementById("total-time");

  if (!mainAudioEl.duration || isNaN(mainAudioEl.duration)) {
    bar.value = 0;
    currentTimeEl.textContent = "0:00";
    totalTimeEl.textContent = "0:00";
    return;
  }

  bar.max = Math.floor(mainAudioEl.duration);
  bar.value = Math.floor(mainAudioEl.currentTime);
  currentTimeEl.textContent = formatTime(mainAudioEl.currentTime);
  totalTimeEl.textContent = formatTime(mainAudioEl.duration);
}

function formatTime(seconds) {
  if (!isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Progress bar seek
const progressBar = document.getElementById("progress-bar");
progressBar.addEventListener("input", () => {
  if (mainAudioEl.duration && isFinite(mainAudioEl.duration)) {
    mainAudioEl.currentTime = progressBar.value;
  }
});

// ── Now Playing Updates ───────────────────────────────────────────────────────

function updateNowPlaying(track, state) {
  const playerTitleEl = document.getElementById("player-track-title");
  const playerArtistEl = document.getElementById("player-track-artist");
  const albumArtEl = document.getElementById("album-art");

  if (track) {
    playerTitleEl.textContent = track.title || "未知歌曲";
    playerArtistEl.textContent = track.artist || "未知艺术家";
    if (track.coverUrl) {
      albumArtEl.innerHTML = `<img src="${escapeHtml(track.coverUrl)}" alt="album cover" class="album-art-img" />`;
    } else {
      albumArtEl.textContent = "▶";
    }
  } else {
    playerTitleEl.textContent = "等待播放";
    playerArtistEl.textContent = "-";
    albumArtEl.innerHTML = '<span class="album-art-icon">▶</span>';
  }

  updatePlayButtons(state);
}

function updatePlayButtons(state) {
  const playBtn = document.getElementById("btn-play");
  const playerPlayBtn = document.getElementById("btn-player-play");
  if (state === "playing") {
    playBtn.textContent = "▐▐";
    playerPlayBtn.textContent = "▐▐";
  } else {
    playBtn.textContent = "►";
    playerPlayBtn.textContent = "►";
  }
}

// ── Player Controls ────────────────────────────────────────────────────────────

document.getElementById("btn-play").addEventListener("click", () => togglePlay());
document.getElementById("btn-player-play").addEventListener("click", () => togglePlay());
const btnVolume = document.getElementById("btn-volume");
if (btnVolume) {
  btnVolume.addEventListener("click", () => {
    mainAudioEl.muted = !mainAudioEl.muted;
  });
}

const volumeSlider = document.getElementById("volume-slider");
const volumeValueEl = document.getElementById("volume-value");
volumeSlider.addEventListener("input", () => {
  mainAudioEl.volume = volumeSlider.value / 100;
  if (volumeValueEl) volumeValueEl.textContent = volumeSlider.value;
  fetch(`${API_BASE}/api/player/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ volume: volumeSlider.value }),
  }).catch(() => {});
});

function togglePlay() {
  const willPlay = mainAudioEl.paused;
  if (willPlay) {
    mainAudioEl.play().catch((err) => console.warn("[audio] togglePlay play failed:", err.message));
  } else {
    mainAudioEl.pause();
  }
  fetch(`${API_BASE}/api/player/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command: willPlay ? "resume" : "pause" }),
  }).catch(() => {});
}

// ── TTS Fallback: Browser SpeechSynthesis ─────────────────────────────────────

/**
 * 使用浏览器内置语音合成作为 MiniMax TTS 的降级方案。
 */
function speakWithBrowserTts(text) {
  if (!window.speechSynthesis) {
    console.warn("[tts] Browser SpeechSynthesis not available");
    finishTts();
    return;
  }

  window.speechSynthesis.cancel();

  // Chrome bug: cancel() 后立即 speak() 会静默失败
  setTimeout(() => {
    const utterance = new SpeechSynthesisUtterance(text);

    const voices = speechSynthesis.getVoices();
    const zhVoice =
      voices.find((v) => v.lang.startsWith("zh-CN")) ||
      voices.find((v) => v.lang.startsWith("zh")) ||
      voices.find((v) => v.lang.startsWith("ja")) ||
      voices[0];

    if (zhVoice) utterance.voice = zhVoice;
    utterance.lang = "zh-CN";
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 0.9;

    utterance.onend = () => {
      console.log("[tts] Browser speech finished");
      finishTts();
    };

    utterance.onerror = (ev) => {
      console.warn("[tts] Browser speech error:", ev.error);
      finishTts();
    };

    speechSynthesis.speak(utterance);
  }, 80);
}

// 预加载语音列表（部分浏览器需要异步获取）
if (window.speechSynthesis) {
  speechSynthesis.getVoices();
  speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
}

// ── Chat ───────────────────────────────────────────────────────────────────────

const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatMessages = document.getElementById("chat-messages");
const thinkingIndicator = document.getElementById("thinking-indicator");

/**
 * 自定义 SSE 客户端，支持 POST 方法和流式事件处理
 */
class ChatEventSource {
  constructor(url, message) {
    this.url = url;
    this.message = message;
    this.reader = null;
    this.decoder = new TextDecoder();
    this.buffer = "";
    this.eventType = null;
    this.eventData = "";
    this.closed = false;
    this._listeners = {};

    this._controller = new AbortController();
    this._start();
  }

  on(event, handler) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(handler);
    return this;
  }

  off(event, handler) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter((h) => h !== handler);
  }

  close() {
    this.closed = true;
    this._controller.abort();
  }

  _emit(event, data) {
    if (this.closed) return;
    const handlers = this._listeners[event] || [];
    for (const h of handlers) {
      try { h(data); } catch (e) { console.error("[sse] handler error for", event, ":", e.message); }
    }
  }

  async _start() {
    try {
      const res = await fetch(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: this.message }),
        signal: this._controller.signal,
      });

      if (!res.ok) {
        this._emit("error", { message: `HTTP ${res.status}` });
        return;
      }

      this.reader = res.body.getReader();

      while (true) {
        const { done, value } = await this.reader.read();
        if (done) {
          break;
        }

        this.buffer += this.decoder.decode(value, { stream: true });
        this._processBuffer();
      }

      // 处理剩余缓存
      this._processBuffer();
      this._emit("done", {});
    } catch (err) {
      console.error("[sse] error:", err.message);
      if (err.name !== "AbortError") {
        this._emit("error", { message: err.message });
      }
    }
  }

  _processBuffer() {
    // 逐行处理 SSE 数据
    while (this.buffer.includes("\n")) {
      const newlineIdx = this.buffer.indexOf("\n");
      const rawLine = this.buffer.slice(0, newlineIdx);
      const line = rawLine.trim();
      this.buffer = this.buffer.slice(newlineIdx + 1);

      if (!line) {
        if (this.eventType && this.eventData) {
          try {
            const data = JSON.parse(this.eventData);
            this._emit(this.eventType, data);
          } catch (e) {
            this._emit("error", { message: `parse error: ${e.message}` });
          }
        }
        this.eventType = null;
        this.eventData = "";
        continue;
      }

      if (line.startsWith("event:")) {
        this.eventType = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        this.eventData = line.slice(5).trim();
      }
    }
  }
}

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const message = chatInput.value.trim();
  if (!message) return;

  chatInput.value = "";
  addMessage("user", message);
  thinkingIndicator.hidden = false;

  // 不在发送消息时清空队列——由 music 事件的 replaceQueue 标志控制
  // 这样纯聊天消息不会中断正在播放的音乐

  try {
    const es = new ChatEventSource(`${API_BASE}/api/chat/stream`, message);
    let assistantMsg = null;

    es.on("text", ({ delta, done }) => {
      thinkingIndicator.hidden = true;
      if (done) return;
      if (!assistantMsg) {
        assistantMsg = addMessage("assistant", "");
      }
      assistantMsg.querySelector(".message-content").textContent += delta;
      chatMessages.scrollTop = chatMessages.scrollTop;
    });

    es.on("action", (action) => {
      thinkingIndicator.hidden = true;
    });

    es.on("music", (data) => {
      thinkingIndicator.hidden = true;
      if (!data.ok || !data.song) return;

      if (isTtsActive || !ttsAudioEl.paused) {
        // TTS 进行中或还在播放，先更新 UI 但延迟音频播放
        if (data.replaceQueue) {
          musicQueue = [];
          fetchGeneration++;
        }
        updateNowPlaying(data.song, "playing");
        if (data.session?.description) {
          updateSessionLabel(data.session.description);
        }
        if (data.queue && data.queue.length > 0) {
          musicQueue.push(...data.queue);
          renderQueue();
        }
        // 保存数据，等待 TTS 完成后处理
        pendingMusicData = data;
      } else {
        processMusicAction(data);
      }

      // "正在播放"展示
      if (data.message) {
        if (assistantMsg) {
          const npDiv = document.createElement("div");
          npDiv.className = "now-playing-info";
          npDiv.textContent = data.message;
          assistantMsg.querySelector(".message-content").appendChild(npDiv);
        } else {
          addMessage("system", `🎵 ${data.message}`);
        }
      }
    });

    es.on("done", () => {
      thinkingIndicator.hidden = true;
    });

    es.on("error", ({ message }) => {
      thinkingIndicator.hidden = true;
      addMessage("assistant", `出错了: ${message}`);
    });
  } catch (err) {
    thinkingIndicator.hidden = true;
    addMessage("assistant", `出错了: ${err.message}`);
  }
});

function addMessage(role, content) {
  const msgDiv = document.createElement("div");
  msgDiv.className = `message ${role}`;
  msgDiv.innerHTML = `<div class="message-content">${escapeHtml(content)}</div>`;

  const rowDiv = document.createElement("div");
  rowDiv.className = `message-row ${role}`;

  if (role === "assistant") {
    rowDiv.insertAdjacentHTML("beforeend", AVATAR_CLAUDIO);
  } else if (role === "user") {
    rowDiv.insertAdjacentHTML("beforeend", AVATAR_USER);
  }

  rowDiv.appendChild(msgDiv);
  chatMessages.appendChild(rowDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return msgDiv;
}

function escapeHtml(text) {
  const el = document.createElement("div");
  el.textContent = text;
  return el.innerHTML;
}

// ── Music Search ───────────────────────────────────────────────────────────────

const searchInput = document.getElementById("search-input");
const btnSearch = document.getElementById("btn-search");
const searchResults = document.getElementById("search-results");

btnSearch.addEventListener("click", doSearch);
searchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });

async function doSearch() {
  const query = searchInput.value.trim();
  if (!query) return;

  searchResults.innerHTML = '<div style="color:var(--text-dim);font-size:12px;padding:8px;">搜索中...</div>';

  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: `播放${query}` }),
    });
    const data = await res.json();

    searchResults.innerHTML = "";

    const musicData = data.actionResult?.type === "music" ? data.actionResult : null;

    if (musicData?.ok && musicData.allSongs) {
      musicData.allSongs.forEach((song) => {
        const item = document.createElement("div");
        item.className = "search-result-item";
        item.innerHTML = `<div class="sr-info"><div class="sr-title">${escapeHtml(song.title)}</div><div class="sr-artist">${escapeHtml(song.artist)}</div></div>`;
        item.addEventListener("click", async () => {
          updateNowPlaying(song, "playing");
          if (musicData.replaceQueue) {
            musicQueue = [];
            fetchGeneration++;
          }
          if (musicData.session?.description) {
            updateSessionLabel(musicData.session.description);
          }
          renderQueue();
          try {
            const playRes = await fetch(`${API_BASE}/api/chat`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ message: `播放 ${song.title} ${song.artist}` }),
            });
            const playData = await playRes.json();
            if (playData.actionResult?.audioUrl) {
              playAudio(playData.actionResult.audioUrl);
            }
          } catch {}
        });
        searchResults.appendChild(item);
      });
    } else if (musicData?.ok && musicData.song) {
      const song = musicData.song;
      const item = document.createElement("div");
      item.className = "search-result-item";
      item.innerHTML = `<div class="sr-info"><div class="sr-title">${escapeHtml(song.title)}</div><div class="sr-artist">${escapeHtml(song.artist)}</div></div>`;
      item.addEventListener("click", () => {
        updateNowPlaying(song, "playing");
        playAudio(musicData.audioUrl);
      });
      searchResults.appendChild(item);
    } else {
      searchResults.innerHTML = '<div style="color:var(--text-dim);font-size:12px;padding:8px;">没有找到相关歌曲</div>';
    }

    // 处理队列（DJ 响应可能包含多首）
    if (data.queue && data.queue.length > 0) {
      if (data.replaceQueue) {
        musicQueue = [];
        fetchGeneration++;  // 递增代际，使飞行中的旧续播请求失效
      }
      musicQueue.push(...data.queue);
      renderQueue();
    }
    if (data.session?.description) {
      updateSessionLabel(data.session.description);
    }
  } catch (err) {
    searchResults.innerHTML = `<div style="color:var(--danger);font-size:12px;padding:8px;">搜索失败: ${err.message}</div>`;
  }
}

// ── Profile ───────────────────────────────────────────────────────────────────

async function loadProfile() {
  try {
    const res = await fetch(`${API_BASE}/api/history?limit=1`);
    await res.json();
  } catch {}
}

document.getElementById("btn-save-profile").addEventListener("click", async () => {
  const taste = document.getElementById("taste-editor").value;
  const moodRules = document.getElementById("mood-rules-editor").value;
  const playlists = document.getElementById("playlists-editor").value;
  const status = document.getElementById("profile-save-status");

  status.textContent = "保存中...";
  status.style.color = "var(--text-dim)";

  try {
    await fetch(`${API_BASE}/api/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taste, moodRules, playlists }),
    });
    status.textContent = "✓ 保存成功";
    status.style.color = "var(--success)";
    setTimeout(() => { status.textContent = ""; }, 3000);
  } catch (err) {
    status.textContent = `保存失败: ${err.message}`;
    status.style.color = "var(--danger)";
  }
});

// ── Settings ───────────────────────────────────────────────────────────────────

async function loadSettings() {
  try {
    const res = await fetch(`${API_BASE}/api/settings`);
    const data = await res.json();
    if (data.scheduler_morning_planning) {
      const [h, m] = data.scheduler_morning_planning.split(" ")[1].split(":");
      document.getElementById("setting-morning-planning").value =
        `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
    }
    if (data.scheduler_morning_broadcast) {
      const [h, m] = data.scheduler_morning_broadcast.split(" ")[1].split(":");
      document.getElementById("setting-morning-broadcast").value =
        `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
    }
    if (data.scheduler_mood_check) {
      const match = data.scheduler_mood_check.match(/(\d+)/);
      if (match) document.getElementById("setting-mood-check").value = match[1];
    }
  } catch {}
}

document.getElementById("btn-save-settings").addEventListener("click", async () => {
  const status = document.getElementById("settings-save-status");
  status.textContent = "保存中...";
  status.style.color = "var(--text-dim)";

  const morningPlanning = document.getElementById("setting-morning-planning").value;
  const morningBroadcast = document.getElementById("setting-morning-broadcast").value;
  const moodCheck = document.getElementById("setting-mood-check").value;

  try {
    await fetch(`${API_BASE}/api/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scheduler_morning_planning: `0 ${morningPlanning.split(":")[1]} ${morningPlanning.split(":")[0]} * * *`,
        scheduler_morning_broadcast: `0 ${morningBroadcast.split(":")[1]} ${morningBroadcast.split(":")[0]} * * *`,
        scheduler_mood_check: `0 */${moodCheck} * * *`,
      }),
    });
    status.textContent = "✓ 保存成功";
    status.style.color = "var(--success)";
    setTimeout(() => { status.textContent = ""; }, 3000);
  } catch (err) {
    status.textContent = `保存失败: ${err.message}`;
    status.style.color = "var(--danger)";
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────

loadSettings();
loadProfile();
fetchWeather();

// ── Network Status ───────────────────────────────────────────────────────────

function updateOnlineStatus() {
  const banner = document.getElementById("offline-banner");
  if (banner) banner.hidden = navigator.onLine;
}

window.addEventListener("online", updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);
updateOnlineStatus();

// ── PWA Install Prompt ──────────────────────────────────────────────────────

let deferredPrompt = null;
const btnInstall = document.getElementById("btn-install");

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  btnInstall.hidden = false;
});

btnInstall.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  console.log(`[pwa] Install ${outcome}`);
  deferredPrompt = null;
  btnInstall.hidden = true;
});

window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  btnInstall.hidden = true;
  console.log("[pwa] App installed");
});

// ── Audio Spectrum Visualizer ────────────────────────────────────────────────

let audioCtx = null;
let analyser = null;
let spectrumAnimId = null;
const spectrumCanvas = document.getElementById("spectrum-canvas");
const spectrumCtx = spectrumCanvas?.getContext("2d");

function initAudioContext() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaElementSource(mainAudioEl);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.7;
    source.connect(analyser);
    analyser.connect(audioCtx.destination);
  } catch (err) {
    console.warn("[spectrum] AudioContext init failed:", err.message);
  }
}

function drawSpectrum() {
  if (!analyser || !spectrumCtx) return;
  spectrumAnimId = requestAnimationFrame(drawSpectrum);

  const w = spectrumCanvas.width;
  const h = spectrumCanvas.height;
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  analyser.getByteFrequencyData(dataArray);

  spectrumCtx.clearRect(0, 0, w, h);

  const barCount = 32;
  const step = Math.floor(bufferLength / barCount);
  const barWidth = Math.floor((w - barCount * 2) / barCount);

  for (let i = 0; i < barCount; i++) {
    const value = dataArray[i * step] / 255;
    const barH = Math.max(4, value * h);
    const x = i * (barWidth + 2) + 2;
    const y = h - barH;

    // Green neon gradient
    const g = Math.floor(136 + value * 119);
    const r = Math.floor(value * 255);
    spectrumCtx.fillStyle = `rgb(${r},${g},${Math.floor(value * 136)})`;
    spectrumCtx.fillRect(x, y, barWidth, barH);

    // Neon glow on taller bars
    if (value > 0.5) {
      spectrumCtx.shadowColor = `rgba(0,255,136,${value * 0.6})`;
      spectrumCtx.shadowBlur = 8;
      spectrumCtx.fillRect(x, y, barWidth, 2);
      spectrumCtx.shadowBlur = 0;
    }
  }
}

function startSpectrum() {
  if (!audioCtx) initAudioContext();
  if (audioCtx?.state === "suspended") audioCtx.resume();
  if (!spectrumAnimId) drawSpectrum();
}

// Kick off AudioContext on first user interaction
document.addEventListener("click", initAudioContext, { once: true });
document.addEventListener("keydown", initAudioContext, { once: true });

// Canvas sizing
function resizeSpectrum() {
  if (!spectrumCanvas) return;
  const rect = spectrumCanvas.parentElement.getBoundingClientRect();
  spectrumCanvas.width = rect.width - 28;
  spectrumCanvas.height = 64;
}
window.addEventListener("resize", resizeSpectrum);
resizeSpectrum();

// ── Weather ──────────────────────────────────────────────────────────────────

async function fetchWeather() {
  const iconEl = document.getElementById("weather-icon");
  const infoEl = document.getElementById("weather-info");
  if (!iconEl || !infoEl) return;

  try {
    const res = await fetch(`${API_BASE}/api/weather`);
    const data = await res.json();
    if (data.ok) {
      iconEl.textContent = weatherIcon(data.icon);
      infoEl.textContent = `${data.temperature}°C  ${data.condition}  ${data.city}`;
    } else {
      iconEl.textContent = "?";
      infoEl.textContent = data.error || "天气不可用";
    }
  } catch {
    iconEl.textContent = "?";
    infoEl.textContent = "天气加载失败";
  }
}

function weatherIcon(code) {
  // OpenWeather icon codes → pixel-friendly symbols
  const map = {
    "01d": "☀", "01n": "☽",
    "02d": "◧", "02n": "◩",
    "03d": "☁", "03n": "☁",
    "04d": "☁", "04n": "☁",
    "09d": "☔", "09n": "☔",
    "10d": "☂", "10n": "☂",
    "11d": "⚡", "11n": "⚡",
    "13d": "❅", "13n": "❅",
    "50d": "≋", "50n": "≋",
  };
  return map[code] || "?";
}

// ── Lyrics ───────────────────────────────────────────────────────────────────

let currentLyrics = [];  // [{ time: seconds, text: "..." }]
let currentLyricIdx = -1;

function parseLRC(lrcText) {
  const lines = [];
  const regex = /\[(\d{2}):(\d{2})(?:[.:](\d{2,3}))?\]\s*(.*)/g;
  let match;
  while ((match = regex.exec(lrcText)) !== null) {
    const min = parseInt(match[1], 10);
    const sec = parseInt(match[2], 10);
    const ms = match[3] ? parseInt(match[3].padEnd(3, "0").slice(0, 3), 10) : 0;
    const time = min * 60 + sec + ms / 1000;
    const text = match[4].trim();
    if (text) lines.push({ time, text });
  }
  lines.sort((a, b) => a.time - b.time);
  return lines;
}

async function fetchLyrics(trackId) {
  const container = document.getElementById("lyrics-inner");
  if (!container || !trackId) {
    if (container) container.innerHTML = '<p class="lyric-line">等待播放...</p>';
    currentLyrics = [];
    return;
  }

  currentLyrics = [];
  currentLyricIdx = -1;
  container.innerHTML = '<p class="lyric-line">加载歌词中...</p>';

  try {
    const res = await fetch(`${API_BASE}/api/lyrics/${trackId}`);
    const data = await res.json();
    if (data.status === "ok" && data.lyrics) {
      currentLyrics = parseLRC(data.lyrics);
      if (currentLyrics.length === 0) {
        container.innerHTML = '<p class="lyric-line">暂无歌词</p>';
      } else {
        container.innerHTML = currentLyrics
          .map((l, i) => `<p class="lyric-line" data-idx="${i}">${escapeHtml(l.text)}</p>`)
          .join("");
      }
    } else {
      container.innerHTML = '<p class="lyric-line">暂无歌词</p>';
    }
  } catch {
    container.innerHTML = '<p class="lyric-line">歌词加载失败</p>';
  }
}

function syncLyrics(currentTime) {
  if (currentLyrics.length === 0) return;
  let idx = -1;
  for (let i = 0; i < currentLyrics.length; i++) {
    if (currentLyrics[i].time <= currentTime) idx = i;
    else break;
  }
  if (idx === currentLyricIdx) return;
  currentLyricIdx = idx;

  const container = document.getElementById("lyrics-inner");
  if (!container) return;
  const lines = container.querySelectorAll(".lyric-line");
  lines.forEach((el) => {
    const i = parseInt(el.dataset.idx, 10);
    el.classList.remove("active", "past");
    if (i < idx) el.classList.add("past");
    else if (i === idx) {
      el.classList.add("active");
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  });
}

// Hook lyrics sync into existing timeupdate
mainAudioEl.addEventListener("timeupdate", () => {
  if (currentLyrics.length > 0) {
    syncLyrics(mainAudioEl.currentTime);
  }
});

// Hook lyrics fetch into updateNowPlaying by watching for track changes
const origUpdateNowPlaying = updateNowPlaying;
updateNowPlaying = function(track, state) {
  origUpdateNowPlaying(track, state);
  if (track?.originalId) {
    fetchLyrics(track.originalId);
  } else if (!track) {
    fetchLyrics(null);
  }
  if (state === "playing") startSpectrum();
};

// ── Settings Modal ───────────────────────────────────────────────────────────

const modalOverlay = document.getElementById("modal-overlay");
const btnOpenSettings = document.getElementById("btn-open-settings");
const btnCloseModal = document.getElementById("btn-close-modal");

btnOpenSettings?.addEventListener("click", () => {
  modalOverlay.hidden = false;
});

btnCloseModal?.addEventListener("click", () => {
  modalOverlay.hidden = true;
});

modalOverlay?.addEventListener("click", (e) => {
  if (e.target === modalOverlay) modalOverlay.hidden = true;
});

// ── Register Service Worker ───────────────────────────────────────────────────

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch((err) => {
    console.warn("[sw] Registration failed:", err.message);
  });
}
