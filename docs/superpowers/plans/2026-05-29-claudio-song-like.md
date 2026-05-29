# 歌曲收藏功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Claudio 播放器页面实现"喜欢"功能，用户可一键收藏歌曲并查看喜欢列表。

**Architecture:**
- 数据层：SQLite 新建 `liked_songs` 表
- API 层：Express 新增 4 个 REST 端点
- 前端层：喜欢按钮（乐观更新）+ 侧边栏抽屉组件

**Tech Stack:** Node.js + Express + SQLite(better-sqlite3) + Vanilla JS

---

## 文件变更清单

| 文件 | 变更 |
|------|------|
| `src/db.js` | 新增 `liked_songs` 表初始化 + 5 个 CRUD 函数 |
| `src/api/routes.js` | 新增 4 个 API 端点 |
| `src/frontend/index.html` | 新增侧边栏抽屉 DOM 结构 + 喜欢按钮 |
| `src/frontend/styles.css` | 新增侧边栏抽屉样式 |
| `src/frontend/app.js` | 新增喜欢按钮、侧边栏、状态管理 |

---

## Task 1: 数据库层

**Files:**
- Modify: `src/db.js`

**Context:** Claudio 使用 better-sqlite3，数据库初始化在 db.exec() 中执行。现有表有 messages、plays、preferences。需要新增 liked_songs 表。

- [ ] **Step 1: 添加 liked_songs 表初始化**

在 `db.exec()` 的 SQL 块中，在 `preferences` 表创建语句之后添加：

```sql
CREATE TABLE IF NOT EXISTS liked_songs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT '',
  album TEXT NOT NULL DEFAULT '',
  source_id TEXT NOT NULL UNIQUE,
  liked_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- [ ] **Step 2: 添加 liked_songs CRUD 函数**

在 `src/db.js` 的 `// ── Plays ───────────────────────────────────────────────────────────────────` 注释之后、`// ── Preferences ─────────────────────────────────────────────────────────────` 注释之前添加：

```js
// ── Liked Songs ─────────────────────────────────────────────────────────────

const insertLikedSong = db.prepare(
  "INSERT OR IGNORE INTO liked_songs (title, artist, album, source_id) VALUES (@title, @artist, @album, @source_id)"
);

const deleteLikedSong = db.prepare(
  "DELETE FROM liked_songs WHERE source_id = @source_id"
);

const getLikedSongBySourceId = db.prepare(
  "SELECT * FROM liked_songs WHERE source_id = @source_id"
);

const getAllLikedSongs = db.prepare(
  "SELECT id, title, artist, album, source_id, liked_at FROM liked_songs ORDER BY liked_at DESC LIMIT @limit OFFSET @offset"
);

const countLikedSongs = db.prepare("SELECT COUNT(*) AS count FROM liked_songs");

export function addLikedSong({ title, artist = "", album = "", sourceId }) {
  return insertLikedSong.run({ title, artist, album, source_id: sourceId });
}

export function removeLikedSong(sourceId) {
  return deleteLikedSong.run({ source_id: sourceId });
}

export function isLiked(sourceId) {
  return !!getLikedSongBySourceId.get({ source_id: sourceId });
}

export function getLikedSongs(limit = 100, offset = 0) {
  return getAllLikedSongs.all({ limit, offset });
}

export function getLikedSongsCount() {
  return countLikedSongs.get().count;
}
```

- [ ] **Step 3: 验证 db.js 语法**

Run: `node --check src/db.js`
Expected: 无输出（语法正确）

- [ ] **Step 4: 提交**

```bash
git add src/db.js && git commit -m "feat: 添加喜欢歌曲数据库层"
```

---

## Task 2: API 层

**Files:**
- Modify: `src/api/routes.js`

