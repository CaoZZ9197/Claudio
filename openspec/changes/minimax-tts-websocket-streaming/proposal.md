# proposal.md

## 变更名称
`minimax-tts-websocket-streaming`

## 概述
将 Claudio 的语音播报功能从 Fish Audio TTS 切换为 MiniMax Speech-2.8-Turbo 模型，通过 WebSocket 协议实现同步语音合成。实现流式语音播报，使 Claudio 的回复能够实时语音输出，打造真正的 AI 虚拟 DJ 交互体验。

## 问题背景

当前 Claudio 使用 Fish Audio TTS 进行语音合成，存在以下问题：

1. **非流式合成**：Fish Audio 需要完整文本才能开始合成，无法实现实时语音输出
2. **播报延迟**：用户需要等待完整语音合成后才能听到播报
3. **缺乏互动感**：文字和语音无法同步输出，AI 感不足

用户期望 Claudio 作为 AI 虚拟 DJ，能够在对话过程中实时输出语音和文字，营造流畅的语音交互体验。

## 解决方案

使用 MiniMax 的 WebSocket 同步语音合成 API：

1. **流式语音合成**：利用 MiniMax WebSocket API 的流式特性，边合成边输出音频
2. **文字流式展示**：Claude 响应文字通过 SSE 流式推送，前端同步展示
3. **音乐协调控制**：语音播报时暂停歌曲播放，播报完毕后根据上下文决定继续播放或切换歌曲

## 预期效果

1. Claude 回复内容流式在页面展示，同时播放合成语音
2. 语音与文字几乎同步输出，延迟最小化
3. 歌曲播放与语音播报正确协调，不互相干扰
4. 首次问候语（"你好"）不触发语音播报

## 影响范围

- **新增文件**：`src/minimax-tts.js`（已存在，需改造）、`src/minimax-ws-tts.js`（新 WebSocket TTS 客户端）
- **修改文件**：`src/router.js`（TTS 调用改造）、`src/api/ws.js`（音频流广播）、`src/frontend/app.js`（前端协调）
- **配置变更**：`.env.example`（新增 MiniMax TTS 相关配置）

## 非影响范围

- 不改变 Claude 的 AI 决策逻辑
- 不改变音乐搜索和播放的核心逻辑
- 不改变现有的 SQLite 数据存储结构