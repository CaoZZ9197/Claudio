## Why

MiniMax TTS 语音合成存在三个问题：不必要的 TTS 请求导致 token 消耗过高（如 `executeAction` 中丢弃音频的无效调用）；TTS 语音与歌曲共用同一个 `<audio>` 元素和播放器 UI，导致播放冲突；歌曲检索在 TTS 播放完成后才执行，响应延迟过长。此变更通过严格控制 TTS 合成范围、分离 TTS 与音乐播放通道、并行化歌曲检索来解决问题。

## What Changes

- 移除所有不必要的 MiniMax TTS 合成调用（仅保留 Claude 回复文本的 TTS 合成）
- 前端新增独立的 TTS 音频元素，TTS 播报不再占用音乐播放器页面
- TTS 语音播报与歌曲检索并行执行：确认回复内容后同时进行 TTS 合成和网易云歌曲搜索/解锁，TTS 播放完毕后再开始播放歌曲
- 删除 `src/tts.js`（Fish Audio 遗留代码，从未被调用）

## Capabilities

### New Capabilities
<!-- 本次变更不新增独立能力，均为现有能力的修改 -->

### Modified Capabilities
- `tts-pipeline`: 从 Fish Audio HTTP 改为 MiniMax 同步 HTTP 方式；严格控制 TTS 合成范围，仅对 Claude 回复文本（`say`/`text` 字段）进行合成；移除所有丢弃音频的无效 TTS 调用
- `voice-streaming`: TTS 语音播报独立于音乐播放器，使用专用音频通道，不再占用音乐播放器 UI 和状态
- `intent-routing`: DJ 回复和 chat_message 路径中，TTS 合成与歌曲检索（searchSongs + getAudioUrl）并行执行；歌曲播放等待 TTS 完成后才开始
- `pwa-frontend`: 新增独立的 TTS `<audio>` 元素；音乐播放器 UI 不受 TTS 播报影响；TTS 期间到达的 music 事件数据在 TTS 完成后自动播放

## Impact

- `src/minimax-tts.js`：确认使用 HTTP streaming 方式，无需改变接口
- `src/router.js`：`streamTtsSay`、`routeMessageStream`、`executeAction`、`handleSwitchMusicType` 中的 TTS 调用和并行逻辑需调整
- `src/frontend/app.js`：新增 TTS 专用 `<audio>` 元素，分离 TTS 和音乐播放逻辑
- `src/frontend/index.html`：新增 TTS 音频元素
- `src/tts.js`：删除（遗留 Fish Audio 代码，无调用者）
- `src/server.js`：移除 `/audio/tts` 静态路由（仅服务于已废弃的 Fish Audio 缓存）
