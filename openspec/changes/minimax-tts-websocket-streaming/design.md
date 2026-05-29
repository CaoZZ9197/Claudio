# design.md

## 变更名称
`minimax-tts-websocket-streaming`

## 概述

通过 MiniMax Speech-2.8-Turbo WebSocket 接口实现流式语音合成，使 Claudio 的 AI 回复能够边合成边播放语音，同时前端流式展示文字，实现真正的实时语音交互。

## 设计原则

1. **流式优先**：Claude 响应和 TTS 合成并行工作，边输出边播报
2. **长连接复用**：WebSocket 连接保持活跃，支持随时语音合成
3. **音乐协调**：语音播报时暂停歌曲，播报完后根据上下文恢复或切换
4. **容错设计**：TTS 失败时降级为纯文字显示，不影响用户体验

---

## 架构设计

### 模块关系图

```
┌─────────────────────────────────────────────────────────────────────┐
│                              前端 (PWA)                              │
│  app.js: SSE 流式文字 + WebSocket 音频 + 播放器控制                   │
└─────────────────────────────────────────────────────────────────────┘
         ↕ SSE (文字流)              ↕ WebSocket (音频流)
         ↓                          ↓
┌─────────────────────────────────────────────────────────────────────┐
│                           服务器 (Node.js)                            │
│                                                                      │
│  router.js: 意图分类 → 流式响应协调                                    │
│     ↓ 流式文字                                                      │
│  app.js (前端) ← SSE emit("text", {delta})                          │
│                                                                      │
│     ↕ WebSocket /stream                                             │
│  ws.js: WebSocket 服务器                                             │
│     ↕ broadcastAudio(chunk)                                        │
│  minimax-ws-tts.js: MiniMax WebSocket TTS 客户端                      │
│     ↕ task_start → task_continue → task_finish                     │
│  api.minimaxi.com/ws/v1/t2a_v2 (MiniMax WebSocket API)                │
└─────────────────────────────────────────────────────────────────────┘
         ↓ HTTP (歌曲 URL 获取)
┌─────────────────────────────────────────────────────────────────────┐
│                      网易云音乐 (ncm-cli)                             │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 核心模块设计

### 1. `src/minimax-ws-tts.js`（新文件）

MiniMax WebSocket TTS 客户端，实现流式语音合成。

#### 连接管理

```
Singleton 模式：
getMiniMaxWSTTS() → 返回全局单例
initWSTTS() → 建立 WebSocket 连接（带重连）
shutdownWSTTS() → 断开连接

WebSocket URL: wss://api.minimaxi.com/ws/v1/t2a_v2
```

#### 三步握手协议

```javascript
// Step 1: task_start - 发送模型/音色配置
{
  task_start: {
    model: "Speech-2.8-Turbo",
    silence_frame: false,
    stream: true,
    audio_setting: {
      voice_id: config.tts.voiceId,      // "female-shaonv"
      speed: config.tts.speed,            // 1.0
      vol: config.tts.vol,               // 1.0
      pitch: config.tts.pitch            // 0
    }
  }
}

// Step 2: task_continue - 发送待合成文本
{
  task_continue: {
    text: "要合成的文本内容"
  }
}

// Step 3: task_finish - 结束任务
{
  task_finish: null
}
```

#### 流式音频回调

```javascript
// 构造函数
constructor(onAudioChunk: (chunk: Buffer) => void) { ... }

// 流式回调机制
onAudioChunk: 每次收到音频数据时调用
chunk: 二进制 MP3 数据块

// 连接状态
STATUS: "disconnected" | "connecting" | "ready" | "synthesizing" | "error"
```

#### 错误处理与重连

```
重连策略：指数退避
- 初始延迟：1s
- 最大延迟：30s
- 重连直到连接成功或达到最大重试次数

串行锁：_synthesizing 标志确保同一时间只有一个合成任务
```

### 2. `src/router.js` 修改

#### 新增端点：`/chat/stream`

```javascript
POST /api/chat/stream
  → routeMessageStream(req.body.message)
```

#### `routeMessageStream()` 流程

```
1. 分类意图 (classifyIntent)
   │
   ├─ "switch_music_type" → handleSwitchMusicType()
   │     → TTS say + 搜索新歌 并行
   │     → SSE: music 事件 + text 事件
   │
   ├─ "music_command" → handleMusicCommand()
   │     → 直接搜索播放，立即 SSE: music 事件
   │
   └─ "chat_message" → handleChatMessage()
         → 调用 Claude 流式 API
         → 并行：SSE text 事件 + MiniMax TTS
         → 音乐协调：根据 say 内容决定是否暂停歌曲
```

#### `streamTtsSay()` 流式 TTS

```javascript
async function streamTtsSay(text, onAudioChunk, onComplete) {
  // 1. 获取 MiniMax WebSocket TTS 单例
  // 2. 调用 synthesize(text, onAudioChunk)
  // 3. onComplete 回调通知完成
}
```

### 3. `src/api/ws.js` 修改

#### 新增信令事件

```javascript
// TTS 相关信令
{ event: "tts_start", data: { text: "..." } }
{ event: "tts_end", data: { success: true } }
{ event: "tts_error", data: { error: "..." } }

// 音频流（保持现有 Binary Blob）
// Binary: MP3 音频块
```

#### `broadcastTtsStart(text)` / `broadcastTtsEnd()` / `broadcastTtsError(error)`

广播 TTS 状态给所有客户端，前端据此协调音乐播放。

### 4. `src/frontend/app.js` 修改

#### TTS 协调逻辑

```javascript
// 状态变量
let wasPlayingMusicBeforeTts = false;
let pendingMusicData = null;

