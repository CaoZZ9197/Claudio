# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claudio is a personal AI radio — a localhost smart player that combines Claude AI, music streaming (NetEase Cloud Music), text-to-speech (MiniMax Speech-2.8-Turbo via WebSocket), weather/calendar context, and smart speaker casting (UPnP). It runs as a Node.js server serving a PWA frontend.

## 工程实现方案参考文档
实现原理：D:\CodeProgram\Claudio\实现原理.txt
方案流程：D:\CodeProgram\Claudio\方案流程.txt

## 强制约束
所有对话内容均使用简体中文

## Commands

```bash
npm start       # Start production server (node src/server.js)
npm run dev     # Start with file watching (node --watch src/server.js)
```

## Architecture

### Subsystem Wiring

```
User Input → router.js (intent routing)
                ├── Simple command (play music) → music/netease.js
                └── Complex request → context.js → claudio.js → Claude API
                                                               ↓
                                       ┌───────────────────────┤
                                       ↓                       ↓
                               minimax-tts.js (MiniMax WebSocket TTS)  music/netease.js (play song)
                                       ↓
                               api/ws.js (stream audio via WebSocket to PWA)
```

### Key Files

| File | Role |
|------|------|
| `src/server.js` | Entry point — Express HTTP server + WebSocket |
| `src/router.js` | Intent routing — classifies input as music command vs AI conversation |
| `src/context.js` | Context assembly — packs taste profiles, weather, calendar, history into Claude's system prompt |
| `src/claudio.js` | Claude adapter — calls Anthropic API, parses structured JSON responses |
| `src/scheduler.js` | Cron-based task scheduler (morning briefing, mood check-ins) |
| `src/tts.js` | MiniMax WebSocket TTS (Speech-2.8-Turbo) with streaming audio |
| `src/db.js` | SQLite state — chat history, play records, preferences |
| `src/music/netease.js` | NetEase Cloud Music API wrapper (ncm-cli official API, AppID + PrivateKey) |
| `src/external/weather.js` | OpenWeather API client |
| `src/external/calendar.js` | Feishu API client |
| `src/external/upnp.js` | UPnP device discovery + casting |
| `src/api/routes.js` | REST endpoints |
| `src/api/ws.js` | WebSocket voice streaming |
| `src/frontend/` | Vanilla PWA (HTML/CSS/JS + service worker) |

### Data Storage

- **SQLite**: `~/.claudio/state.db` — chat history, play records, preferences
- **TTS cache**: `~/.claude/tts-cache/` — MP3 files keyed by content hash
- **Taste profiles**: `data/` directory — `taste.md`, `mood-rules.md`, `playlists.json`

### API Endpoints

- `GET /api/now` — Current player state
- `POST /api/chat` — Send message, get AI response
- `GET /api/playlists` — List NetEase playlists
- `POST /api/player/control` — Play/pause/skip/volume
- `GET /api/history` — Play and chat history
- `GET /api/settings` — User preferences
- `WS /stream` — Real-time voice audio streaming

Active change specs live under `openspec/changes/claudio-localhost-ai-radio/specs/`.

## Environment Variables

Copy `.env.example` to `.env` and fill in required keys:
- `ANTHROPIC_API_KEY` (required)
- `MINIMAX_API_KEY` (required for WebSocket TTS)
- `OPENWEATHER_API_KEY`, `FEISHU_APP_ID`, `FEISHU_APP_SECRET` (optional)
- `NETEASE_APP_ID`, `NETEASE_PRIVATE_KEY` (optional — 网易云音乐开放平台凭证)
- Music setup: 安装 `npm install -g @music163/ncm-cli`，然后运行 `ncm-cli configure` 和 `ncm-cli login`
- `PORT` (default: 8080)
- `CLAUDE_MODEL` (default: claude-sonnet-4-6)

### MiniMax TTS Voice Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `MINIMAX_TTS_VOICE_ID` | `female-shaonv` | Voice ID (少女音色) |
| `MINIMAX_TTS_SPEED` | `1.0` | Speech speed |
| `MINIMAX_TTS_VOL` | `1.0` | Volume |
| `MINIMAX_TTS_PITCH` | `0` | Pitch |

## 编写规范

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```