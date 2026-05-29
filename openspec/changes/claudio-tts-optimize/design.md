## Context

Claudio 当前使用 MiniMax Speech-2.8-Turbo HTTP Streaming API 进行 TTS 语音合成。存在三个问题：

1. **无效 TTS 调用浪费 token**：`executeAction()` 中的 `say`、`announce_weather`、`announce_schedule`、`mood_check` 分支调用 `getMiniMaxTTS().synthesize()` 时传入空回调 `() => {}`，音频被合成后直接丢弃。`executeDjResponse()` 同样如此。文本内容已通过 JSON 响应返回给前端，TTS 合成是冗余的。
2. **TTS 与音乐共用一个 `<audio>` 元素**：前端通过复杂的状态标志（`isTtsPlaying`、`wasPlayingMusicBeforeTts`、`pendingMusicData`）来协调两种播放模式，播放器 UI 在 TTS 播报期间显示混乱。
3. **歌曲检索在 TTS 之后串行执行**：`routeMessageStream()` 中 `streamTtsSay()` 完成后才调用 `handleMusicStream()`，导致用户等待时间长。

## Goals / Non-Goals

**Goals:**
- 移除所有丢弃音频的无效 TTS 调用，仅对实际要播放的 Claude 回复文本进行合成
- 前端新增独立 TTS 音频元素，TTS 播报与音乐播放互不干扰
- 在 streaming 路径中，TTS 合成与歌曲检索/解锁并行执行，TTS 播放完成后立即开始歌曲播放
- 删除未使用的 Fish Audio 遗留代码

**Non-Goals:**
- 不改变 MiniMax API 调用方式（保持 HTTP streaming）
- 不添加 TTS 缓存机制（本次范围外）
- 不修改 scheduler 中的 TTS 调用逻辑（morning broadcast 和 mood check 是实际需要播放的）
- 不重构整个播放器架构

## Decisions

### 1. 前端新增独立 TTS `<audio>` 元素

**选择**：新增 `<audio id="tts-player" hidden>` 专门处理 TTS 播放，原有的 `<audio id="audio-player">` 仅用于音乐。

**原因**：两个独立的 audio 元素天然隔离 TTS 和音乐播放，无需复杂的状态协调。`mediaElement` 事件（`play`、`pause`、`ended`、`timeupdate`）各自治理，不会互相触发。音乐播放器的进度条、歌词同步、频谱可视化都绑定在 `#audio-player` 上，TTS 播报时完全不受影响。

**替代方案**：保持单 audio 元素 + 更精细的状态管理。但这需要维护更多标志位，且 TTS 播放仍会触发 `timeupdate` 事件驱动进度条更新，造成 UI 抖动。

**TTS 期间音乐处理**：改为音量压低（ducking）而非暂停。`mainAudioEl.volume` 降至原音量的 30%，TTS 结束后恢复。好处是音乐不中断、播放进度保持、且仍能听清 TTS 语音。

### 2. 移除 executeAction / executeDjResponse 中的无效 TTS 调用

**选择**：直接删除这些分支中的 `getMiniMaxTTS().synthesize()` 调用，让函数返回文本内容。

**原因**：非 streaming 路径（`POST /api/chat`）返回的 JSON 已包含 say 文本，前端可以显示但当前架构不支持该路径播放 TTS 音频（TTS 音频仅通过 WebSocket 推送）。这些调用纯粹浪费 MiniMax token。

**替代方案**：为非 streaming 路径也实现 WebSocket TTS 推送。但这需要前端同时监听 SSE 响应和 WebSocket，增加了不必要的复杂度。非 streaming 路径本身是遗留接口，不应继续投资。

### 3. 新增 prepareMusicStreamData + commitMusicStreamAndEmit 分离音乐 I/O 与副作用

**选择**：将 `handleMusicStream` 拆分为两个阶段：
- `prepareMusicStreamData(response)`：纯 I/O，调用 `searchSongs()` + `getAudioUrl()`，无副作用
- `commitMusicStreamAndEmit(musicData, emitter)`：提交副作用（mpv 播放、session 更新、broadcastState、SSE emit）

**原因**：TTS 合成（网络 I/O）与歌曲检索/解锁（网络 I/O）可以完全并行。将副作用（状态变更、SSE 发送）推迟到 TTS 完成后执行，既实现了并行加速，又保持了"先说后唱"的时序。

**替代方案**：在 `routeMessageStream` 中直接内联 Promise.all，但会使函数过于臃肿（已 100+ 行）。拆分为独立函数更清晰。

### 4. 删除 src/tts.js 及关联代码

**选择**：删除整个 `src/tts.js`（Fish Audio TTS），同时删除 `config.js` 中的 `fishAudio` key 和 `ttsCache` 路径、`server.js` 中的 `/audio/tts` 静态路由、`index.html` 中的 Fish Audio API Key 输入框。

**原因**：`synthesizeText` 在整个项目中零调用。保留死代码增加维护负担和混淆（已有 MiniMax 实现）。

### 5. handleSwitchMusicType 保持串行不变

**选择**：switch_music_type 路径保持现有串行逻辑（先 TTS 播报过渡语，再切换到新歌曲）。

**原因**：switch_music_type 用于"换首歌"场景，用户期望听到过渡语后立即换歌。过渡语极短（≤15 字），TTS 耗时可以忽略，并行化收益微乎其微，且会增加代码复杂度。

### 6. scheduler.js 中的 TTS 调用保持不变

**选择**：morning broadcast 和 mood check 的 TTS 调用保持不变。

**原因**：这些场景是真正的 TTS 播报需求（向用户播报天气/日程/心情问候），音频通过 WebSocket 推送到前端播放，不是无效调用。

## Risks / Trade-offs

- **prepareMusicStreamData 搜索失败**：如果 `searchSongs()` 返回空结果或网络异常，`musicData` 为 null/error，前端仅收到文本回复而无音乐。这与当前串行行为一致（串行时搜索也可能失败），不是退步。→ 无需额外处理。

- **TTS 期间 music 事件延迟**：前端在 TTS 播放期间收到的 `music` SSE 事件会被暂存为 `pendingMusicData`，TTS 结束后才处理。如果 TTS 很长（如长段回复），用户可能觉得响应慢——但这是因为必须先听完回复。→ 前端 "action" 事件和 "text" 事件仍然即时显示，用户能立即看到文字。

- **音量压低 vs 暂停**：改为压低音量而非暂停音乐，可能在 TTS 播报时音乐仍然可闻。→ 压低到 30% 对大多数场景足够，且保持了音乐连续性。如果用户偏好暂停，可以在后续迭代中添加设置选项。

- **commitMusicStreamAndEmit 中的静态 import**：在 `router.js` 顶部添加 `execNcm` / `escapeShellArg` 的静态 import。`ncm-exec.js` 只导入 `node:child_process`，不存在循环依赖风险。

## Open Questions

无。所有设计决策已确定。
