## ADDED Requirements

### Requirement: Classify user input
The system SHALL classify incoming user messages into either "music_command" or "chat_message" based on content analysis.

#### Scenario: Music play command detected
- **WHEN** the user sends "播放周杰伦的晴天" (play Jay Chou's Sunny Day)
- **THEN** the router SHALL classify it as `music_command` and route to the music service

#### Scenario: Chat message detected
- **WHEN** the user sends "今天天气怎么样" (how's the weather today)
- **THEN** the router SHALL classify it as `chat_message` and route to the Claude adapter with full context

#### Scenario: Ambiguous input
- **WHEN** the user sends "来点音乐" (give me some music)
- **THEN** the router SHALL classify it as `music_command` and use the user's default mood/taste for selection

### Requirement: Route to correct handler
The router SHALL dispatch classified intents to the appropriate subsystem and return the response to the caller.

#### Scenario: Music routing
- **WHEN** intent is `music_command`
- **THEN** the router SHALL call the music service with the parsed query and return the track/playlist result

#### Scenario: Chat routing
- **WHEN** intent is `chat_message`
- **THEN** the router SHALL trigger context assembly, call the Claude adapter, parse the response, execute any actions, and return the AI response

### Requirement: Handle Claude action responses
When Claude returns an action (e.g., play music, announce weather), the router SHALL execute the corresponding subsystem calls.

#### Scenario: Claude requests music playback
- **WHEN** Claude returns `{ "action": "play_music", "query": "calm piano" }`
- **THEN** the router SHALL call the music service with "calm piano" and stream the result
