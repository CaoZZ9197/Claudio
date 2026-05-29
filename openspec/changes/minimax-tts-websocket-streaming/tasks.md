# tasks.md

## 变更名称
`minimax-tts-websocket-streaming`

## 实施任务

### 阶段一：环境配置更新

- [ ] **1.1** 更新 `.env.example`
  - 新增 `MINIMAX_API_KEY` 配置项
  - 保留现有 `MINIMAX_TTS_VOICE_ID`、`MINIMAX_TTS_SPEED`、`MINIMAX_TTS_VOL`、`MINIMAX_TTS_PITCH`

- [ ] **1.2** 更新 `src/config.js`
  - 在 `apiKeys` 中新增 `minimax: process.env.MINIMAX_API_KEY`
  - 确保 `tts` 配置块包含 voiceId、speed、vol、pitch

### 阶段二：MiniMax WebSocket TTS 客户端

- [x] **2.1** 创建 `src/minimax-ws-tts.js`
  - 实现 Singleton 模式 `getMiniMaxWSTTS()`
  - 实现 `initWSTTS()` - 建立 WebSocket 连接
  - 实现 `shutdownWSTTS()` - 断开连接
  - 实现三步握手协议（task_start → task_continue → task_finish）
  - 实现流式音频回调 `onAudioChunk(chunk)`
  - 实现指数退避重连（1s → 2s → 4s → ... → 30s 上限）
  - 实现串行锁 `_synthesizing`
  - 音频格式：MP3, 32000Hz, 单声道

- [x] **2.2** 导出模块
  - `getMiniMaxWSTTS()` - 获取单例
  - `initWSTTS()` - 初始化连接
  - `shutdownWSTTS()` - 关闭连接

### 阶段三：WebSocket 信令广播

- [x] **3.1** 更新 `src/api/ws.js`
  - 新增 `broadcastTtsStart(text)` - 广播 TTS 开始
  - 新增 `broadcastTtsEnd(success)` - 广播 TTS 结束
  - 新增 `broadcastTtsError(error)` - 广播 TTS 错误
  - 确认现有 `broadcastAudio(chunk)` 可用于 TTS 音频流

### 阶段四：路由器改造

- [x] **4.1** 更新 `src/router.js`
  - 在文件顶部引入 MiniMax TTS 模块
  - 修改 `routeMessage()` 或新增 `routeMessageStream()` 方法
  - 实现 `streamTtsSay(text, onAudioChunk, onComplete)` 函数
  - 确保 Claude 响应文字通过 SSE `text` 事件流式推送
  - 确保 TTS 音频通过 WebSocket `broadcastAudio()` 流式广播

### 阶段五：前端 TTS 协调

- [x] **5.1** 更新 `src/frontend/app.js`
  - 新增状态变量：`wasPlayingMusicBeforeTts`、`pendingMusicData`、`isFirstGreeting`
  - 实现 `handleTtsStart()` - TTS 开始时暂停歌曲
  - 实现 `handleTtsEnd()` - TTS 结束时恢复歌曲或处理延迟的音乐数据
  - 实现 `isGreeting(text)` - 检测问候语
  - 实现 `shouldSpeakTts(text)` - 判断是否触发 TTS（首次问候不触发）
  - 修改 WebSocket `onmessage` 处理 Binary 音频块
  - 修改 SSE `onmessage` 处理 `done` 事件时重置 `isFirstGreeting`

- [x] **5.2** 测试前端协调逻辑
  - 语音播报时歌曲正确暂停
  - 播报完毕后歌曲正确恢复或切换

### 阶段六：集成测试

- [ ] **6.1** 启动服务并测试
  ```
  npm run dev
  ```

- [ ] **6.2** 测试流式输出
  - 发送消息，检查文字和语音是否几乎同步输出

- [ ] **6.3** 测试音乐协调
  - 在歌曲播放时说"来首轻音乐"
  - 检查 Claudio 语音播报时歌曲是否暂停
  - 检查播报完毕后是否正确切换歌曲

- [ ] **6.4** 测试首次问候
  - 重启服务
  - 第一句说"你好"
  - 检查是否仅文字显示，无语音播报

- [ ] **6.5** 测试长连接
  - 连续发送 3-5 条消息
  - 检查 WebSocket 连接是否复用（无重复握手）

- [ ] **6.6** 测试错误处理
  - 断开网络模拟 TTS 失败
  - 检查是否降级为纯文字显示

### 阶段七：文档更新

- [x] **7.1** 更新 `CLAUDE.md`
  - 在 Architecture 部分说明新的 TTS 流式架构
  - 在 Commands 部分确认启动命令不变

---

## 验收标准

1. **流式输出**：Claude 回复时，文字在页面流式展示，语音同步播放，延迟 < 500ms
2. **音乐协调**：
   - 有歌曲播放时说"来首 XX"，语音播报时歌曲暂停，播报完换新歌
   - 无歌曲切换时说"天气怎么样"，语音播报时歌曲暂停，播报完继续播放原歌曲
3. **首次问候**：服务重启后第一句"你好"仅有文字，无语音
4. **长连接**：连续对话时 WebSocket 保持连接，TTS 请求复用同一连接
5. **错误降级**：TTS 失败时不影响对话，仅文字显示