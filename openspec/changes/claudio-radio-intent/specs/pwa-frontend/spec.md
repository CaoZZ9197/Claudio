## ADDED Requirements

### Requirement: Now playing indicator in chat
The PWA SHALL display a "正在播放" (Now Playing) indicator within the assistant's chat message bubble when a music type switch occurs, showing the current song title and artist.

#### Scenario: Now playing shown on music switch
- **WHEN** the server sends a `music` SSE event with a `message` field (e.g., "正在播放：周杰伦 - 晴天") during an active chat stream
- **THEN** the PWA SHALL append a styled "正在播放" element to the current assistant message bubble

#### Scenario: Now playing not shown on normal play
- **WHEN** a song starts playing via direct music command without a chat context
- **THEN** the PWA SHALL update the player bar UI but SHALL NOT add a "正在播放" indicator to any chat message

#### Scenario: Now playing styling
- **WHEN** the "正在播放" indicator is displayed in a chat message
- **THEN** it SHALL be visually distinct from the main message text (e.g., smaller font, muted color, music icon) and appear below the DJ transition text
