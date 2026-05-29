## ADDED Requirements

### Requirement: Detect switch music type intent
The system SHALL classify user messages that express a desire to change the current music type/style/mood as `switch_music_type` intent.

#### Scenario: User wants to switch music style
- **WHEN** user sends "换点轻松的音乐" (switch to lighter music)
- **THEN** the router SHALL classify it as `switch_music_type` and extract the target type keyword "轻松的音乐"

#### Scenario: User wants to switch mood
- **WHEN** user sends "换个欢快点的" (switch to something more upbeat)
- **THEN** the router SHALL classify it as `switch_music_type` with keyword "欢快"

#### Scenario: User explicitly rejects current music
- **WHEN** user sends "不想听这个了" (don't want to listen to this anymore)
- **THEN** the router SHALL classify it as `switch_music_type` and use a default/fallback recommendation

#### Scenario: Normal conversation with music mention
- **WHEN** user sends "这首歌是谁唱的" (who sings this song)
- **THEN** the router SHALL NOT classify it as `switch_music_type`; it remains `chat_message`

### Requirement: Clear queue and stop playback on switch
When a `switch_music_type` intent is detected, the system SHALL clear the current playlist queue and stop the currently playing song before starting new playback.

#### Scenario: Queue cleared on switch
- **WHEN** the system processes a `switch_music_type` intent
- **THEN** the current playlist queue SHALL be emptied and the current song playback SHALL be stopped before new songs are queued

#### Scenario: Queue untouched on normal chat
- **WHEN** the system processes a `chat_message` intent without music type switching
- **THEN** the current playlist queue and playback SHALL remain unchanged

### Requirement: DJ response with playing info on switch
When a music type switch occurs, the system SHALL include the current playing song information ("正在播放XXXX") in the assistant's chat response.

#### Scenario: Now playing shown after switch
- **WHEN** the system switches to a new music type and plays the first song
- **THEN** the assistant response SHALL include a "正在播放：<song title> - <artist>" indicator appended to the chat message

#### Scenario: No playing info on normal chat
- **WHEN** the system replies to a normal chat_message without switching music
- **THEN** the assistant response SHALL NOT include "正在播放" information (the existing player UI already shows it)

### Requirement: Switching triggers Claude DJ segue
When switching music types, the system SHALL generate a brief DJ transition message via Claude that acknowledges the switch and introduces the new music style.

#### Scenario: DJ transition on switch
- **WHEN** a `switch_music_type` intent is processed
- **THEN** Claude SHALL generate a short transitional response (e.g., "好的，为你切换成轻松的爵士乐，希望你喜欢") before the now-playing info
