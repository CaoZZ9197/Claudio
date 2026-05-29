# 歌曲推荐去重与质量优化实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 解决推荐重复歌曲和质量问题——通过持久化播放历史（14天跨会话去重） + Prompt 质量引导

**Architecture:** 数据库层新增播放历史查询与清理；搜索流程前查询历史 songId 并传入 excludeIds；Prompt 层新增质量原则指令。

**Tech Stack:** Node.js, SQLite (better-sqlite3), Claude API

---

## 文件清单

| 文件 | 改动类型 |
|------|---------|
| `src/config.js` | 修改：新增 `playHistoryDays` 配置项 |
| `src/db.js` | 修改：新增 `getPlayedSongIds()`、`cleanupOldPlays()` |
| `src/router.js` | 修改：搜索前调用 `getPlayedSongIds()` 传入 `excludeIds` |
| `src/server.js` | 修改：启动时调用 `cleanupOldPlays()` |
| `data/taste.md` | 修改：新增 `## 推荐质量原则` 小节 |
| `.env.example` | 修改：新增 `PLAY_HISTORY_DAYS` |

---

## 任务清单

### Task 1: config.js 新增 playHistoryDays 配置项

**文件：** `src/config.js:18-57`

- [ ] **Step 1: 读取 config.js 在 parseInt 附近的位置，在 paths 之前新增 playHistoryDays 配置项**

在 `config.js` 的 `config` 对象中，`paths` 之前插入：

```javascript
playHistoryDays: parseInt(process.env.PLAY_HISTORY_DAYS, 10) || 14,
```

完整位置参考（`paths` 前的结构）：

```javascript
const config = Object.freeze({
  port: parseInt(process.env.PORT, 10) || 8080,
  model: process.env.CLAUDIO_MODEL || process.env.CLAUDE_MODEL || "claude-sonnet-4-6",

  // 三方大模型 API 代理地址（MiniMax 等 Anthropic 兼容 API）
  anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL || null,

  // 播放历史保留天数（默认14天）
  playHistoryDays: parseInt(process.env.PLAY_HISTORY_DAYS, 10) || 14,

  apiKeys: Object.freeze({
    // ... 保持不变
  }),

  tts: Object.freeze({
    // ... 保持不变
  }),

  paths: Object.freeze({
    // ... 保持不变
  }),
});
```

- [ ] **Step 2: 验证 config.js 无语法错误**

```bash
node --check src/config.js
```

期望输出：无错误

- [ ] **Step 3: 提交**

```bash
git add src/config.js
git commit -m "feat: add playHistoryDays config (default 14 days)"
```

---

### Task 2: .env.example 新增 PLAY_HISTORY_DAYS

**文件：** `.env.example`

- [ ] **Step 1: 在 `.env.example` 末尾（`EDGE_TTS_PITCH` 行之后）新增配置项说明**

```bash
# 播放历史保留天数（默认14天，超过天数的记录自动清理）
PLAY_HISTORY_DAYS=14
```

- [ ] **Step 2: 提交**

```bash
git add .env.example
git commit -m "docs: add PLAY_HISTORY_DAYS to .env.example"
```

---

### Task 3: db.js 新增 getPlayedSongIds() 和 cleanupOldPlays()

**文件：** `src/db.js`

- [ ] **Step 1: 在 `getRecentPlays` 函数后、新增 `// ── Play History Cleanup ────────────────────────────────` 小节之前，添加两个新函数**

在 `src/db.js` 第 75 行附近（`export function getRecentPlays` 之后），添加：

```javascript
// ── Play History Cleanup ─────────────────────────────────────────────────────

const getPlayedIdsStmt = db.prepare(
  "SELECT source_id FROM plays WHERE timestamp >= datetime('now', @daysDiff)"
);

const cleanupOldPlaysStmt = db.prepare(
  "DELETE FROM plays WHERE timestamp < datetime('now', @daysDiff)"
);

/**
 * 返回最近 N 天已播放的 source_id 数组（用于搜索去重）
 * @param {number} days - 天数，默认 14
 * @returns {string[]} source_id 数组
 */
export function getPlayedSongIds(days = 14) {
  const rows = getPlayedIdsStmt.all({ daysDiff: `-${days} days` });
  return rows.map((r) => r.source_id).filter(Boolean);
}

/**
 * 清理超过保留天数的播放记录
 * @param {number} days - 天数，默认 14
 * @returns {number} 删除的记录数
 */
export function cleanupOldPlays(days = 14) {
  const result = cleanupOldPlaysStmt.run({ daysDiff: `-${days} days` });
  if (result.changes > 0) {
    console.log(`[db] Cleaned up ${result.changes} old play records`);
  }
  return result.changes;
}
```

- [ ] **Step 2: 验证 db.js 无语法错误**

```bash
node --check src/db.js
```

期望输出：无错误

- [ ] **Step 3: 提交**

```bash
git add src/db.js
git commit -m "feat: add getPlayedSongIds() and cleanupOldPlays() to db"
```

---

### Task 4: server.js 启动时调用 cleanupOldPlays()

**文件：** `src/server.js:102-127`

