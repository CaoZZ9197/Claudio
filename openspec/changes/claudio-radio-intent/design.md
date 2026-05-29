## Context

Claudio 当前的意图路由 (`src/router.js`) 使用二分类模型：`music_command`（直接播放指令）和 `chat_message`（交给 Claude DJ）。这导致以下问题：

1. 用户说"换点轻松的音乐"时，`CONVERSATION_PATTERNS` 将其归为 `chat_message`，Claude 可能回复推荐文字但不会清空队列切换歌曲
2. 电台续播 `handleContinueRadio()` 只返回 3-5 首，且去重仅依赖 `playedIds`，没有队列级别的管理
3. 前端聊天消息与播放信息分离——用户看不到"正在播放XXX"与DJ回复的关联

核心架构决策：不引入新的 action 类型（Claude 已返回 `play_music`），而是在路由层增强意图分类，区分"切换风格"与"一般对话"。

## Goals / Non-Goals

**Goals:**
- 识别"切换歌曲类型"意图，触发队列清空 + 停止当前播放 + 搜索新歌
- 非切换意图的对话保持当前歌曲播放
- 切换时至少搜索 5 首歌曲
- 队列播完后自动续搜同类型歌曲，不重复
- DJ 回复消息中展示"正在播放XXX"

**Non-Goals:**
- 不改变 Claude API 的 action 协议（仍使用现有的 `play_music` action）
- 不改变 WebSocket 音频流架构
- 不新增 REST 端点
- 不引入持久化队列（队列仍为内存管理）

## Decisions

### Decision 1: 三分类意图模型（router.js）

在现有二分类基础上，在 `CONVERSATION_PATTERNS` 和 `DIRECT_MUSIC_PREFIXES` 之间插入第三类检测：

```
classifyIntent(message):
  1. CONVERSATION_PATTERNS（含音乐咨询）→ chat_message
  2. SWITCH_MUSIC_PATTERNS（新增）→ switch_music_type
  3. DIRECT_MUSIC_PREFIXES → music_command
  4. 兜底 → chat_message
```

**Switch patterns**: `换首|换个|切换|来点别的|不想听|换种|换点|换一|切到|换些|不要这个`

**理由**: 简单的正则匹配即可覆盖绝大多数切换场景，无需增加 Claude API 调用。Claude 仍然处理"DJ对话 + 音乐推荐"复合场景（通过 `CONVERSATION_PATTERNS` 优先匹配）。

**替代方案**: 让 Claude 判断是否切换——但这增加一次 API 延迟，且简单的"换首"不需要 AI 推理。当前方案保持快速响应。

### Decision 2: 切换意图处理流程

当检测到 `switch_music_type` 时：

1. 从用户消息中提取关键词（与 `extractMusicQuery` 类似，剥掉切换指令词）
2. 调用 `clearQueueAndStop()` —— 清空 radio-session 队列 + 通过 WebSocket 广播停止信号
3. 调用 `handleMusicCommand(keyword)` 搜索并构建新队列
4. 同时调用 Claude 生成 DJ 过渡语（简短，如"好的，为你切换成轻松的爵士乐"）
5. 返回 `{ say, song, queue, replaceQueue: true }`

**理由**: 清空队列是切换的核心语义。并行调用 Claude（过渡语）+ Netease（搜索）减少延迟。

### Decision 3: 队列管理下沉到 radio-session.js

`radio-session.js` 扩展为完整的队列管理器：

```js
{
  scene, mood, description, context,
  queue: [],           // 待播放歌曲列表
  currentTrack: null,  // 当前播放中
  playedIds: [],       // 已播放ID（最多200条，用于去重）
  searchContext: null, // 上次搜索上下文（用于续搜偏移）
  startedAt
}
```

新增函数：
- `setQueue(queue)` — 替换整个队列
- `getQueue()` — 获取当前队列
- `dequeueNext()` — 取出下一首，自动移入 playedIds
- `needsRefill()` — 队列是否接近耗尽（< 2 首）
- `getPlayedIds()` — 获取去重用的 ID 列表
- `clearQueue()` — 清空队列但保留 session 上下文

**理由**: 当前队列管理散落在 router.js 和前端 app.js 两处，状态同步困难。收拢到 radio-session.js 统一管理，前端和服务端都从同一个内存状态读取。

### Decision 4: 续搜去重策略

续搜时传递 `playedIds` 给 `searchSongs()`，搜索结果的 `limit` 参数增大到 30，客户端过滤后取前 5-10 首未播放过的。

```js
// netease.js
async function searchSongs(keyword, limit = 30, excludeIds = []) {
  const results = await cloudsearch({ keywords, type: 1, limit });
  return normalizeSearchResults(results).filter(s => !excludeIds.includes(s.id));
}
```

**理由**: 网易云 API 不支持"排除ID"参数，只能客户端过滤。增大 limit 确保过滤后仍有足够结果。

### Decision 5: "正在播放"展示方式

前端在音乐事件的 `message` 字段中收到歌曲信息文本（如"正在播放：周杰伦 - 晴天"），将其追加到当前助手消息气泡末尾。

具体实现：在 SSE `music` 事件处理中，如果存在 `message` 字段且消息气泡仍在 DOM 中，则在消息内容末尾追加 `<div class="now-playing-info">${message}</div>`。

**理由**: 无需改变 `addMessage()` 的签名，只是在现有消息气泡上追加子元素。与现有播放器 UI 的 `updateNowPlaying()` 互补——一个在聊天流中，一个在固定播放栏。

## Risks / Trade-offs

- **[风险] 正则误判**: "不想听你说话了"会匹配"不想听"但用户意思是结束对话 → **缓解**: 结合上下文，后续如发现用户意思是停止对话则走 chat_message 流程。正则尽量精确（`不想听.*歌|不想听.*音乐`）
- **[风险] 队列状态不一致**: 内存队列在服务重启后丢失 → **缓解**: 这是已有行为，非本次引入。后续可考虑持久化队列到 SQLite
- **[取舍] 切换时清空队列**: 如果用户刚加了喜欢的歌到队列，说"换点爵士"会丢失整个队列 → 这是预期的电台行为——切换类型意味着用户改变了主意
