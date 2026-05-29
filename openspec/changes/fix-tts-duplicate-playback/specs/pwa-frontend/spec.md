## MODIFIED Requirements

### Requirement: TTS playback ducking
During TTS voice playback, the music volume SHALL be temporarily reduced (ducked) rather than fully paused, and restored when TTS ends.

#### Scenario: Music ducks during TTS
- **WHEN** `tts_start` WebSocket message is received and music is playing
- **THEN** `#audio-player` volume SHALL be set to 30% of the user-configured volume level

#### Scenario: Music volume restored after TTS
- **WHEN** `tts_end` or `tts_error` WebSocket message is received
- **THEN** `#audio-player` volume SHALL be restored to the user-configured volume level

#### Scenario: TTS end does not trigger browser fallback on duplicate message
- **WHEN** `handleTtsEnd()` is called with MiniMax audio chunks available (`ttsPendingChunks.length > 0`)
- **THEN** `lastTtsText` SHALL be cleared immediately before creating and playing the audio Blob, ensuring any subsequent duplicate `tts_end` message does NOT trigger browser SpeechSynthesis fallback

### Requirement: Deferred music playback during TTS
When a `music` SSE event arrives while TTS is active, the frontend SHALL defer playback until TTS completes.

#### Scenario: Music event deferred
- **WHEN** a `music` SSE event is received and `isTtsActive` is true
- **THEN** the music data SHALL be stored in `pendingMusicData` for later processing

#### Scenario: Deferred music played after TTS
- **WHEN** `tts_end` is received and `pendingMusicData` is not null
- **THEN** `processMusicAction(pendingMusicData)` SHALL be called and `pendingMusicData` SHALL be cleared
