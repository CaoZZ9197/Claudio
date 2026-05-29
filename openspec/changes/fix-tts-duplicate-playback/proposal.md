## Why

每次 Claudio 回复聊天消息时，MiniMax TTS 合成的语音会被播放两次，然后才开始播放音乐。原因是前端 `handleTtsEnd()` 函数在 MiniMax 音频播放成功后未清除 `lastTtsText`，导致任何重复的 `tts_end` WebSocket 消息触发浏览器 TTS 降级方案，使用同一文本再次播放。这破坏了用户正常的听音体验。

## What Changes

- 在 `handleTtsEnd()` 的 MiniMax 音频成功路径中提前清除 `lastTtsText`，防止重复 `tts_end` 消息触发浏览器 TTS 降级播放
- 在 `handleTtsEnd()` 入口处增加 `isTtsActive` 守卫，忽略非活跃状态下的 `tts_end` 消息

## Capabilities

### New Capabilities
<!-- 本次为缺陷修复，不引入新能力 -->

### Modified Capabilities
- `pwa-frontend`: TTS 结束后 `lastTtsText` 清理时机调整，确保 MiniMax 音频播放路径也正确清理状态

## Impact

- 仅修改 `src/frontend/app.js`（约 2-3 行改动）
- 不影响 MiniMax TTS 合成、WebSocket 通信、服务端逻辑
- 不影响调度器任务（morning broadcast / mood check）的 TTS 功能
