## Context

当前 `src/frontend/app.js` 的 `handleTtsEnd()` 函数在处理 MiniMax TTS 音频播放成功时，未清除 `lastTtsText` 变量。该变量保存了 TTS 文本，用于在 MiniMax 音频不可用时降级到浏览器 SpeechSynthesis。

问题路径：
1. `handleTtsStart({text})` 设置 `lastTtsText = text`，`ttsPendingChunks = []`
2. WebSocket 推送 MiniMax 二进制音频 chunks → `handleTtsAudioChunk` 缓存
3. 第一个 `tts_end` → `handleTtsEnd()`：`ttsPendingChunks.length > 0`，播放 MiniMax 音频，**但未清除 `lastTtsText`**
4. 第二个 `tts_end`（来自调度器并发任务或 WebSocket 重连）→ `handleTtsEnd()`：`ttsPendingChunks` 已空，但 `lastTtsText` 仍为旧值 → 触发 `speakWithBrowserTts(lastTtsText)` → 同一文本被浏览器 TTS 再次播放

## Goals / Non-Goals

**Goals:**
- 消除 TTS 语音重复播放问题，确保每次回复只播放一次
- 极小改动，不影响现有 TTS 合成、WebSocket 通信、调度器任务
- 让 `handleTtsEnd()` 具备幂等性（多次调用不产生副作用）

**Non-Goals:**
- 不修改 MiniMax TTS 合成逻辑
- 不修改 WebSocket 协议或消息格式
- 不重构前端 TTS 状态管理
- 不修改调度器任务的 TTS 行为

## Decisions

**方案**：在 `handleTtsEnd()` 的 MiniMax 音频成功路径中提前清除 `lastTtsText`。

具体改动（`src/frontend/app.js` `handleTtsEnd` 函数，约第 136-142 行）：

```js
if (ttsPendingChunks.length > 0) {
    lastTtsText = "";  // ← 新增：立即清除，防止重复 tts_end 触发降级
    const blob = new Blob(ttsPendingChunks, { type: "audio/mpeg" });
    // ... 后续播放逻辑不变
}
```

**为什么不用更复杂的方案**：
- 不需要在 WebSocket 层增加消息 ID / 去重：引入协议变更，风险远大于修复
- 不需要修改调度器：调度器并发触发是偶发场景，根本修复应在前端防御
- 不需要重构 `lastTtsText` 生命周期：当前生命周期设计对单一 TTS 流是正确的，只需补漏

## Risks / Trade-offs

- **风险**：如果 MiniMax 合成成功（音频 chunks 已收到）但播放失败（`ttsAudioEl.play()` reject），`lastTtsText` 已被清除，无法降级到浏览器 TTS
  - **缓解**：实际场景中 `play()` 失败的常见原因是用户未交互，此时浏览器 TTS 同样需要用户交互授权。且 MiniMax 音频播放失败时，retry 逻辑（500ms 重试）已覆盖大多数瞬时错误。权衡后，消除重复播放的收益大于降级兜底丢失的风险。

- **无其他风险**：仅新增一行赋值语句，无性能影响，无 API 变更，无协议变更。