- [ ] **Step 1: 在 `server.listen()` 之前（或 initAuth 之后）添加 cleanupOldPlays 调用**

在 `server.js` 第 107 行 `server.listen` 之前添加：

```javascript
// 启动时清理过期的播放历史记录
const { cleanupOldPlays } = await import("./db.js");
cleanupOldPlays(config.playHistoryDays);
```

注意：由于 `config` 在 `server.js` 顶部已 import，需使用动态 import 或在文件顶部直接 import：

找到 `src/server.js` 顶部的 import：
```javascript
import { closeDb } from "./db.js";
```

改为：
```javascript
import { closeDb, cleanupOldPlays } from "./db.js";
```

然后在 `server.listen` 之前添加调用：
```javascript
// 启动时清理过期的播放历史记录
cleanupOldPlays(config.playHistoryDays);
```

完整修改位置（参考 `server.js:107-121`）：

```javascript
// 后台初始化网易云音乐认证（不阻塞 HTTP 服务启动）
Promise.resolve(initAuth()).catch((err) => {
  console.error("[auth] initAuth failed:", err.message);
});

// 启动时清理过期的播放历史记录
cleanupOldPlays(config.playHistoryDays);

server.listen(config.port, () => {
  console.log(`Claudio AI Radio — http://localhost:${config.port}`);
  console.log(`  Model:    ${config.model}`);
  console.log(`  Database: ${config.paths.db}`);
  console.log(`  Static:   ${config.paths.frontend}`);
  const routeStack = app._router?.stack
    ?.filter((r) => r.route)
    ?.map((r) => `${Object.keys(r.route.methods)[0].toUpperCase()} ${r.route.path}`) || [];
  if (routeStack.length) {
    console.log("  Routes:");
    routeStack.forEach((r) => console.log(`    ${r}`));
  }
  console.log(`  WebSocket: ws://localhost:${config.port}/stream`);
  initScheduler();
});
```

- [ ] **Step 2: 验证 server.js 无语法错误**

```bash
node --check src/server.js
```

期望输出：无错误

- [ ] **Step 3: 提交**

```bash
git add src/server.js
git commit -m "feat: clean up old play history on server startup"
```

---

### Task 5: router.js 搜索前调用 getPlayedSongIds() 传入 excludeIds

**文件：** `src/router.js:89-134`（`handleMusicCommand` 函数）

- [ ] **Step 1: 在 `handleMusicCommand` 函数顶部 import `getPlayedSongIds`**

找到 `src/router.js` 顶部的 import：
```javascript
import { getSession, setSession, clearSession, addPlayedSong, getPlayedIds, clearQueue } from "./radio-session.js";
```

改为：
```javascript
import { getSession, setSession, clearSession, addPlayedSong, getPlayedIds, clearQueue } from "./radio-session.js";
import { getPlayedSongIds } from "./db.js";
```

- [ ] **Step 2: 修改 `handleMusicCommand` 函数，在构建 excludeIds 时合并数据库历史**

找到 `handleMusicCommand` 函数（约第 89-134 行），当前构建 excludeIds 的逻辑：

```javascript
async function handleMusicCommand(query, opts = {}) {
  const searchQuery = extractMusicQuery(query);
  if (!searchQuery) {
    return { error: "no_query", message: "请输入你想听的歌曲名称" };
  }

  const { excludeIds = [], radioMode = false } = opts;
  const searchLimit = radioMode ? 50 : 30;
  const result = await searchSongs(searchQuery, searchLimit, excludeIds);
  // ...
}
```

改为：

```javascript
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
  // ...
}
```

注意：`config` 已在 `router.js` 顶部 import，无需额外 import。

- [ ] **Step 3: 验证 router.js 无语法错误**

```bash
node --check src/router.js
```

期望输出：无错误

- [ ] **Step 4: 提交**

```bash
git add src/router.js
git commit -m "feat: dedup search results with database play history"
```

---

### Task 6: data/taste.md 新增推荐质量原则

**文件：** `data/taste.md`

- [ ] **Step 1: 在 `data/taste.md` 末尾（最后一行之后）新增 `## 推荐质量原则` 小节**

```markdown
## 推荐质量原则
- 优先选择歌曲的官方版本/原版，避免翻唱
- 搜索词尽量具体（如"轻音乐 钢琴 放松 原版"而非"纯音乐"）
- 关注艺人的热门代表作
- 不以播放量为唯一标准，保持独立音乐鉴赏判断
```

- [ ] **Step 2: 提交**

```bash
git add data/taste.md
git commit -m "docs: add quality guidelines to taste.md"
```

---

## 实施后验证

所有任务完成后，执行以下验证：

```bash
# 1. 语法检查
node --check src/config.js
node --check src/db.js
node --check src/router.js
node --check src/server.js

# 2. 启动测试（后台运行几秒后 Ctrl+C）
npm start
# 期望：看到 "[db] Cleaned up X old play records" 或 "Cleaned up 0 old play records"

# 3. 搜索测试
# 发送"推荐轻松的纯音乐"请求两次，第二次不应该是同一首歌
```

---

## 实施顺序

1. Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6
2. 按顺序执行， 每个 Task 完成后验证再提交