**Context:** Express 路由文件，使用 ES module 导入。现有端点包括 /api/now, /api/chat, /api/radio/continue, /api/playlists, /api/player/control, /api/audio/:trackId, /api/history, /api/settings, /api/weather, /api/lyrics/:trackId, /api/cast/*。需要新增 4 个喜欢相关的端点。

- [ ] **Step 1: 导入新的 db 函数**

在 `src/api/routes.js` 第 4 行的导入语句中添加 `getLikedSongs, addLikedSong, removeLikedSong, isLiked`：

```js
import { getRecentPlays, getRecentMessages, getAllPreferences, setPreference, getLikedSongs, addLikedSong, removeLikedSong, isLiked } from "../db.js";
```

- [ ] **Step 2: 添加 GET /api/liked 端点**

在 `// ── GET /api/history ───────────────────────────────────────────────────────────` 之前添加：

```js
// ── GET /api/liked ───────────────────────────────────────────────────────────

router.get("/liked", (req, res) => {
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 100));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const songs = getLikedSongs(limit, offset);
  res.json({ songs });
});
```

- [ ] **Step 3: 添加 POST /api/liked 端点**

在 `GET /api/liked` 端点之后添加：

```js
// ── POST /api/liked ──────────────────────────────────────────────────────────

router.post("/liked", (req, res) => {
  const { source_id, title, artist, album } = req.body;
  if (!source_id || !title) {
    return res.status(400).json({ ok: false, error: "source_id and title are required" });
  }
  try {
    const existing = isLiked(source_id);
    if (existing) {
      return res.json({ ok: true, already_liked: true });
    }
    addLikedSong({ title, artist: artist || "", album: album || "", sourceId: source_id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
```

- [ ] **Step 4: 添加 DELETE /api/liked/:sourceId 端点**

在 `POST /api/liked` 端点之后添加：

```js
// ── DELETE /api/liked/:sourceId ─────────────────────────────────────────────

router.delete("/liked/:sourceId", (req, res) => {
  const { sourceId } = req.params;
  if (!sourceId) {
    return res.status(400).json({ ok: false, error: "sourceId is required" });
  }
  try {
    removeLikedSong(sourceId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
```

- [ ] **Step 5: 添加 GET /api/liked/check/:sourceId 端点**

在 `DELETE /api/liked/:sourceId` 端点之后添加：

```js
// ── GET /api/liked/check/:sourceId ──────────────────────────────────────────

router.get("/liked/check/:sourceId", (req, res) => {
  const { sourceId } = req.params;
  if (!sourceId) {
    return res.status(400).json({ liked: false });
  }
  res.json({ liked: isLiked(sourceId) });
});
```

- [ ] **Step 6: 验证 routes.js 语法**

Run: `node --check src/api/routes.js`
Expected: 无输出（语法正确）

- [ ] **Step 7: 提交**

```bash
git add src/api/routes.js && git commit -m "feat: 添加喜欢歌曲 API 端点"
```

---

## Task 3: 前端 DOM 结构

**Files:**
- Modify: `src/frontend/index.html`

**Context:** HTML 文件，使用 vanilla JS。播放器控制按钮区域在 bottom buttons 区域。侧边栏抽屉将新增在 app div 之外。

- [ ] **Step 1: 在播放器控制按钮区域添加喜欢按钮和打开抽屉按钮**

在 `index.html` 的 `<!-- Bottom Buttons -->` 区域（第 88-94 行附近），找到 `id="btn-open-settings"` 按钮，在其旁边添加：

```html
<button class="ctrl-btn pixel-btn" id="btn-open-liked" title="喜欢列表">♥</button>
<button class="ctrl-btn pixel-btn" id="btn-liked" title="喜欢">♡</button>
```

- [ ] **Step 2: 在 `</aside>` 之后、`<!-- ═══ RIGHT: Chat Panel ═══ -->` 之前添加侧边栏抽屉 DOM**

在 index.html 中 `</aside>` 之后添加：

```html
<!-- ═══ Liked Songs Drawer ═══ -->
<div class="drawer-overlay" id="liked-drawer-overlay" hidden></div>
<aside class="liked-drawer" id="liked-drawer" hidden>
  <div class="drawer-header">
    <span class="drawer-title">我喜欢</span>
    <button class="ctrl-btn pixel-btn" id="btn-close-liked-drawer">✕</button>
  </div>
  <div class="liked-list" id="liked-list"></div>
</aside>
```

- [ ] **Step 3: 提交**

```bash
git add src/frontend/index.html && git commit -m "feat: 添加喜欢按钮和喜欢列表抽屉 DOM"
```

---

## Task 4: 前端样式

**Files:**
- Modify: `src/frontend/styles.css`

**Context:** CSS 文件使用 CSS 变量定义颜色（--bg-secondary, --border-color, --neon-green 等）。播放器区域和聊天面板已有完整样式。侧边栏抽屉样式需要新增。

- [ ] **Step 1: 添加侧边栏抽屉样式**

在 `styles.css` 末尾添加：

```css
/* ── Liked Songs Drawer ─────────────────────────────────────────────────── */

.liked-drawer {
  position: fixed;
  top: 0;
  right: 0;
  width: 300px;
  height: 100vh;
  background: var(--bg-secondary);
  border-left: 2px solid var(--border-color);
  z-index: 200;
  display: flex;
  flex-direction: column;
  transform: translateX(100%);
  transition: transform 0.3s ease;
}

.liked-drawer:not([hidden]) {
  transform: translateX(0);
}

.drawer-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.5);
  z-index: 190;
}

.drawer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
}

.drawer-title {
  font-family: 'Press Start 2P', monospace;
  font-size: 10px;
  color: var(--neon-green);
}

.liked-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.liked-item {
  display: flex;
  align-items: center;
  padding: 10px 8px;
  border-bottom: 1px solid var(--border-color);
  cursor: pointer;
  transition: background 0.15s;
}

