## 1. 电台队列管理 (radio-session.js)

- [ ] 1.1 扩展 radio-session.js 的 session 结构：添加 `queue[]`、`currentTrack`、扩充 `playedIds` 上限至 200 条、添加 `searchContext` 字段
- [ ] 1.2 实现队列操作函数：`setQueue(queue)`、`getQueue()`、`dequeueNext()`、`clearQueue()`、`needsRefill()`、`getPlayedIds()`
- [ ] 1.3 `clearQueue()` 保留 session 上下文（scene/mood/context），仅清空队列和当前曲目

## 2. 音乐搜索增强 (music/netease.js)

- [ ] 2.1 `searchSongs()` 新增 `excludeIds` 参数，客户端过滤掉已播放的歌曲 ID
- [ ] 2.2 `searchSongs()` 默认 `limit` 从 30 改为可配置，电台模式调用时使用更大的 limit（如 50）
- [ ] 2.3 电台搜索返回结果不少于 5 首（过滤后不足时尝试放宽搜索条件或标记 insufficient）

## 3. 意图路由升级 (router.js)

- [ ] 3.1 新增 `SWITCH_MUSIC_PATTERNS` 正则数组，匹配"换首/切换/换点/来点别的/不想听"等切换意图
- [ ] 3.2 `classifyIntent()` 在 CONVERSATION_PATTERNS 检测之后、DIRECT_MUSIC_PREFIXES 之前插入 switch 检测，返回 `"switch_music_type"`
- [ ] 3.3 新增 `extractSwitchKeyword()` 函数，从切换消息中提取目标音乐类型关键词
- [ ] 3.4 新增 `handleSwitchMusicType(message)` 处理函数：
  - 调用 `clearQueueAndStop()` 清空队列并广播停止信号
  - 并行调用 Claude（生成过渡语）+ Netease（搜索至少 5 首新歌）
  - 设置新队列（`replaceQueue: true`）
  - 返回 `{ say, song, queue, replaceQueue, session }`
- [ ] 3.5 修改 `routeMessageStream()`，对 `switch_music_type` 意图走新的处理分支

## 4. DJ 提示词调整 (context.js)

- [ ] 4.1 更新 `assemblePrompt()` 中的 DJ 人设指令，明确切换场景和续播场景的行为区分
- [ ] 4.2 `buildContinuePrompt()` 传入 `excludeIds` 列表，确保续搜指令中包含去重提示

## 5. API 响应调整 (api/routes.js)

- [ ] 5.1 确保 `/api/chat/stream` 的 music 事件中包含 `message` 字段（如"正在播放：周杰伦 - 晴天"），用于前端展示

## 6. 前端"正在播放"展示 (frontend/)

- [ ] 6.1 `app.js` 中 SSE `music` 事件处理：当收到 `message` 字段时，在当前助手消息气泡末尾追加 `<div class="now-playing-info">` 元素
- [ ] 6.2 `styles.css` 添加 `.now-playing-info` 样式：小号字体、柔和颜色、与正文视觉区分
- [ ] 6.3 `app.js` 中 `handleMusicStream` 或等效逻辑：确保普通播放指令不在聊天中追加"正在播放"，仅切换或 DJ 推荐时追加

## 7. 端到端验证

- [ ] 7.1 测试"换点轻松的"：验证队列被清空、新歌开始播放、聊天消息显示"正在播放XXX"
- [ ] 7.2 测试"今天天气怎么样"：验证助手正常回复、当前歌曲继续播放、无"正在播放"追加
- [ ] 7.3 测试队列自动续播：让队列播完（或手动跳过），验证自动续搜同类型歌曲且无重复
- [ ] 7.4 测试"播放周杰伦"：验证直接播放指令不受影响，仍走原有 `music_command` 流程
