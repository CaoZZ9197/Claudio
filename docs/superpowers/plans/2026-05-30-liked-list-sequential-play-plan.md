# 喜欢列表顺序播放实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户点击喜欢列表中的歌曲后，清空队列，用喜欢列表全部歌曲作为新队列按顺序播放，播完一轮后从头循环

**Architecture:** 新增 `POST /api/liked/play` 端点处理喜欢列表播放；扩展 radio-session 支持 source=liked 模式；改造前端喜欢列表点击逻辑；修改续播逻辑支持 liked 循环

**Tech Stack:** Node.js, Express, SQLite (db.js), radio-session.js, router.js

---

## File Map

| 文件 | 职责 |
|------|------|
| `src/radio-session.js` | Session 状态管理，扩展支持 liked 模式 |
| `src/router.js` | 新增 `handleLikedPlay()`，修改 `handleContinueRadio()` |
| `src/api/routes.js` | 注册 `POST /api/liked/play` 端点 |
| `src/frontend/app.js` | 喜欢列表点击改用 `/api/liked/play` |

---

## Task 1: 扩展 radio-session 支持 liked 模式

**Files:**
- Modify: `src/radio-session.js:1-73`

- [ ] **Step 1: 修改 setSession 添加新字段**

```js
// radio-session.js 第 10-22 行，修改 setSession 函数
export function setSession(session) {
  currentSession = {
    scene: session.scene || null,
    mood: session.mood || null,
    description: session.description || null,
    context: session.context || null,
    playedIds: session.playedIds || [],
    queue: session.queue || [],
    currentTrack: session.currentTrack || null,
    searchContext: session.searchContext || null,
    startedAt: Date.now(),
    // 新增字段
    source: session.source || null,           // "liked" | "radio" | "search" | null
    likedList: session.likedList || [],        // 完整喜欢列表
    likedIndex: session.likedIndex || 0,      // 当前播放位置
  };
}
```

- [ ] **Step 2: 添加 setLikedList 辅助函数**

在 `setSession` 后添加（第 23-26 行后）：

```js
/**
 * 设置喜欢列表播放模式
 * @param {Array} list - 完整喜欢列表
 * @param {number} startIndex - 起始播放位置
 */
export function setLikedSession(list, startIndex = 0) {
  if (!currentSession) {
    setSession({});
  }
  currentSession.source = "liked";
  currentSession.likedList = list;
  currentSession.likedIndex = startIndex;
}
```

- [ ] **Step 3: 添加 getLikedSession 辅助函数**

```js
export function getLikedSession() {
  if (!currentSession || currentSession.source !== "liked") {
    return null;
  }
  return {
    list: currentSession.likedList,
    index: currentSession.likedIndex,
  };
}
```

- [ ] **Step 4: 更新 default export**

```js
export default { getSession, setSession, clearSession, addPlayedSong, setQueue, getQueue, dequeueNext, clearQueue, needsRefill, getPlayedIds, setLikedSession, getLikedSession };
```

- [ ] **Step 5: 提交**

```bash
git add src/radio-session.js
git commit -m "feat: extend radio-session with liked mode support"
```

---

## Task 2: 新增 handleLikedPlay 函数

**Files:**
- Modify: `src/router.js:1-1016`

- [ ] **Step 1: 在 router.js 顶部导入 setLikedSession, getLikedSession**

找到 `import { getSession, setSession, clearSession, addPlayedSong, getPlayedIds, clearQueue } from "./radio-session.js";`
改为：
```js
import { getSession, setSession, clearSession, addPlayedSong, getPlayedIds, clearQueue, setLikedSession, getLikedSession } from "./radio-session.js";
```

- [ ] **Step 2: 在 router.js 底部（`handleMusicStream` 函数之前）添加 handleLikedPlay 函数**

