## Why

Claudio 当前仅支持 MiniMax TTS 作为语音合成引擎。MiniMax 虽然音质好，但需要付费 API Key 且有调用频率限制。Edge-TTS（Microsoft Edge 浏览器内置的免费 TTS 服务）无需 API Key、免费且支持多种中文音色。为用户提供可配置的 TTS 引擎选择，既能降低成本，也能在网络受限环境下提供备选方案。

## What Changes

- 新增 `src/edge-tts.js` — Edge-TTS 语音合成客户端，使用 HTTP API 合成语音
- 修改 `src/config.js` — 新增 `TTS_PROVIDER` 配置项，支持 `minimax` / `edge-tts` 切换
- 修改 `src/server.js` — 启动时根据配置初始化对应的 TTS 引擎
- 修改 `src/router.js` — TTS 调用通过统一接口抽象，根据配置路由到对应引擎
- 修改 `.env.example` — 新增 `TTS_PROVIDER` 和 Edge-TTS 相关配置项
- 新增统一 TTS 接口抽象（`src/tts/` 目录或 `src/tts-adapter.js`），使 MiniMax 和 Edge-TTS 遵循相同的调用契约

## Capabilities

### New Capabilities

- `tts-engine-switching`: 通过环境变量或 API 设置动态切换 TTS 引擎（minimax 或 edge-tts），同一切换配置对语音合成入口透明

### Modified Capabilities

- `tts-pipeline`: TTS 合成从单一的 MiniMax 引擎扩展为可切换的多引擎架构，引擎选择由 `TTS_PROVIDER` 配置决定

## Impact

- **新增文件**: `src/edge-tts.js`、可能的 `src/tts-adapter.js`
- **修改文件**: `src/config.js`、`src/server.js`、`src/router.js`、`.env.example`
- **依赖变更**: Edge-TTS 通过 `edge-tts` npm 包或直接调用 Microsoft Edge TTS HTTP API（`speech.platform.bing.com`），无需新增外部 API 依赖
- **不影响**: Claude AI 决策逻辑、音乐播放逻辑、前端界面（前端无需感知 TTS 引擎变化）
- **数据存储**: 不改变 SQLite 结构
