## 1. 修复重复播放

- [ ] 1.1 在 `handleTtsEnd()` 的 MiniMax 音频成功分支中（`ttsPendingChunks.length > 0`），在播放音频前清除 `lastTtsText = ""`，防止重复 `tts_end` 消息触发浏览器 TTS 降级播放

## 2. 验证

- [ ] 2.1 启动服务（`npm run dev`），发送聊天消息，确认 TTS 语音只播放一次
- [ ] 2.2 确认 TTS 播放完毕后音乐正常开始播放
- [ ] 2.3 确认多次连续对话，每次 TTS 均不重复