```js
// ── Liked list play handler ──────────────────────────────────────────────────

/**
 * 处理喜欢列表点击播放
 * @param {string} sourceId - 点击的歌曲 sourceId
 * @returns {Object} { ok, song, audioUrl, queue, message }
 */
export async function handleLikedPlay(sourceId) {
  const allLiked = getLikedSongs(100, 0);

  if (!allLiked || allLiked.length === 0) {
    return { ok: false, error: "no_liked_songs", message: "喜欢列表为空" };
  }

  // 找到点击歌曲在列表中的位置
  const clickedIndex = allLiked.findIndex((s) => String(s.source_id) === String(sourceId));
  if (clickedIndex === -1) {
    return { ok: false, error: "song_not_found", message: "歌曲不在喜欢列表中" };
  }

  // 重组队列：从点击位置开始，后续歌曲 → 前面歌曲
  const queueSongs = [];
  for (let i = 0; i < allLiked.length; i++) {
    const idx = (clickedIndex + i) % allLiked.length;
    queueSongs.push(allLiked[idx]);
  }

  const firstSong = queueSongs[0];
  const restSongs = queueSongs.slice(1);

  // 获取第一首的播放 URL
  const playResult = await playSong({
    encryptedId: firstSong.encryptedId || firstSong.source_id,
    originalId: firstSong.source_id,
  });

  if (playResult.status !== "ok") {
    return { ok: false, error: playResult.status, message: `无法播放${firstSong.title}，${playResult.error}` };
  }

  addPlayedSong(firstSong.source_id);

  // 解锁剩余歌曲（并行）
  for (const s of restSongs) {
    unlockSong({
      encryptedId: s.encryptedId || s.source_id,
      originalId: s.source_id,
    }).catch(() => {});
  }

  // 构建队列
  const queue = restSongs.map((s) => ({
    song: {
      id: s.source_id,
      encryptedId: s.encryptedId || s.source_id,
      originalId: s.source_id,
      title: s.title,
      artist: s.artist,
      album: s.album || "",
      coverUrl: s.coverUrl || "",
      duration: s.duration || 0,
    },
    audioUrl: null,
    message: `即将播放：${s.title} - ${s.artist}`,
  }));

  // 设置 liked session（从第二首开始，因为第一首已经开始播放）
  const likedListForSession = queueSongs.map((s) => ({
    id: s.source_id,
    encryptedId: s.encryptedId || s.source_id,
    originalId: s.source_id,
    title: s.title,
    artist: s.artist,
    album: s.album || "",
    coverUrl: s.coverUrl || "",
    duration: s.duration || 0,
  }));

  // 清空旧队列，设置 liked session
  clearQueue();
  setLikedSession(likedListForSession, 1); // 下一首从 index 1 开始

  return {
    ok: true,
    song: {
      id: firstSong.source_id,
      encryptedId: firstSong.encryptedId || firstSong.source_id,
      originalId: firstSong.source_id,
      title: firstSong.title,
      artist: firstSong.artist,
      album: firstSong.album || "",
      coverUrl: firstSong.coverUrl || "",
      duration: firstSong.duration || 0,
    },
    audioUrl: playResult.url || null,
    queue,
    message: `正在播放：${firstSong.title} - ${firstSong.artist}`,
    source: "liked",
    likedList: likedListForSession,
  };
}
```

- [ ] **Step 3: 在 router.js 底部添加 getLikedSongs 导入**

找到 `import { saveMessage, getPlayedSongIds } from "./db.js";`
改为：
```js
import { saveMessage, getPlayedSongIds, getLikedSongs } from "./db.js";
```

- [ ] **Step 4: 提交**

```bash
git add src/router.js
git commit -m "feat: add handleLikedPlay function"
```

---

## Task 3: 注册 POST /api/liked/play 端点

**Files:**
- Modify: `src/api/routes.js:1-424`

- [ ] **Step 1: 在 routes.js 顶部导入 handleLikedPlay**

找到 `import { routeMessage, routeMessageStream, dispatchAction, handleContinueRadio } from "../router.js";`
改为：
```js
import { routeMessage, routeMessageStream, dispatchAction, handleContinueRadio, handleLikedPlay } from "../router.js";
```

- [ ] **Step 2: 在 routes.js 中添加 POST /api/liked/play 端点（在 GET /api/liked 之后）**

在第 288 行后（`router.get("/liked", ...)` 之后）添加：

```js
// ── POST /api/liked/play ─────────────────────────────────────────────────────

router.post("/liked/play", async (req, res) => {
  const { sourceId } = req.body;

  if (!sourceId) {
    return res.status(400).json({ ok: false, error: "sourceId is required" });
  }

  try {
    const result = await handleLikedPlay(sourceId);

    if (!result.ok) {
      return res.status(400).json(result);
    }

    // 更新 playerState
    playerState.playing = result.song;
    playerState.state = "playing";
    playerState.position = 0;
    broadcastState({ state: "playing", track: result.song, position: 0 });

    res.json({
      ok: true,
      song: result.song,
      audioUrl: result.audioUrl,
      queue: result.queue,
      message: result.message,
      source: result.source,
      likedList: result.likedList,
    });
  } catch (err) {
    console.error(`[api/liked/play] Error: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});
```

- [ ] **Step 3: 提交**

```bash
git add src/api/routes.js
git commit -m "feat: add POST /api/liked/play endpoint"
```

---

## Task 4: 修改 handleContinueRadio 支持 liked 循环

**Files:**
- Modify: `src/router.js:393-452`

- [ ] **Step 1: 修改 handleContinueRadio 函数**

找到 `handleContinueRadio` 函数（约在第 399 行），在函数开头添加 liked 模式检查：

```js
export async function handleContinueRadio() {
  const session = getSession();

  // 如果是喜欢列表模式，从 likedList 续播
  if (session?.source === "liked" && session.likedList?.length > 0) {
    return handleContinueFromLikedList(session);
  }

  // 原有的 radio 续播逻辑
  const prompt = await buildContinuePrompt(session);
  // ... 后续不变
}
```

- [ ] **Step 2: 在 router.js 中添加 handleContinueFromLikedList 函数（在 handleContinueRadio 之后）**

```js
// ── Liked list continuation ─────────────────────────────────────────────────

