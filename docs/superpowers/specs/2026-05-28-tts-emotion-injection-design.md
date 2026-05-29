# TTS 情感注入 — 设计文档

## 概述

让 Claudio 的 TTS 语音播报根据对话上下文携带恰当的情感表达。由 Claude 分析对话语境自行判断当前该用什么情绪播报，在 JSON 响应中返回 `emotion` 字段，TTS 引擎据此注入情感参数。

## 情感词汇表

| emotion | 适用场景 | MiniMax 映射 | Edge-TTS 降级 (rate/pitch) |
|---------|---------|-------------|--------------------------|
| `calm` | 默认/中性播报 | `voice_setting.emotion: "calm"` | 使用 config 默认值 |
| `cheerful` | 好消息、积极推荐 | `voice_setting.emotion: "happy"` | `+8%` / `+10Hz` |
| `gentle` | 安慰、深夜陪伴 | `voice_setting.emotion: "sad"` | `-10%` / `-5Hz` |
| `excited` | 惊喜推荐、特别时刻 | `voice_setting.emotion: "surprised"` | `+12%` / `+15Hz` |

MiniMax 直接使用原生 `emotion` 参数，Edge-TTS 通过 prosody（语速/音调调整）近似模拟。

## 数据流

```
用户消息 → Claude (prompt 要求返回 emotion) → JSON 响应含 emotion 字段
                                                    ↓
                                          parseResponse 透传 emotion
                                                    ↓
                                    streamTtsSay(text, emotion)
                                                    ↓
                              getTTS().synthesize(text, onAudioChunk, emotion?)
                                                    ↓
                          ┌─────────────────────────────┴────────────────┐
                          ↓                                              ↓
                  minimax-tts.js                                 edge-tts.js
           voice_setting.emotion = "happy"                rate/pitch 映射降级
```

## 改动点

### 1. `prompts/dj-persona.md` — 新增 emotion 字段

在 JSON 格式定义中新增可选字段 `emotion`，并附指令说明何时使用。

### 2. `src/claudio.js` — parseResponse 透传 emotion

DJ 响应解析时提取 `emotion` 字段到 `params`。

### 3. `src/router.js` — streamTtsSay 传递 emotion

`streamTtsSay()` 增加可选参数，透传到 `ttsEngine.synthesize()`。

### 4. `src/minimax-tts.js` — synthesize 支持 emotion

`synthesize(text, onAudioChunk, emotion?)` — 如果传入 emotion，在 `voice_setting` 中加入对应字段。

### 5. `src/edge-tts.js` — synthesize 支持 emotion

`synthesize(text, onAudioChunk, emotion?)` — 如果传入 emotion，用 rate/pitch 映射表调整 prosody 参数。

### 6. `src/scheduler.js` — 定时任务适配

`morningBroadcastHandler` 和 `moodCheckHandler` 的 TTS 调用传入 `"cheerful"`（早安播报）和 `"gentle"`（心情问候）。

## 接口兼容性

- `emotion` 在所有位置均为可选参数
- 不传 `emotion` 时行为与当前完全一致
- `getTTS().synthesize()` 签名向后兼容

## 验证

1. 启动 MiniMax 模式，发送 emo 消息，确认 `voice_setting` 包含 emotion 字段
2. 启动 Edge-TTS 模式，发送积极消息，确认 rate/pitch 被覆盖
3. 不触发 emotion（普通对话），确认行为与改动前一致
4. 检查 scheduler 定时播报的情感参数正确
