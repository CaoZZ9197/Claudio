## 1. Project Setup

- [x] 1.1 Initialize Node.js project with package.json, set type to "module"
- [x] 1.2 Install core dependencies (express, ws, better-sqlite3, node-cron, @anthropic-ai/sdk, dotenv)
- [x] 1.3 Create project directory structure per design.md (src/, src/music/, src/external/, src/api/, src/frontend/)
- [x] 1.4 Implement config.js: load .env file, validate required keys, export config object with defaults
- [x] 1.5 Create .env.example with all required API keys and configuration variables

## 2. State Management (state-management spec)

- [x] 2.1 Implement db.js: SQLite database initialization with better-sqlite3
- [x] 2.2 Create messages table schema (id, role, content, timestamp) and CRUD functions
- [x] 2.3 Create plays table schema (id, title, artist, album, source_id, timestamp) and CRUD functions
- [x] 2.4 Create preferences table schema (key, value) with get/set/delete functions
- [x] 2.5 Implement automatic cleanup for messages exceeding max count (default 10,000)

## 3. Core Server (core-server spec)

- [x] 3.1 Implement server.js: Express app creation, JSON body parsing, CORS setup
- [x] 3.2 Serve PWA static files from src/frontend/ at root path `/`
- [x] 3.3 Implement graceful shutdown handler (SIGTERM/SIGINT → close DB, close WS connections, exit)
- [x] 3.4 Register API routes from api/routes.js and WebSocket handler from api/ws.js
- [x] 3.5 Add server startup logging with bound port and available routes

## 4. External Services (external-services spec)

- [x] 4.1 Implement external/weather.js: OpenWeather current conditions and 3-day forecast fetch
- [x] 4.2 Implement external/calendar.js: Feishu API today's events fetch with authentication
- [x] 4.3 Implement external/upnp.js: UPnP MediaRenderer device discovery on local network
- [x] 4.4 Implement external/upnp.js: Cast audio URL to selected device via SetAVTransportURI

## 5. Context Assembly (context-assembly spec)

- [x] 5.1 Implement taste profile loader: read taste.md, mood-rules.md, playlists.json from data directory
- [x] 5.2 Implement context.js: orchestrate weather + calendar + history fetch from state DB
- [x] 5.3 Implement prompt assembly: combine DJ persona, taste files, environment data, history into single system prompt string
- [x] 5.4 Handle partial failures: proceed with available data when external APIs are unreachable

## 6. Claude Adapter (claude-adapter spec)

- [x] 6.1 Implement claudio.js: Anthropic SDK client initialization with API key from config
- [x] 6.2 Implement prompt sending: package system prompt + user message, call Claude API, return response
- [x] 6.3 Implement JSON response parser: extract action JSON from Claude response, validate action types
- [x] 6.4 Implement fallback: return { action: "say" } for non-JSON or malformed responses
- [x] 6.5 Handle API errors: timeout (30s default), rate limiting, authentication failures

## 7. Music Service (music-service spec)

- [x] 7.1 Implement music/netease.js: search songs by keyword (title, artist)
- [x] 7.2 Implement playlist fetch: get playlist metadata and track list by playlist ID
- [x] 7.3 Implement lyrics fetch: get lyrics by track ID
- [x] 7.4 Implement audio URL resolution: get playable stream URL by track ID
- [x] 7.5 Handle API errors: no results, copyright restrictions, network failures

## 8. TTS Pipeline (tts-pipeline spec)

- [x] 8.1 Implement tts.js: Fish Audio API client for text-to-speech conversion
- [x] 8.2 Implement content-hash caching: SHA256 hash of input text → check/create cache file in tts-cache directory
- [x] 8.3 Implement cache serving: register `/audio/tts/:hash.mp3` route for cached audio file retrieval
- [x] 8.4 Handle API errors and return appropriate error responses for missing/invalid audio files

## 9. Voice Streaming (voice-streaming spec)

- [x] 9.1 Implement api/ws.js: WebSocket server creation, connection upgrade at `/stream`
- [x] 9.2 Implement client tracking: maintain connected client set, handle connect/disconnect lifecycle
- [x] 9.3 Implement audio chunk streaming: read MP3 file in chunks, send binary frames to connected clients
- [x] 9.4 Implement stream state messages: broadcast JSON state updates (playing, paused, stopped)
- [x] 9.5 Handle multiple concurrent clients receiving the same audio stream

## 10. Intent Routing (intent-routing spec)

- [x] 10.1 Implement router.js: classify user input as `music_command` or `chat_message`
- [x] 10.2 Implement music command routing: extract query, call music service, return results
- [x] 10.3 Implement chat routing: trigger context assembly → Claude adapter → parse response → execute actions
- [x] 10.4 Implement action dispatcher: handle Claude's action types (play_music, say, announce_weather, announce_schedule, mood_check, control_player)

## 11. Task Scheduler (task-scheduler spec)

- [x] 11.1 Implement scheduler.js: node-cron registration system for named tasks with cron expressions
- [x] 11.2 Implement morning planning task: assemble day context and cache recommendations (default 7:00 AM)
- [x] 11.3 Implement morning broadcast task: generate and TTS-synthesize greeting with weather + schedule summary (default 9:00 AM)
- [x] 11.4 Implement mood check task: periodic mood inquiry and response handling (default every 3 hours)
- [x] 11.5 Implement task error isolation: catch handler errors without affecting scheduler or other tasks

## 12. API Routes (core-server spec)

- [x] 12.1 Implement GET /api/now: return current player state (playing track, position, volume)
- [x] 12.2 Implement POST /api/chat: accept user message, run through router, return AI response with optional actions
- [x] 12.3 Implement GET /api/playlists: return available playlists from music service
- [x] 12.4 Implement POST /api/player/control: accept play/pause/skip/volume commands
- [x] 12.5 Implement GET /api/history: return paginated play history and chat history from state DB
- [x] 12.6 Implement GET /api/settings: return user preferences from state DB

## 13. PWA Frontend (pwa-frontend spec)

- [x] 13.1 Create index.html: app shell with player bar, chat panel, profile view, and settings view
- [x] 13.2 Implement player UI: now-playing display, play/pause button, skip button, volume slider, progress bar
- [x] 13.3 Implement chat UI: message list with auto-scroll, text input, loading/thinking indicator
- [x] 13.4 Implement profile UI: editable text areas for taste.md, mood-rules.md, and playlists.json
- [x] 13.5 Implement settings UI: API key fields, preferences form, scheduler time configuration
- [x] 13.6 Implement app.js: API client connecting all UI components to REST endpoints and WebSocket
- [x] 13.7 Implement sw.js: service worker caching app shell (HTML, CSS, JS, icons)
- [x] 13.8 Create web manifest (manifest.json) with app name, icons, display: standalone, theme color
- [x] 13.9 Implement styles.css: responsive layout, dark theme, mobile-friendly design

## 14. Integration & Verification

- [ ] 14.1 Test server startup: npm start binds to port 8080, serves PWA index page
- [ ] 14.2 Test chat flow: POST /api/chat → router → context assembly → Claude → response
- [ ] 14.3 Test music flow: music command → NetEase search → audio URL resolution
- [ ] 14.4 Test TTS flow: text → Fish Audio → MP3 cache → audio URL served
- [ ] 14.5 Test WebSocket: client connects to /stream, receives audio chunks on playback
- [ ] 14.6 Test scheduler: register test task, verify execution at cron time
- [ ] 14.7 Test PWA: open in browser, verify all UI panels, send chat message, control player
- [ ] 14.8 Test state persistence: restart server, verify chat history and preferences survive