/**
 * 从喜欢列表续播
 */
function handleContinueFromLikedList(session) {
  const liked = session.likedList || [];
  const currentIndex = session.likedIndex || 0;
  const playedIds = new Set(session.playedIds || []);

  // 从 currentIndex 开始构建队列
  const queue = [];
  let attempts = 0;
  const maxAttempts = liked.length * 2; // 防止死循环

  while (queue.length < 5 && attempts < maxAttempts) {
    attempts++;
    const song = liked[currentIndex % liked.length];
    if (!playedIds.has(song.originalId)) {
      queue.push({
        song,
        audioUrl: null,
        message: `即将播放：${song.title} - ${song.artist}`,
      });
      playedIds.add(song.originalId); // 暂时标记为已播放，避免同一首歌重复入队
    }
    // 更新 index（循环）
    const nextIndex = (currentIndex + 1) % liked.length;
    if (nextIndex === currentIndex) break; // 只有一首歌的情况
    session.likedIndex = nextIndex;
  }

  return {
    queue,
    session: { description: "喜欢列表", source: "liked", likedList: liked },
    say: null,
    reason: null,
  };
}
```

- [ ] **Step 3: 提交**

```bash
git add src/router.js
git commit -m "feat: support liked list continuation in handleContinueRadio"
```

---

## Task 5: 改造前端喜欢列表点击逻辑

**Files:**
- Modify: `src/frontend/app.js:1161-1194`

- [ ] **Step 1: 找到喜欢列表点击处理代码**

在 app.js 第 1161-1194 行，找到这段代码：

```js
likedList.addEventListener("click", (e) => {
  const removeBtn = e.target.closest(".liked-item-remove");
  if (removeBtn) {
    // ... 删除逻辑不变 ...
    return;
  }
  const item = e.target.closest(".liked-item");
  if (item) {
    const sourceId = item.dataset.sourceId;
    const title = item.querySelector(".liked-item-title").textContent;
    const artist = item.querySelector(".liked-item-artist").textContent;
    fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: `播放 ${title} ${artist}` }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.actionResult?.audioUrl) {
          playAudio(data.actionResult.audioUrl);
        }
      })
      .catch(() => {});
  }
});
```

- [ ] **Step 2: 替换为新的 `/api/liked/play` 调用**

替换为：

```js
likedList.addEventListener("click", (e) => {
  const removeBtn = e.target.closest(".liked-item-remove");
  if (removeBtn) {
    e.stopPropagation();
    const sourceId = removeBtn.dataset.sourceId;
    fetch(`${API_BASE}/api/liked/${sourceId}`, { method: "DELETE" })
      .then(() => loadLikedSongs(likedSearchInput?.value || ""))
      .catch(() => {});
    if (currentSong?.originalId === sourceId) {
      btnLiked.textContent = "♡";
      btnLiked.classList.remove("liked");
    }
    return;
  }
  const item = e.target.closest(".liked-item");
  if (item) {
    const sourceId = item.dataset.sourceId;
    fetch(`${API_BASE}/api/liked/play`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceId }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && data.audioUrl) {
          // 清空旧队列
          musicQueue = [];
          fetchGeneration++;
          // 设置新队列
          if (data.queue && data.queue.length > 0) {
            musicQueue = data.queue.map((q) => ({
              id: q.song.originalId,
              title: q.song.title,
              artist: q.song.artist,
              audioUrl: q.audioUrl,
            }));
          }
          // 播放
          playAudio(data.audioUrl);
          // 更新当前歌曲
          currentSong = data.song;
          // 关闭抽屉
          closeLikedDrawer();
        }
      })
      .catch(() => {});
  }
});
```

- [ ] **Step 3: 提交**

```bash
git add src/frontend/app.js
git commit -m "feat: use /api/liked/play for liked list clicks"
```

---

## Task 6: 验证

**验证步骤：**

1. 启动服务器：`npm run dev`
2. 打开前端，进入喜欢列表
3. 点击任意一首歌曲
4. 确认：
   - 歌曲正确播放
   - 队列更新为完整喜欢列表（从点击位置开始）
   - 不再是旧的搜索结果队列
5. 等待歌曲播放完，确认自动续播喜欢列表下一首
6. 播完一轮后，确认从头循环

**预期输出：**
- 点击喜欢列表中的第 3 首，队列 = [第3首, 第4首, ..., 第N首, 第1首, 第2首]
- 播完最后一首后，下一首是第 1 首

---

## 完成

Plan complete and saved to `docs/superpowers/plans/2026-05-30-liked-list-sequential-play-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?