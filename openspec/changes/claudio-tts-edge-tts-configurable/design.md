## Context

Claudio 当前使用 MiniMax Speech-2.8-HD HTTP API 进行 TTS 语音合成（`src/minimax-tts.js`），采用 Singleton 模式，通过 `synthesize(text, onAudioChunk)` 方法将文本转为 MP3 Buffer 并通过回调返回。TTS 合成在 `router.js` 的 `streamTtsSay()` 中被调用，音频块通过 `broadcastAudio()` 广播到 WebSocket 客户端。

当前架构强依赖 MiniMax API（需要付费 API Key），且没有统一的 TTS 引擎抽象层，无法在运行时或部署时切换不同的 TTS 提供商。

Edge-TTS 是微软 Edge 浏览器内置的免费 TTS 服务，通过 HTTP API 提供多种中文音色，无需 API Key。`edge-tts` npm 包提供了 Node.js 客户端，支持流式合成和 MP3 输出。

## Goals / Non-Goals

**Goals:**
- 新增 Edge-TTS 作为第二个 TTS 引擎选项
- 通过 `TTS_PROVIDER` 环境变量实现引擎切换（`minimax` 或 `edge-tts`）
- 两个引擎共享统一的调用接口，使 `router.js` 中的 TTS 调用代码无需感知具体引擎
- Edge-TTS 引擎与 MiniMax 引擎在音频输出格式上保持一致（MP3, 通过回调传递 Buffer）

**Non-Goals:**
- 不改变现有的 WebSocket 音频流广播机制
- 不修改前端 PWA 代码（引擎切换对前端透明）
- 不支持运行时通过 API 动态切换引擎（仅通过环境变量配置，重启生效）
- 不实现 Edge-TTS 的 WebSocket 流式协议（使用 HTTP 分段流式 API 即可）
- 不改变 TTS 在 router.js 中的调用时序（语音播报与音乐协调逻辑保持不变）

## Decisions

### 1. 统一 TTS 接口模式

**决策**: 创建一个轻量的 TTS 适配器模块 `src/tts-adapter.js`，该模块根据配置选择引擎，对外暴露统一的 `synthesize(text, onAudioChunk)` 接口（与当前 `MiniMaxTTS` 的接口一致）。

**理由**: router.js 目前直接调用 `getMiniMaxTTS().synthesize(text, onAudioChunk)`。通过适配器层，router.js 只需调用 `getTTS().synthesize(text, onAudioChunk)`，无需知道底层引擎。这遵循了现有的 Singleton 模式。

**备选方案**: 在 router.js 中用 if/else 分支选择引擎。被拒绝因为：污染业务逻辑，且不便于后续扩展更多引擎。

### 2. Edge-TTS 实现方式

**决策**: 使用 `edge-tts` npm 包（`npm install edge-tts`）。该包封装了 Microsoft Edge TTS 的 HTTP 通信，支持 `toStream()` 方法流式返回 MP3 Buffer。

**理由**: `edge-tts` 是 Node.js 生态中最活跃的 Edge-TTS 客户端库，API 简洁，支持异步流式输出，与现有的 `onAudioChunk(chunk)` 回调接口自然衔接。

**备选方案**: 直接调用 Microsoft Edge TTS HTTP API（`speech.platform.bing.com`）。被拒绝因为：需要自行处理 WebSocket 握手和二进制协议，维护成本高。

### 3. 配置结构

**决策**: 在 `config.js` 中新增 `tts.provider` 字段（值来自 `TTS_PROVIDER` 环境变量，默认 `minimax`），并在 `tts` 配置块中新增 Edge-TTS 相关音色配置。

```javascript
tts: Object.freeze({
  provider: process.env.TTS_PROVIDER || "minimax",  // "minimax" | "edge-tts"
  // MiniMax 相关（provider=minimax 时生效）
  voiceId: process.env.MINIMAX_TTS_VOICE_ID || "female-shaonv",
  speed: parseFloat(process.env.MINIMAX_TTS_SPEED) || 1.0,
  vol: parseFloat(process.env.MINIMAX_TTS_VOL) || 1.0,
  pitch: parseInt(process.env.MINIMAX_TTS_PITCH, 10) || 0,
  // Edge-TTS 相关（provider=edge-tts 时生效）
  edgeVoice: process.env.EDGE_TTS_VOICE || "zh-CN-XiaoxiaoNeural",
  edgeRate: process.env.EDGE_TTS_RATE || "+0%",
  edgePitch: process.env.EDGE_TTS_PITCH || "+0Hz",
}),
```

**理由**: 所有 TTS 配置集中在 `tts` 对象下，字段名明确区分引擎归属（edge-tts 使用 edge 前缀），避免配置混淆。向后兼容：默认 `minimax` 保持现有行为不变。

### 4. server.js 启动初始化

**决策**: 在 `server.js` 中，将硬编码的 `initMiniMaxTTS()` 调用替换为 `initTTS()`（来自 tts-adapter），由适配器内部根据配置决定初始化哪个引擎。

**理由**: server.js 不需要了解 TTS 引擎细节，只需确保 TTS 在服务启动时初始化成功。如果 Edge-TTS 初始化失败（比如网络问题），服务仍应正常启动，TTS 降级不可用但不影响其他功能。

## Risks / Trade-offs

- **[Edge-TTS API 不稳定]** → Microsoft Edge TTS 服务是免费公开 API，无 SLA 保证。如果服务变更或限流，Edge-TTS 可能不可用。缓解措施：保留 MiniMax 作为备选引擎，用户可随时切回。
- **[音质差异]** → Edge-TTS 音色（Xiaoxiao 等）与 MiniMax 音色（female-shaonv 等）听感不同。需在文档中说明。缓解措施：通过环境变量暴露音色选择，用户可自行测试选择偏好的音色。
- **[edge-tts npm 包依赖风险]** → 该包非微软官方维护，可能滞后于 Edge TTS API 更新。缓解措施：Edge-TTS 模块封装在独立文件中，API 变更只需修改 `src/edge-tts.js`。
- **[音频格式兼容性]** → Edge-TTS 输出的音频采样率/格式可能与 MiniMax 不同。缓解措施：Edge-TTS 客户端配置输出为 MP3 格式（与 MiniMax 一致），前端 MediaSource API 可自适应处理不同采样率。
