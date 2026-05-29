## MODIFIED Requirements

### Requirement: Handle Claude action responses
When Claude returns an action (e.g., play music, announce weather), the router SHALL execute the corresponding subsystem calls.

#### Scenario: Claude requests music playback in streaming path
- **WHEN** Claude returns `{ "action": "play_music", "query": "calm piano" }` in the SSE streaming path
- **THEN** the router SHALL start TTS synthesis (if `say` text present) AND music search/unlock in parallel; after TTS completes, it SHALL commit music side effects (mpv playback, session update, SSE `music` event)

#### Scenario: Claude returns DJ compound response in streaming path
- **WHEN** Claude returns `{ "action": "dj_response", "params": { "say": "...", "play": ["query1", "query2"] } }` in the SSE streaming path
- **THEN** the router SHALL start `streamTtsSay(say)` AND `searchSongs` + `getAudioUrl` for all play queries in parallel; after TTS completes, it SHALL commit music playback and emit SSE events

#### Scenario: Music event emitted after TTS completes
- **WHEN** TTS synthesis completes (success or error) and pre-fetched music data is available
- **THEN** the router SHALL start mpv playback, update the radio session, broadcast player state, and emit the `music` SSE event

### Requirement: Route to correct handler
The router SHALL dispatch classified intents to the appropriate subsystem and return the response to the caller.

#### Scenario: Music routing
- **WHEN** intent is `music_command`
- **THEN** the router SHALL call the music service with the parsed query and return the track/playlist result

#### Scenario: Chat routing
- **WHEN** intent is `chat_message`
- **THEN** the router SHALL trigger context assembly, call the Claude adapter, parse the response, execute any actions, and return the AI response

### Requirement: Classify user input
The system SHALL classify incoming user messages into either "music_command", "switch_music_type", or "chat_message" based on content analysis.

#### Scenario: Music play command detected
- **WHEN** the user sends "播放周杰伦的晴天" (play Jay Chou's Sunny Day)
- **THEN** the router SHALL classify it as `music_command` and route to the music service

#### Scenario: Chat message detected
- **WHEN** the user sends "今天天气怎么样" (how's the weather today)
- **THEN** the router SHALL classify it as `chat_message` and route to the Claude adapter with full context

#### Scenario: Ambiguous input
- **WHEN** the user sends "来点音乐" (give me some music)
- **THEN** the router SHALL classify it as `music_command` and use the user's default mood/taste for selection
