## Why

There is no personal AI radio that truly understands the user's music taste, daily context (weather, calendar, mood), and can act as a knowledgeable DJ — blending music playback with contextual voice broadcast. Claudio fills this gap by running entirely on localhost, keeping personal data private while integrating Claude AI, music streaming, TTS, and smart home control into one cohesive experience.

## What Changes

- Build a Node.js core server that orchestrates all subsystems
- Implement intent routing to distinguish simple music commands from complex AI conversations
- Create a context assembly pipeline that packs user taste profiles, environment data, and conversation history into Claude's system prompt
- Integrate Claude API as the central AI brain, parsing structured JSON responses for downstream execution
- Build a task scheduler for time-based behaviors (morning briefing, mood-aware check-ins)
- Implement a TTS pipeline using Fish Audio with MP3 caching
- Create a persistent state layer (SQLite) for chat history, play records, and user preferences
- Build a PWA frontend with player controls, user profile, settings, and chat interface
- Integrate NetEase Cloud Music API for search, playlists, and lyrics
- Integrate external services: OpenWeather (weather), Feishu (calendar), UPnP (smart speaker casting)
- Implement WebSocket-based voice streaming to the frontend

## Capabilities

### New Capabilities

- `core-server`: HTTP and WebSocket server infrastructure — the backbone that wires all subsystems together and serves the PWA frontend
- `intent-routing`: Command classification that determines whether user input is a simple music play request (routed to NetEase) or a complex conversational request (routed to Claude)
- `context-assembly`: System prompt construction that combines user taste profiles (taste.md, mood-rules.md, playlists.json), daily patterns, weather/calendar data, and conversation history into a single prompt for Claude
- `claude-adapter`: Claude API integration layer — spawns subprocess calls to Claude, parses structured JSON responses, and dispatches actions
- `task-scheduler`: Cron-based scheduler for recurring tasks (morning planning at 7am, morning broadcast at 9am, mood check-ins throughout the day)
- `tts-pipeline`: Text-to-speech synthesis via Fish Audio API with MP3 file caching for instant replay
- `state-management`: SQLite-based persistent storage for chat history, play records, user preferences, and cross-restart memory
- `pwa-frontend`: Progressive Web App with player controls, user profile management, settings panel, and chat/message interface
- `music-service`: NetEase Cloud Music API wrapper for song search, playlist retrieval, and lyrics fetching
- `external-services`: Integration layer for OpenWeather (current weather + forecast), Feishu (daily calendar), and UPnP (smart speaker discovery and casting)
- `voice-streaming`: WebSocket-based audio streaming from server to PWA frontend for real-time voice playback

### Modified Capabilities

<!-- No existing capabilities — this is a greenfield project -->

## Impact

- **New project**: All files are new, no existing code is modified
- **Dependencies**: Node.js, Express/ws, `better-sqlite3`, `node-cron`, Anthropic SDK, NetEase Cloud Music API, Fish Audio API, OpenWeather API, Feishu API, UPnP libraries
- **Infrastructure**: Runs on localhost:8080 (configurable), requires API keys for Claude, Fish Audio, OpenWeather, Feishu, and NetEase Cloud Music