.liked-item:hover {
  background: var(--bg-hover);
}

.liked-item-info {
  flex: 1;
  min-width: 0;
}

.liked-item-title {
  font-size: 13px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.liked-item-artist {
  font-size: 11px;
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.liked-item-remove {
  padding: 6px;
  color: var(--text-dim);
  background: none;
  border: none;
  cursor: pointer;
  font-size: 14px;
}

.liked-item-remove:hover {
  color: var(--danger);
}

.liked-empty {
  padding: 24px 8px;
  text-align: center;
  color: var(--text-dim);
  font-size: 12px;
}
```

- [ ] **Step 2: 提交**

```bash
git add src/frontend/styles.css && git commit -m "feat: 添加喜欢列表抽屉样式"
```

---

## Task 5: 前端交互逻辑

**Files:**
- Modify: `src/frontend/app.js`

**Context:** 前端主 JS 文件，使用 ES module。现有状态变量包括 ws、musicQueue、isMusicPlaying 等。播放器状态通过 playerState 对象管理，其中 playing 属性包含当前播放歌曲信息（含 originalId）。现有函数包括 updateNowPlaying、playAudio 等。

- [ ] **Step 1: 添加侧边栏相关变量和函数**

在 `app.js` 中找到 `// ── Init ─────────────────────────────────────────────────────────────────────` 注释区域（约第 1090 行），在该区域之前添加：

```js
// ── Liked Songs Drawer ─────────────────────────────────────────────────────

const likedDrawer = document.getElementById("liked-drawer");
const likedDrawerOverlay = document.getElementById("liked-drawer-overlay");
const likedList = document.getElementById("liked-list");
const btnLiked = document.getElementById("btn-liked");
const btnOpenLiked = document.getElementById("btn-open-liked");
const btnCloseLikedDrawer = document.getElementById("btn-close-liked-drawer");

let likedDrawerOpen = false;

function openLikedDrawer() {
  likedDrawerOpen = true;
  likedDrawer.hidden = false;
  likedDrawerOverlay.hidden = false;
  loadLikedSongs();
}

function closeLikedDrawer() {
  likedDrawerOpen = false;
  likedDrawer.hidden = true;
  likedDrawerOverlay.hidden = true;
}

async function loadLikedSongs() {
  try {
    const res = await fetch(`${API_BASE}/api/liked`);
    const data = await res.json();
    if (data.songs && data.songs.length > 0) {
      likedList.innerHTML = data.songs.map((song) => `
        <div class="liked-item" data-source-id="${escapeHtml(song.source_id)}">
          <div class="liked-item-info">
            <div class="liked-item-title">${escapeHtml(song.title)}</div>
            <div class="liked-item-artist">${escapeHtml(song.artist)}</div>
          </div>
          <button class="liked-item-remove" data-source-id="${escapeHtml(song.source_id)}">✕</button>
        </div>
      `).join("");

      // 点击喜欢列表项播放歌曲
      likedList.querySelectorAll(".liked-item").forEach((item) => {
        item.addEventListener("click", async (e) => {
          if (e.target.classList.contains("liked-item-remove")) return;
          const sourceId = item.dataset.sourceId;
          const title = item.querySelector(".liked-item-title").textContent;
          const artist = item.querySelector(".liked-item-artist").textContent;
          try {
            const res = await fetch(`${API_BASE}/api/chat`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ message: `播放 ${title} ${artist}` }),
            });
            const data = await res.json();
            if (data.actionResult?.audioUrl) {
              playAudio(data.actionResult.audioUrl);
            }
          } catch {}
        });
      });

      // 点击删除按钮取消喜欢
      likedList.querySelectorAll(".liked-item-remove").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const sourceId = btn.dataset.sourceId;
          try {
            await fetch(`${API_BASE}/api/liked/${sourceId}`, { method: "DELETE" });
            loadLikedSongs();
            if (playerState.playing?.originalId === sourceId) {
              btnLiked.textContent = "♡";
            }
          } catch {}
        });
      });
    } else {
      likedList.innerHTML = '<div class="liked-empty">还没有喜欢的歌曲</div>';
    }
  } catch (err) {
    likedList.innerHTML = '<div class="liked-empty">加载失败</div>';
  }
}

async function checkLikedStatus(sourceId) {
  if (!sourceId) {
    btnLiked.textContent = "♡";
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/api/liked/check/${sourceId}`);
    const data = await res.json();
    btnLiked.textContent = data.liked ? "♥" : "♡";
  } catch {
    btnLiked.textContent = "♡";
  }
}

