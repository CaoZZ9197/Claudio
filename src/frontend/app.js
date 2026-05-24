const API_BASE = "";
const WS_URL = `ws://${window.location.host}/stream`;

// ── State ─────────────────────────────────────────────────────────────────────

let ws = null;
let audioEl = document.getElementById("audio-player");
let isConnected = false;
let pendingAudioChunks = [];
let currentAudioBlobUrl = null;
let musicQueue = [];          // 待播放歌曲队列
let isMusicPlaying = false;   // 当前是否正在播放音乐（区别于 TTS）

// ── Tab Navigation ────────────────────────────────────────────────────────────

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`panel-${btn.dataset.tab}`).classList.add("active");
  });
});

// ── WebSocket ─────────────────────────────────────────────────────────────────

function connectWS() {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  ws = new WebSocket(WS_URL);

  ws.addEventListener("open", () => {
    isConnected = true;
    console.log("[ws] Connected");
  });

  ws.addEventListener("message", (event) => {
    if (typeof event.data === "string") {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "state") {
          handlePlayerState(msg);
        }
      } catch {
        // ignore
      }
    } else if (event.data instanceof Blob) {
      // Binary audio chunk (TTS streaming)
      if (!isMusicPlaying) {
        handleAudioChunk(event.data);
      }
    }
  });

  ws.addEventListener("close", () => {
    isConnected = false;
    console.log("[ws] Disconnected, reconnecting in 3s...");
    setTimeout(connectWS, 3000);
  });

  ws.addEventListener("error", () => {
    ws.close();
  });
}

function handlePlayerState(state) {
  const { state: playerState, track } = state;

  if (playerState === "stopped") {
    // 只停止 TTS 音频，不干扰音乐播放
    if (!isMusicPlaying) {
      audioEl.pause();
    }
  }

  if (track) {
    updateNowPlaying(track, playerState);
  }
}

// ── Audio chunk buffering (WebSocket binary TTS) ──────────────────────────────

function handleAudioChunk(blob) {
  pendingAudioChunks.push(blob);
}

function flushAudioChunks() {
  if (pendingAudioChunks.length === 0) return;
  const blob = new Blob(pendingAudioChunks, { type: "audio/mpeg" });
  releaseCurrentAudioUrl();
  currentAudioBlobUrl = URL.createObjectURL(blob);
  audioEl.src = currentAudioBlobUrl;
  audioEl.play().catch((err) => console.warn("[audio] Play failed:", err.message));
  pendingAudioChunks = [];
}

function releaseCurrentAudioUrl() {
  if (currentAudioBlobUrl) {
    URL.revokeObjectURL(currentAudioBlobUrl);
    currentAudioBlobUrl = null;
  }
}

// Flush TTS chunks only when audio is paused (streaming mode)
setInterval(() => {
  if (pendingAudioChunks.length > 0 && audioEl.paused && !isMusicPlaying) {
    flushAudioChunks();
  }
}, 500);

connectWS();

// ── Audio Playback ─────────────────────────────────────────────────────────────

audioEl.addEventListener("ended", () => {
  updateNowPlaying(null, "stopped");
  isMusicPlaying = false;
  // 播放队列中的下一首
  playNextInQueue();
});

audioEl.addEventListener("timeupdate", updateProgressBar);
audioEl.addEventListener("loadedmetadata", updateProgressBar);

/**
 * 播放音频 URL。
 * 先 removeAttribute('src') 确保浏览器完全释放旧源，再设置新 src。
 * 这是 HTML5 Audio 切换音源的已知最佳实践。
 */
function playAudio(url) {
  if (!url) return;

  console.log("[audio] playAudio called:", url);
  pendingAudioChunks = [];
  releaseCurrentAudioUrl();

  // 先暂停并移除 src，确保旧源完全释放
  audioEl.pause();
  audioEl.removeAttribute("src");

  // 微任务延迟后再设新源，给浏览器时间清理旧状态
  setTimeout(() => {
    audioEl.src = url;
    isMusicPlaying = true;
    audioEl.play().then(() => {
      console.log("[audio] Now playing:", url);
    }).catch((err) => console.warn("[audio] Play failed:", err.message));
  }, 50);
}

/**
 * 播放音乐队列中的下一首
 */
function playNextInQueue() {
  if (musicQueue.length === 0) {
    isMusicPlaying = false;
    return;
  }
  const next = musicQueue.shift();
  if (next.audioUrl) {
    if (next.song) updateNowPlaying(next.song, "playing");
    playAudio(next.audioUrl);
  }
}

