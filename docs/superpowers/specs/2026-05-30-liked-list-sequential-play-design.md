# 喜欢列表顺序播放 + 循环

Date: 2026/05/30

## 问题

用户点击喜欢列表中的歌曲时：
- **当前行为**：服务器当作普通音乐指令搜索播放，队列替换为搜索结果（不是喜欢列表）
- **期望行为**：清空当前队列，用**喜欢列表全部歌曲**作为新队列，按顺序播放，播完一轮后从头开始循环

## 方案

### 1. 新增 API 端点

`POST /api/liked/play`

**请求**
```json
{ "sourceId": "123456" }
```

**逻辑**
1. 从数据库获取完整喜欢列表
2. 找到点击歌曲在列表中的位置
3. 清空当前队列，按**点击歌曲 → 后续歌曲 → 前面歌曲**的顺序重组队列
4. 播放点击的歌曲
5. 更新 session，记录 source 为 "liked"
6. 解锁剩余队列歌曲（并行）

**响应**
```json
{
  "ok": true,
  "song": { "id": "...", "title": "...", "artist": "...", "originalId": "...", "encryptedId": "...", "coverUrl": "..." },
  "audioUrl": "/api/audio/xxx",
  "queue": [
    { "song": {...}, "audioUrl": null, "message": "即将播放：..." },
    ...
  ],
  "source": "liked",
  "likedList": [ /* 完整喜欢列表 */ ]
}
```

### 2. Session 扩展

**radio-session.js**

新增字段：
```js
source: "liked" | "radio" | "search" | null
likedList: []   // 完整喜欢列表（用于循环）
likedIndex: 0   // 当前播放位置（指向 likedList 中下一首）
```

修改 `setSession()` 接收新字段：
```js
export function setSession(session) {
  currentSession = {
    // ... 现有字段 ...
    source: session.source || null,
    likedList: session.likedList || [],
    likedIndex: session.likedIndex || 0,
  };
}
```

### 3. 续播逻辑调整

**handleContinueRadio()** (`router.js`)

当 `session.source === "liked"` 时：
1. 从 `likedList[likedIndex]` 开始取后续歌曲构建新队列
2. 已播放歌曲（`playedIds`）从队列中过滤
3. 播到末尾时，从 `likedList[0]` 重新开始，保留 `playedIds` 去重

```js
if (session?.source === "liked") {
  const liked = session.likedList;
  const idx = session.likedIndex || 0;

  // 构建从 idx 开始的队列（循环）
  const queue = [];
  for (let i = 0; i < liked.length && queue.length < 10; i++) {
    const song = liked[(idx + i) % liked.length];
    if (!playedIds.has(song.originalId)) {
      queue.push({ song, audioUrl: null, message: `即将播放：${song.title} - ${song.artist}` });
    }
  }

  return { queue, session: { source: "liked", likedList: liked }, ... };
}
```

### 4. 前端改造

**喜欢列表点击处理** (`frontend/app.js`)

替换现有逻辑：
```js
// 旧
fetch('/api/chat', { body: JSON.stringify({ message: `播放 ${title} ${artist}` }) })

// 新
fetch('/api/liked/play', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sourceId }),
})
.then(res => res.json())
.then(data => {
  if (data.ok) {
    // 清空旧队列，设置新队列
    musicQueue = data.queue;
    fetchGeneration++;
    playAudio(data.audioUrl);
    // 更新前端队列展示为"喜欢列表"模式
  }
})
```

### 5. 队列重组规则

喜欢列表 = [A, B, C, D, E]，用户点击 C：
→ 新队列 = [C, D, E, A, B]

顺序：
1. C（点击的）
2. D（后续）
3. E（后续）
4. A（循环到开头）
5. B（循环到开头）

### 6. 循环规则

播完一轮后（B 播完），新一轮队列仍从 A 开始（从头循环）：
- `likedIndex` 重置为 0
- 已播放歌曲（`playedIds`）仍起去重作用，避免短期内重播同一首歌

## 实现步骤

1. `router.js` 新增 `handleLikedPlay(sourceId)` 函数
2. `api/routes.js` 注册 `POST /api/liked/play` 端点
3. `radio-session.js` 扩展 session 结构，添加 source/likedList/likedIndex
4. `router.js` 中 `handleContinueRadio()` 增加 liked 模式分支
5. `frontend/app.js` 改造喜欢列表点击逻辑
6. 测试：点击喜欢列表歌曲 → 队列正确 → 播完继续从列表续播 → 循环

## 文件变更

| 文件 | 变更 |
|------|------|
| `src/router.js` | 新增 `handleLikedPlay()`，修改 `handleContinueRadio()` |
| `src/api/routes.js` | 注册 `POST /api/liked/play` |
| `src/radio-session.js` | session 结构增加 `source`, `likedList`, `likedIndex` |
| `src/frontend/app.js` | 喜欢列表点击改用 `/api/liked/play` |