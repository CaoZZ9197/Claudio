# Claudio 响应速度优化设计

## Context

Claudio 当前端到端响应流程（用户发消息 → DJ 语音回复 + 音乐播放）耗时 4-11 秒，主要瓶颈在 Claude API 调用（2-6s）和 TTS 合成（2-5s）。本次优化目标是在不影响现有功能的前提下，通过缓存、并行化、流式处理等手段降低端到端延迟，提升用户感知体验。

## 优化目标

- 后续对话场景：端到端从 4-11s 降至 2.5-7s
- 用户感知延迟（听到第一声）：降至 1.5-3s
- 零功能回退，渐进式播放有降级方案

---

## 1. TTS 音频缓存

### 问题
每次 TTS 合成都是全新 API 调用，DJ 过渡语（"为你切换成轻松风格的歌曲"等）经常重复合成，浪费 2-5 秒。

### 方案
- 缓存层位于 `tts-adapter.js`，对所有 TTS 引擎透明
- 缓存 Key = `MD5(text + voiceId + speed + pitch + vol)`
- 存储位置：`~/.claude/tts-cache/{key}.mp3`，直接存储原始 MP3 buffer
- 命中 → 直接读取文件返回；未命中 → 合成后写入缓存
- 容量上限：200 个文件或 100MB（先到先触发），超出按 `atime` LRU 淘汰
- 启动时自动清理超出上限的缓存

### 改动文件
`src/tts-adapter.js`

### 风险
极低。缓存是纯增量功能，未命中时走原有流程。

---

## 2. 前端渐进式 TTS 播放

### 问题
前端将 WebSocket 收到的所有音频 chunk 缓存到数组，等 `tts_end` 后才创建 Blob 播放。用户在整个 TTS 合成 + 传输期间听不到任何声音。

### 方案
- 使用 MediaSource API 实现边收边播
- `tts_start` → 创建 MediaSource，设置到 `<audio>`，开始播放
- `tts_audio_chunk` → `sourceBuffer.appendBuffer(chunk)`
- `tts_end` → `MediaSource.endOfStream()`
- 队列机制处理 SourceBuffer 未就绪时的 chunk 暂存
- 浏览器不支持 MediaSource 时降级回 Blob 模式

### 改动文件
`src/frontend/app.js`（`handleTtsStart`、`handleTtsAudioChunk`、`handleTtsEnd`）

### 风险
中。需处理 SourceBuffer 状态边界（QuotaExceededError、append 时序等）。有降级方案保底。

---

## 3. Claude Prompt Caching

### 问题
每次调用 Claude API 发送 ~15-18KB 系统提示词，其中 DJ persona（~9KB）、taste profiles（~3KB）、mood-rules（~1.5KB）是静态内容，重复传输造成延迟。

### 方案
- 系统提示词拆分为静态 + 动态两部分
- 静态部分（DJ persona、taste profiles、mood-rules、playlists）标记 `cache_control: { type: "ephemeral" }`
- 动态部分（时间、天气、日历、对话历史、用户请求）不缓存
- 缓存命中时 Claude 跳过静态部分处理，首 token 延迟降低
- 内容变更时 cache key 自然变化，自动失效

```javascript
system: [
  { type: "text", text: staticContent, cache_control: { type: "ephemeral" } },
  { type: "text", text: dynamicContent }
]
```

### 改动文件
`src/claudio.js`（system prompt 组装）、`src/context.js`（拆分静态/动态内容）

### 风险
低。Anthropic 官方特性，缓存未命中时行为不变。

---

## 4. Edge-TTS 连接复用

### 问题
每次 `synthesize()` 创建新 `MsEdgeTTS` 实例，重新 WebSocket 握手，额外增加 ~200-500ms。

### 方案
- 维护单例 `MsEdgeTTS` 实例
- 首次调用创建并设置 metadata，后续复用
- `toStream()` 完成后实例可能断开，实现自动重连
- 比对上次 rate/pitch/voice 参数，不变时跳过 `setMetadata()` 调用

### 改动文件
`src/edge-tts.js`