function updateProgressBar() {
  const bar = document.getElementById("progress-bar");
  const currentTimeEl = document.getElementById("current-time");
  const totalTimeEl = document.getElementById("total-time");

  if (!audioEl.duration || isNaN(audioEl.duration)) {
    bar.value = 0;
    currentTimeEl.textContent = "0:00";
    totalTimeEl.textContent = "0:00";
    return;
  }

  bar.max = Math.floor(audioEl.duration);
  bar.value = Math.floor(audioEl.currentTime);
  currentTimeEl.textContent = formatTime(audioEl.currentTime);
  totalTimeEl.textContent = formatTime(audioEl.duration);
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
  if (audioEl.duration && isFinite(audioEl.duration)) {
    audioEl.currentTime = progressBar.value;
  }
});

// ── Now Playing Updates ───────────────────────────────────────────────────────

function updateNowPlaying(track, state) {
  const titleEl = document.getElementById("track-title");
  const artistEl = document.getElementById("track-artist");
  const playerTitleEl = document.getElementById("player-track-title");
  const playerArtistEl = document.getElementById("player-track-artist");
  const albumArtEl = document.getElementById("album-art");
  const playBtn = document.getElementById("btn-play");

  if (track) {
    titleEl.textContent = track.title || "未知歌曲";
    artistEl.textContent = track.artist || "未知艺术家";
    playerTitleEl.textContent = track.title || "未知歌曲";
    playerArtistEl.textContent = track.artist || "未知艺术家";
    albumArtEl.textContent = "🎵";
  } else {
    titleEl.textContent = "Claudio AI Radio";
    artistEl.textContent = "等待播放...";
    playerTitleEl.textContent = "等待播放";
    playerArtistEl.textContent = "-";
    albumArtEl.textContent = "🎵";
  }

  if (state === "playing") {
    playBtn.textContent = "⏸";
  } else {
    playBtn.textContent = "▶";
  }
}

// ── Player Controls ────────────────────────────────────────────────────────────

document.getElementById("btn-play").addEventListener("click", () => togglePlay());
document.getElementById("btn-player-play").addEventListener("click", () => togglePlay());
document.getElementById("btn-volume").addEventListener("click", () => {
  audioEl.muted = !audioEl.muted;
});

const volumeSlider = document.getElementById("volume-slider");
volumeSlider.addEventListener("input", () => {
  audioEl.volume = volumeSlider.value / 100;
  fetch(`${API_BASE}/api/player/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ volume: volumeSlider.value }),
  }).catch(() => {});
});

function togglePlay() {
  if (audioEl.paused) {
    audioEl.play().catch(() => {});
  } else {
    audioEl.pause();
  }
  const command = audioEl.paused ? "pause" : "resume";
  fetch(`${API_BASE}/api/player/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command }),
  }).catch(() => {});
}

// ── TTS Fallback: Browser SpeechSynthesis ─────────────────────────────────────

/**
 * 使用浏览器内置语音合成作为 Fish Audio 的降级方案。
 * 支持中文语音，自动选择合适的语音。
 */
function speakWithBrowserTts(text) {
  if (!window.speechSynthesis) {
    console.warn("[tts] Browser SpeechSynthesis not available");
    return;
  }

  // 取消正在进行的语音
  window.speechSynthesis.cancel();

  // Chrome bug: cancel() 后立即 speak() 会静默失败，需要延迟执行
  setTimeout(() => {
    const utterance = new SpeechSynthesisUtterance(text);

    // 选择中文语音
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
      isSpeaking = false;
      ttsComplete = true;
      if (pendingMusicData) {
        const data = pendingMusicData;
        pendingMusicData = null;
        if (data.audioUrl) {
          playAudio(data.audioUrl);
        }
      }
    };

    utterance.onerror = (ev) => {
      console.warn("[tts] Browser speech error:", ev.error);
      isSpeaking = false;
      ttsComplete = true;
      if (pendingMusicData) {
        const data = pendingMusicData;
        pendingMusicData = null;
        if (data.audioUrl) {
          playAudio(data.audioUrl);
        }
      }
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
  thinkingIndicator.querySelector("span").textContent = "Claudio正在思考...";

  // 清空队列（新对话开启新播放列表）
  musicQueue = [];

  try {
    const es = new ChatEventSource(`${API_BASE}/api/chat/stream`, message);
    let assistantMsg = null;

    es.on("text", ({ delta, done }) => {
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
      if (data.ok && data.song) {
        updateNowPlaying(data.song, "playing");

        // 将后续歌曲加入播放队列
        if (data.queue && data.queue.length > 0) {
          musicQueue.push(...data.queue);
        }
        if (data.audioUrl) {
          playAudio(data.audioUrl);
        }
        if (data.message) {
          addMessage("system", `🎵 ${data.message}`);
        }
      }
    });

    es.on("done", () => {});

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
  const div = document.createElement("div");
  div.className = `message ${role}`;
  div.innerHTML = `<div class="message-content">${escapeHtml(content)}</div>`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
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
          musicQueue = [];
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

// ── Register Service Worker ───────────────────────────────────────────────────

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch((err) => {
    console.warn("[sw] Registration failed:", err.message);
  });
}
