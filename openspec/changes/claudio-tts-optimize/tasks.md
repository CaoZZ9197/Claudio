## 1. 清理死代码

- [x] 1.1 删除 `src/tts.js`（Fish Audio 遗留代码，无调用者）
- [x] 1.2 从 `src/config.js` 中移除 `fishAudio` API key、`ttsCacheDir` 变量和 `paths.ttsCache`
- [x] 1.3 从 `src/server.js` 中移除 `/audio/tts` 静态路由（约第 35-41 行）
- [x] 1.4 从 `src/frontend/index.html` 中移除 Fish Audio API Key 设置输入框

## 2. 移除无效的 TTS 调用

- [x] 2.1 修改 `src/router.js` 的 `executeAction()` 函数：删除 `say`、`announce_weather`、`announce_schedule`、`mood_check` 分支中的 `getMiniMaxTTS().synthesize()` 调用，改为直接返回文本
- [x] 2.2 修改 `src/router.js` 的 `executeDjResponse()` 函数：删除 TTS promise 中的 `getMiniMaxTTS().synthesize()` 调用，改为直接构造 ttsResult 对象
- [x] 2.3 验证：确认 `src/router.js` 中对 `getMiniMaxTTS()` 的调用仅保留在 `streamTtsSay()` 和 `handleSwitchMusicType()` 中

## 3. 前端 TTS 与音乐播放分离

- [x] 3.1 在 `src/frontend/index.html` 中添加 `<audio id="tts-player" hidden>` 元素（在现有 `#audio-player` 之后）
- [x] 3.2 在 `src/frontend/app.js` 中添加 `ttsAudioEl` 变量，重命名 `audioEl` → `mainAudioEl`，重命名 `pendingAudioChunks` → `ttsPendingChunks`，重命名 `currentAudioBlobUrl` → `ttsBlobUrl`，替换 `isTtsPlaying` → `isTtsActive`
- [x] 3.3 修改 `handleTtsAudioChunk` / `flushTtsAudioChunks` / `releaseTtsBlobUrl` 函数，目标元素改为 `ttsAudioEl`
- [x] 3.4 修改 `handleTtsStart`：移除音乐暂停逻辑，改为压低音乐音量（`mainAudioEl.volume` 设为 30%）
- [x] 3.5 修改 `handleTtsEnd` / `handleTtsError`：移除恢复播放逻辑，改为恢复音乐音量 + 处理 `pendingMusicData`
- [x] 3.6 修改 `playAudio` 函数和所有音频事件监听器（`ended`、`play`、`pause`、`error`、`timeupdate`、`loadedmetadata`），引用从 `audioEl` 改为 `mainAudioEl`
- [x] 3.7 修改 `togglePlay` 函数，引用改为 `mainAudioEl`
- [x] 3.8 修改频谱可视化（`initAudioContext` / `startSpectrum`）和歌词同步（`timeupdate` → `syncLyrics`），引用改为 `mainAudioEl`
- [x] 3.9 修改 WebSocket 二进制消息处理，去掉 `isTtsPlaying || !isMusicPlaying` 条件，直接调用 `handleTtsAudioChunk`
- [x] 3.10 修改 flush 定时器（每 200ms），引用 `ttsPendingChunks` / `isTtsActive` / `ttsAudioEl`

## 4. Streaming 路径 TTS 与歌曲检索并行化

- [x] 4.1 在 `src/router.js` 顶部添加 `import { execNcm, escapeShellArg } from "./music/ncm-exec.js"`
- [x] 4.2 新增 `prepareMusicStreamData(response)` 函数：纯 I/O 阶段，并行执行 `searchSongs()` + `getAudioUrl()` 获取所有歌曲数据，无副作用（不调用 mpv、不更新 session、不发 SSE）
- [x] 4.3 新增 `commitMusicStreamAndEmit(musicData, emitter)` 函数：副作用阶段，在 TTS 完成后执行 mpv 播放、session 更新、broadcastState、SSE `music` 事件发送
- [x] 4.4 修改 `routeMessageStream()` 中 chat_message 分支（约第 594-620 行）：将 TTS 合成与 `prepareMusicStreamData()` 通过 `Promise.all` 并行执行，TTS 完成后再调用 `commitMusicStreamAndEmit()`
- [x] 4.5 保留 `handleMusicStream()` 函数不变（不再被 streaming 路径调用，但保留作为文档）

## 5. 验证

- [x] 5.1 启动服务器 (`npm run dev`)，确认无启动错误
- [ ] 5.2 测试纯文本对话：发送"你好"，确认 TTS 语音播放正常，音乐播放器 UI 不受影响
- [ ] 5.3 测试 DJ 复合请求：发送"我想听一些轻松的爵士乐"，确认先播放 TTS 语音，TTS 结束后立即播放歌曲（无明显等待）
- [ ] 5.4 测试直接音乐命令：发送"播放周杰伦晴天"，确认直接播放歌曲，无 TTS
- [ ] 5.5 测试换歌命令：发送"换首歌"，确认过渡语 TTS 播放后切换歌曲
- [ ] 5.6 测试 TTS 期间音量压低：播放歌曲时发送对话，确认音乐音量被压低，TTS 结束后恢复
- [ ] 5.7 测试非 streaming 路径 `/api/chat`：确认返回 JSON 响应且不触发 MiniMax TTS API 调用
