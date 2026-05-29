## Context

Claudio is a greenfield localhost personal AI radio/smart player. There is no existing codebase. The system runs on a local machine, serving a PWA frontend on localhost:8080 and orchestrating multiple external APIs (Claude, NetEase Cloud Music, Fish Audio, OpenWeather, Feishu, UPnP). The core innovation is the "Context Assembly" pipeline — packing user taste profiles, environment data, and conversation history into Claude's system prompt so it acts as a knowledgeable DJ.

**Constraints:**
- Runs entirely on localhost (no cloud deployment initially)
- Must work without internet for basic playback (offline cache), but core AI features require connectivity
- Single-user system (personal use)
- User taste profiles stored as local markdown/JSON files

## Goals / Non-Goals

**Goals:**
- Build a modular Node.js backend with clear separation between subsystems
- Enable Claude to make intelligent music recommendations and voice broadcasts based on context
- Support PWA frontend for mobile/desktop access
- Persist state across restarts (chat history, play records, preferences)
- Integrate real-world context (weather, calendar) into AI decision-making

**Non-Goals:**
- Multi-user support (this is a personal, single-user system)
- Cloud hosting / remote access (localhost only)
- Music file storage / library management (streaming-only via NetEase)
- Mobile native apps (PWA only)
- Authentication / authorization system

## Decisions

### 1. Project structure: Feature-based layout

```
src/
  server.js          # Entry point, wires all subsystems
  router.js          # Intent routing
  context.js          # Prompt assembly
  claudio.js         # Claude adapter
  scheduler.js       # Cron tasks
  tts.js             # TTS pipeline
  db.js              # SQLite state management
  config.js          # Config loader (.env + defaults)

  music/
    netease.js       # NetEase API wrapper

  external/
    weather.js       # OpenWeather client
    calendar.js      # Feishu client
    upnp.js          # UPnP device discovery + control

  api/
    routes.js        # Express route definitions
    ws.js            # WebSocket handler

  frontend/          # PWA (served as static files in prod)
    index.html
    app.js
    sw.js
    styles.css
```

**Rationale**: Flat structure with grouped external integrations keeps the project small and navigable. Sub-folders only for multi-file modules (frontend, external integrations). Avoids deep nesting for a solo project.

**Alternative**: Monorepo with packages/ — overkill for a single-developer project with ~20 source files.

### 2. HTTP framework: Express + ws

Express for REST API routes, `ws` library for WebSocket voice streaming.

**Rationale**: Express is ubiquitous, well-documented, and lightweight. No need for Fastify's performance in a single-user localhost app. `ws` is the simplest WebSocket implementation for Node.js.

### 3. Database: SQLite via better-sqlite3

Single file database at `~/.claudio/state.db`. Synchronous API simplifies code.

**Rationale**: Zero setup (no daemon), single file, easy backup. better-sqlite3 is synchronous which matches the mostly-sequential request handling pattern. SQLite handles single-user workloads with no issues.

**Alternative**: Lowdb/JSON files — insufficient for querying play history. PostgreSQL — overkill, requires installation and daemon.

### 4. Claude API: Subprocess spawning via claudio.js

The Claude adapter spawns a child process (Python or direct HTTP call) to invoke the Anthropic API, waiting for a structured JSON response.

**Rationale**: Subprocess isolation prevents API issues from crashing the main server. JSON response format ensures predictable parsing. The adapter parses Claude's output and returns typed action objects (e.g., `{ action: "play_music", query: "..." }`) to the router.

**Alternative**: Direct SDK usage in Node.js — simpler but couples API lifecycle to server process.

### 5. TTS: Fish Audio with local MP3 cache

TTS responses are cached by content hash in `~/.claudio/tts-cache/`. Before calling Fish Audio, check cache. This avoids re-synthesizing repeated phrases (e.g., "Good morning!").

**Rationale**: Fish Audio charges per character. Caching common phrases saves cost and reduces latency.

### 6. Frontend: Vanilla PWA (no framework)

Plain HTML/CSS/JS with a service worker for offline caching. No React/Vue/Svelte.

**Rationale**: The UI is simple (player + chat + settings). A framework adds build complexity without proportional benefit. Service worker enables "add to home screen" mobile experience.

### 7. Scheduler: node-cron

Cron expressions for recurring tasks. Tasks are defined centrally in scheduler.js and registered at server startup.

**Rationale**: node-cron is the standard Node.js cron library. Simpler than external cron or systemd timers for a self-contained app.

### 8. API Design: REST + WebSocket

Six core REST endpoints:
1. `GET /api/now` — Current player state
2. `POST /api/chat` — Send user message, get AI response
3. `GET /api/playlists` — List playlists
4. `POST /api/player/control` — Play/pause/skip/volume
5. `GET /api/history` — Play and chat history
6. `GET /api/settings` — User preferences

One WebSocket endpoint:
- `WS /stream` — Voice audio streaming to frontend

**Rationale**: REST for request/response, WebSocket for real-time audio streaming. Simple, predictable contract.

## Risks / Trade-offs

- **Claude API latency**: Context assembly creates large prompts (taste files + weather + history). Large prompts take 2-5s to process. → Mitigation: Show "thinking" state in UI. Consider caching common prompt prefixes.
- **NetEase API instability**: Unofficial API may change without notice. → Mitigation: Abstract behind music/ interface so the implementation can be swapped.
- **TTS cost**: Fish Audio charges per character; long broadcasts get expensive. → Aggressive caching and prompt optimization to keep TTS text concise.
- **Single-user limitation**: Hard to retrofit multi-user support. → Acceptable; this is explicitly a personal tool.
- **Windows compatibility**: Some Node.js native modules (better-sqlite3) need compilation on Windows. → Use prebuilt binaries where available; document build prerequisites.

## Open Questions

- Should the Claude adapter use direct HTTP (Anthropic SDK) or subprocess? (Design assumes subprocess, but Node.js SDK is simpler)
- File paths for taste files: project directory or `~/.claudio/` user directory?
- UPnP discovery: automatic on startup or manual device pairing?