### 风险
低。实例本为单次使用，改为复用不会引入状态泄漏。自动重连确保异常恢复。

---

## 5. 配套小优化

### 5a. buildContext() 文件异步并行读取
- `loadTasteProfiles()` 的 4 个 `readFileSync` 改为 `fs.promises.readFile` + `Promise.all`
- `loadPromptFile()` 也纳入并行
- 改动：`src/context.js`

### 5b. 外部 API 添加超时
| 文件 | 超时设置 | 说明 |
|------|---------|------|
| `src/minimax-tts.js` | 15s | TTS 合成不应超过 15s |
| `src/external/weather.js` | 10s | 天气 API |
| `src/external/calendar.js` | 10s | 日历 API |
| `src/music/netease.js` | 15s | 歌曲 URL API |
| `src/api/routes.js` | 30s | 音频代理 fetch |

Claude API 已有 30s 超时，不变。

### 5c. WebSocket 心跳保活
- 服务端每 30s 对 `/stream` 路径所有客户端发送 ping 帧
- 防止代理/负载均衡器因空闲断开 WebSocket 连接
- 改动：`src/api/ws.js`

---

## 改动文件清单

| 文件 | 改动内容 | 复杂度 |
|------|----------|--------|
| `src/tts-adapter.js` | TTS 音频缓存（MD5 key + 文件存储 + LRU淘汰） | 中 |
| `src/frontend/app.js` | 渐进式 TTS 播放（MediaSource API + 降级）+ pong 响应 | 中 |
| `src/claudio.js` | Claude Prompt Caching（system 数组拆分） | 低 |
| `src/context.js` | 拆分静态/动态内容 + 文件异步并行读取 | 中 |
| `src/edge-tts.js` | 连接复用（单例 + 自动重连 + 参数比对） | 低 |
| `src/minimax-tts.js` | 添加 fetch 15s 超时 | 低 |
| `src/external/weather.js` | 添加 fetch 10s 超时 | 低 |
| `src/external/calendar.js` | 添加 fetch 10s 超时 | 低 |
| `src/music/netease.js` | 歌曲 URL API 调用添加 fetch 15s 超时 | 低 |
| `src/api/routes.js` | 音频代理 `/api/audio/:trackId` 添加 fetch 30s 超时 | 低 |
| `src/api/ws.js` | WebSocket 30s ping 心跳 | 低 |

### 不改动的文件
`router.js`、`scheduler.js`、`db.js`、`server.js`、`radio-session.js`

---

## 效果预估

| 场景 | 优化前 | 优化后（绝对值） | 优化后（感知） | 主要来源 |
|------|--------|-----------------|---------------|----------|
| 首次对话 | 4-11s | 4-11s | ~3-5s | 渐进式播放 |
| 后续对话 | 4-11s | 2.5-7s | ~1.5-3s | TTS缓存 + Prompt Cache + 渐进式 |
| 纯音乐指令 | 1.5-4.5s | 1.5-4.5s | 不变 | 不在优化范围 |

## 验证方案

1. **TTS 缓存验证：** 发送相同消息两次，第二次应命中缓存并显著加快。检查 `~/.claude/tts-cache/` 目录生成。
2. **渐进式播放验证：** 在 Chrome/Edge/Firefox 中发送对话，观察 TTS 音频是否在 `tts_start` 后即开始播放（而非等 `tts_end`）。
3. **Prompt Cache 验证：** 连续发送两条 AI 对话请求，第二条的 Claude API 首 token 延迟应明显降低。
4. **降级验证：** 在不支持 MediaSource 的浏览器或环境（如部分移动端 WebView）中测试，确认回退到 Blob 模式正常。
5. **超时验证：** 手动断网后发送请求，确认各 API 在设定超时时间内返回错误而非无限挂起。
6. **心跳验证：** 保持页面打开 5 分钟以上不操作，确认 WebSocket 连接未断开。
7. **功能回归：** 走完整端到端流程 — 发送 DJ 对话 → 听 TTS 回复 → 确认音乐播放、风格切换、morning broadcast 均正常。
