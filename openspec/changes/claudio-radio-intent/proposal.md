## Why

Claudio 目前的意图路由仅区分"直接音乐指令"和"AI对话"，缺乏对"切换歌曲类型"意图的识别。用户说"换点轻松的"时，系统不知道这是要清空队列并切换风格，还是只是聊天。同时，电台续播机制不完善——搜索结果数量不足、播放完后不会自动续补、已播放歌曲可能重复出现。

## What Changes

- 新增**歌曲类型切换意图识别**：当用户表达切换音乐风格/类型/心情的意图时，识别为"切换歌曲类型"场景，清空当前队列、停止播放、检索并播放新类型歌曲
- **响应带播放信息**：当发生歌曲切换时，助手回复下方展示"正在播放XXXX"信息
- **对话保持播放**：当无切换意图时，助手正常回复，当前歌曲继续播放不受影响
- **电台搜索保底**：切换歌曲类型时至少检索 5 首相关歌曲
- **电台自动续播**：队列播完后自动继续检索同类型歌曲，且不与历史已播放歌曲重复

## Capabilities

### New Capabilities
- `radio-intent`: 电台意图识别——区分"切换歌曲类型"、"一般对话"、"直接播放指令"三种意图；含场景切换时的队列清空和续播策略
- `radio-queue-management`: 电台队列管理——队列维护、播放完毕自动续搜、已播放歌曲去重

### Modified Capabilities
- `intent-routing`: 意图分类从二分类扩展为三分类，新增"switch_music_type"意图类型
- `music-service`: 搜索结果增加去重过滤参数，确保至少返回5首
- `pwa-frontend`: 聊天消息气泡支持内嵌"正在播放"信息展示

## Impact

- `src/router.js` — classifyIntent 新增切换歌曲类型识别逻辑；handleChatMessage 区分切换/非切换两种路径
- `src/context.js` — DJ 人设提示词更新，明确切换/非切换时的行为差异
- `src/music/netease.js` — 搜索支持去重过滤参数
- `src/radio-session.js` — 实现队列管理和去重追踪
- `src/api/routes.js` — /api/chat/stream 响应结构可能需要扩展
- `src/frontend/app.js` — 消息渲染支持"正在播放"展示
- `src/frontend/styles.css` — "正在播放"样式
- `prompts/dj-persona.md` — DJ 人设提示词可能需要微调