// TTS 开始
function handleTtsStart() {
  if (isMusicPlaying && !audioEl.paused) {
    wasPlayingMusicBeforeTts = true;
    audioEl.pause();  // 暂停歌曲
  }
}

// TTS 结束
function handleTtsEnd() {
  if (pendingMusicData) {
    processMusicAction(pendingMusicData);
    pendingMusicData = null;
  } else if (wasPlayingMusicBeforeTts) {
    audioEl.play();  // 恢复歌曲
  }
  wasPlayingMusicBeforeTts = false;
}
```

#### 首次问候语检测

```javascript
// 服务重启后首次"你好"不触发 TTS
let isFirstGreeting = true;  // 服务启动时设为 true

function shouldSpeakTts(text) {
  if (isFirstGreeting && isGreeting(text)) {
    isFirstGreeting = false;
    return false;  // 不触发 TTS
  }
  return true;
}

function isGreeting(text) {
  const greetings = ["你好", "您好", "hi", "hello", "嗨", "嘿"];
  return greetings.some(g => text.trim().toLowerCase().startsWith(g));
}
```

#### WebSocket 音频处理

```javascript
ws.onmessage = (event) => {
  if (event.data instanceof Blob) {
    // 音频块 → 放入 audioBuffer 队列播放
    audioChunks.push(event.data);
    playNextAudioChunk();
  } else {
    const msg = JSON.parse(event.data);
    switch (msg.event) {
      case "tts_start":
        handleTtsStart();
        break;
      case "tts_end":
        handleTtsEnd();
        break;
      case "tts_error":
        handleTtsEnd();  // 错误时也恢复音乐
        console.error("TTS Error:", msg.data.error);
        break;
    }
  }
};
```

---

## 数据流设计

### 流式语音合成时序

```
用户: "来首轻音乐"
     │
     ▼
router.js: handleChatMessage()
     │
     ├─► claudio.js: callClaudeStream()
     │       │
     │       ▼ SSE: emit("text", {delta: "好的"})
     │                         │
     │                         ▼
     │                    前端: 文字流式展示
     │
     ├─► minimax-ws-tts.js: synthesize("好的", onAudioChunk)
     │       │
     │       ▼ WebSocket: task_start → task_continue
     │                         │
     │                         ▼ WS: broadcastAudio(mp3_chunk)
     │                                           │
     │                                           ▼
     │                                    前端: 音频播放
     │
     ▼ SSE: emit("music", {song, url})
          │
          ▼ 前端: processMusicAction()
                ├─ 暂停歌曲
                ├─ 更新播放器
                └─ 开始播放新歌
```

### 首次问候不触发 TTS

```
服务重启
     │
     ▼
isFirstGreeting = true
     │
     ▼
用户: "你好"
     │
     ▼
shouldSpeakTts("你好") → isFirstGreeting && isGreeting("你好")
     │
     ▼
返回 false → 不触发 TTS，仅流式文字显示
     │
     ▼
isFirstGreeting = false
```

---

## 配置设计

### .env.example 新增配置

```bash
# MiniMax TTS 配置（通过 MiniMax Speech-2.8-Turbo WebSocket）
MINIMAX_API_KEY=your_api_key_here
MINIMAX_TTS_VOICE_ID=female-shaonv
MINIMAX_TTS_SPEED=1.0
MINIMAX_TTS_VOL=1.0
MINIMAX_TTS_PITCH=0
```

### src/config.js 配置结构

```javascript
tts: Object.freeze({
  provider: "minimax",  // 或 "fish" - 切换 TTS 提供商
  voiceId: process.env.MINIMAX_TTS_VOICE_ID || "female-shaonv",
  speed: parseFloat(process.env.MINIMAX_TTS_SPEED) || 1.0,
  vol: parseFloat(process.env.MINIMAX_TTS_VOL) || 1.0,
  pitch: parseInt(process.env.MINIMAX_TTS_PITCH, 10) || 0,
}),
```

---

## 兼容性设计

### 降级策略

1. **TTS 失败**：不触发 TTS，仅流式文字显示，不影响 Claude 响应
2. **WebSocket 连接失败**：自动重连 3 次，仍失败则降级为文字
3. **首次问候**：检测到问候语不触发 TTS，避免无意义播报

### 向后兼容

Fish Audio TTS 代码保留在 `src/tts.js`，可通过配置切换 provider。

---

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|------|----------|------|
| 新增 | `src/minimax-ws-tts.js` | MiniMax WebSocket TTS 客户端 |
| 修改 | `src/config.js` | 新增 MiniMax TTS 配置项 |
| 修改 | `src/router.js` | 流式 TTS 调用，文字与语音并行 |
| 修改 | `src/api/ws.js` | 新增 TTS 信令广播 |
| 修改 | `src/frontend/app.js` | TTS 协调逻辑，音频块播放 |
| 修改 | `src/frontend/sw.js` | 无需修改（音频不走 SW）|
| 修改 | `.env.example` | 新增 MiniMax TTS 配置 |

---

## 测试验证

### 功能测试

1. **流式输出**：发送消息后，文字和语音几乎同步输出
2. **音乐协调**：语音播报期间歌曲暂停，播报完毕后恢复
3. **首次问候**：服务重启后第一句"你好"不触发 TTS
4. **长连接**：连续对话时 WebSocket 保持连接，无重复握手
5. **错误处理**：TTS 失败时仅文字显示，不影响对话流程

### 性能测试

1. **延迟**：文字出现到语音输出的延迟 < 500ms
2. **连接复用**：连续 10 次 TTS 请求，使用同一 WebSocket 连接
3. **并发控制**：同时只能有一个 TTS 合成任务