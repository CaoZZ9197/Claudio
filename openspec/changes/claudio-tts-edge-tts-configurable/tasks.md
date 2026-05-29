## 1. 环境配置更新

- [ ] 1.1 更新 `package.json`，添加 `edge-tts` 依赖
- [ ] 1.2 更新 `.env.example`，新增 `TTS_PROVIDER`、`EDGE_TTS_VOICE`、`EDGE_TTS_RATE`、`EDGE_TTS_PITCH` 配置项
- [ ] 1.3 更新 `src/config.js`，在 `tts` 配置块中新增 `provider` 字段和 Edge-TTS 相关配置（edgeVoice, edgeRate, edgePitch）

## 2. Edge-TTS 引擎实现

- [ ] 2.1 创建 `src/edge-tts.js`
  - 实现 `EdgeTTS` 类（与 `MiniMaxTTS` 保持相同接口模式）
  - 实现 `synthesize(text, onAudioChunk)` 方法
  - 使用 `edge-tts` npm 包的 `toStream()` 或类似 API 获取流式 MP3 Buffer
  - 实现串行锁 `_synthesizing`（与 MiniMax 一致）
  - 无 API Key 认证要求
  - 音色/语速/音调通过 config 配置项传入
- [ ] 2.2 导出 Singleton 模式的 `getEdgeTTS()`、`initEdgeTTS()`、`shutdownEdgeTTS()`

## 3. TTS 统一适配器

- [ ] 3.1 创建 `src/tts-adapter.js`
  - 实现 `getTTS()` 函数，根据 `config.tts.provider` 返回对应的 TTS 引擎实例
  - 实现 `initTTS()` 函数，初始化当前配置的引擎
  - 实现 `shutdownTTS()` 函数，关闭当前配置的引擎
  - 引擎实例需遵循统一接口：`synthesize(text, onAudioChunk)`

## 4. 服务层集成

- [ ] 4.1 修改 `src/server.js`
  - 将 `import { initMiniMaxTTS, shutdownMiniMaxTTS } from "./minimax-tts.js"` 替换为 `import { initTTS, shutdownTTS } from "./tts-adapter.js"`
  - 将 `initMiniMaxTTS()` 调用替换为 `initTTS()`
  - 将 `shutdownMiniMaxTTS()` 调用替换为 `shutdownTTS()`
- [ ] 4.2 修改 `src/router.js`
  - 将 `import { getMiniMaxTTS } from "./minimax-tts.js"` 替换为 `import { getTTS } from "./tts-adapter.js"`
  - 在 `streamTtsSay()` 中，将 `getMiniMaxTTS()` 替换为 `getTTS()`
  - 其他逻辑不变（广播逻辑、错误处理、首次问候检测等均保持不变）

## 5. 验证测试

- [ ] 5.1 安装依赖并启动服务
  ```
  npm install
  npm run dev
  ```
- [ ] 5.2 测试 MiniMax 引擎（默认模式）
  - 不设置 `TTS_PROVIDER`，发送消息验证 MiniMax TTS 正常合成语音
- [ ] 5.3 测试 Edge-TTS 引擎
  - 设置 `TTS_PROVIDER=edge-tts`，重启服务
  - 发送消息验证 Edge-TTS 正常合成语音，音频通过 WebSocket 正常广播
- [ ] 5.4 测试引擎切换
  - 从 Edge-TTS 切换回 MiniMax：设置 `TTS_PROVIDER=minimax`，重启，验证语音正常
- [ ] 5.5 测试语音播报与音乐协调
  - 在语音播报期间触发音乐播放，验证暂停/恢复逻辑在两个引擎下行为一致
- [ ] 5.6 测试错误降级
  - 设置 Edge-TTS 无效配置（如不可达的网络环境），验证服务仍正常启动，TTS 失败时不影响对话流程