async function toggleLiked(song) {
  if (!song || !song.originalId) return;
  const wasLiked = btnLiked.textContent === "♥";
  // 乐观更新
  btnLiked.textContent = wasLiked ? "♡" : "♥";
  try {
    if (wasLiked) {
      await fetch(`${API_BASE}/api/liked/${song.originalId}`, { method: "DELETE" });
    } else {
      await fetch(`${API_BASE}/api/liked`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_id: song.originalId,
          title: song.title,
          artist: song.artist,
          album: song.album || "",
        }),
      });
    }
  } catch (err) {
    // 失败回滚
    btnLiked.textContent = wasLiked ? "♥" : "♡";
  }
}
```

- [ ] **Step 2: 添加喜欢按钮和抽屉事件监听**

在 `// ── Init ─────────────────────────────────────────────────────────────────────` 区域（约第 1090 行），`loadSettings();` 之前添加：

```js
// ── Liked Songs Events ──────────────────────────────────────────────────────

btnLiked?.addEventListener("click", () => {
  if (!playerState.playing || !playerState.playing.originalId) return;
  toggleLiked(playerState.playing);
});

btnOpenLiked?.addEventListener("click", openLikedDrawer);
btnCloseLikedDrawer?.addEventListener("click", closeLikedDrawer);
likedDrawerOverlay?.addEventListener("click", closeLikedDrawer);
```

- [ ] **Step 3: 在 updateNowPlaying 中检查喜欢状态**

找到 `function updateNowPlaying(track, state)` 函数（约第 572 行），在函数开头添加喜欢状态检查：

```js
function updateNowPlaying(track, state) {
  // 检查歌曲喜欢状态
  if (track?.originalId) {
    checkLikedStatus(track.originalId);
  } else if (!track) {
    btnLiked.textContent = "♡";
  }
  // ... 原有的其余代码（保持不变）
```

注意：由于代码较多，确保只添加喜欢状态检查逻辑，不要改动其他部分。

- [ ] **Step 4: 验证 app.js 语法**

Run: `node --check src/frontend/app.js`
Expected: 无输出（语法正确）

- [ ] **Step 5: 提交**

```bash
git add src/frontend/app.js && git commit -m "feat: 添加喜欢按钮和喜欢列表抽屉交互逻辑"
```

---

## Task 6: 集成测试

**Files:** 无文件变更

- [ ] **Step 1: 启动服务并测试 API**

Run: `npm run dev`（在后台启动）

测试添加喜欢：
```bash
curl -X POST http://localhost:8080/api/liked -H "Content-Type: application/json" -d '{"source_id":"test123","title":"测试歌曲","artist":"测试艺术家"}'
```
Expected: `{"ok":true}`

测试获取喜欢列表：
```bash
curl http://localhost:8080/api/liked
```
Expected: `{"songs":[{"id":1,"title":"测试歌曲","artist":"测试艺术家","album":"","source_id":"test123","liked_at":"..."}]}`

测试检查喜欢状态：
```bash
curl http://localhost:8080/api/liked/check/test123
```
Expected: `{"liked":true}`

测试取消喜欢：
```bash
curl -X DELETE http://localhost:8080/api/liked/test123
```
Expected: `{"ok":true}`

- [ ] **Step 2: 测试前端交互**

在浏览器中打开 http://localhost:8080，播放一首歌曲：
1. 点击心形按钮（♡）观察是否变为 ♥
2. 点击 ♥ 按钮观察是否变回 ♡
3. 点击底部 ♥ 按钮打开侧边栏抽屉
4. 检查喜欢列表是否正确显示
5. 点击关闭按钮收起抽屉

- [ ] **Step 3: 提交测试变更**

```bash
git add -A && git commit -m "test: 验证喜欢功能集成正常"
```

---

## Task 7: 最终代码审查

**Files:** 所有变更文件

- [ ] **Step 1: 提交所有变更**

如果之前有任何未提交的变更，执行提交：
```bash
git add -A && git commit -m "feat: 完成歌曲收藏功能"
```

- [ ] **Step 2: 最终检查**

运行以下检查：
```bash
node --check src/db.js && node --check src/api/routes.js && node --check src/frontend/app.js && echo "All syntax checks passed"
```
Expected: `All syntax checks passed`

---

## Self-Review 检查清单

1. **Spec 覆盖检查**：
   - [x] liked_songs 表结构与 spec 一致
   - [x] 4 个 API 端点已实现
   - [x] 喜欢按钮（乐观更新）已实现
   - [x] 侧边栏抽屉已实现
   - [x] checkLikedStatus 在切歌时调用

2. **占位符扫描**：无 TBD/TODO/实现后续等占位符

3. **类型一致性检查**：
   - `addLikedSong({ title, artist, album, sourceId })` - 参数名与 db.js 一致
   - `removeLikedSong(sourceId)` - 参数名与 db.js 一致
   - `isLiked(sourceId)` - 参数名与 db.js 一致