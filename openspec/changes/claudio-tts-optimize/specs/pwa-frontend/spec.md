## MODIFIED Requirements

### Requirement: Player UI
The PWA SHALL display a music player interface with play/pause, skip, volume control, and now-playing information.

#### Scenario: Now playing display
- **WHEN** a song is playing
- **THEN** the player SHALL show the song title, artist, album art (if available), playback progress, and duration

#### Scenario: Playback controls
- **WHEN** the user clicks play/pause, skip, or adjusts volume
- **THEN** the PWA SHALL send the corresponding control command to `POST /api/player/control`

#### Scenario: TTS does not affect now-playing display
- **WHEN** TTS voice playback is active
- **THEN** the player UI SHALL continue displaying the last/current music track information; the progress bar SHALL NOT update based on TTS playback; the play/pause button SHALL reflect music state, not TTS state

## ADDED Requirements

### Requirement: Dedicated TTS audio element
The PWA SHALL include a dedicated `<audio>` element (`#tts-player`) for TTS voice playback, separate from the music player `<audio>` element (`#audio-player`).

#### Scenario: TTS audio plays through dedicated element
- **WHEN** binary audio chunks arrive via WebSocket
- **THEN** the frontend SHALL concatenate them into an MP3 blob and play through `#tts-player`, not `#audio-player`

#### Scenario: Music audio plays through music element
- **WHEN** a music event is processed
- **THEN** the frontend SHALL set the source on `#audio-player` and play through it, not `#tts-player`

#### Scenario: Audio context uses music element
- **WHEN** the Web Audio API spectrum visualizer is initialized
- **THEN** it SHALL connect to `#audio-player` (music), not `#tts-player` (TTS)

### Requirement: TTS playback ducking
During TTS voice playback, the music volume SHALL be temporarily reduced (ducked) rather than fully paused, and restored when TTS ends.

#### Scenario: Music ducks during TTS
- **WHEN** `tts_start` WebSocket message is received and music is playing
- **THEN** `#audio-player` volume SHALL be set to 30% of the user-configured volume level

#### Scenario: Music volume restored after TTS
- **WHEN** `tts_end` or `tts_error` WebSocket message is received
- **THEN** `#audio-player` volume SHALL be restored to the user-configured volume level

### Requirement: Deferred music playback during TTS
When a `music` SSE event arrives while TTS is active, the frontend SHALL defer playback until TTS completes.

#### Scenario: Music event deferred
- **WHEN** a `music` SSE event is received and `isTtsActive` is true
- **THEN** the music data SHALL be stored in `pendingMusicData` for later processing

#### Scenario: Deferred music played after TTS
- **WHEN** `tts_end` is received and `pendingMusicData` is not null
- **THEN** `processMusicAction(pendingMusicData)` SHALL be called and `pendingMusicData` SHALL be cleared
