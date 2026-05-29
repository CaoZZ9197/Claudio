## MODIFIED Requirements

### Requirement: Stream audio chunks
The server SHALL stream TTS audio data to connected WebSocket clients as binary chunks decoded in real-time from the MiniMax HTTP streaming response.

#### Scenario: Audio streaming
- **WHEN** TTS synthesis is in progress and the MiniMax API returns a hex-encoded audio chunk
- **THEN** the server SHALL decode the chunk with `Buffer.from(hex, "hex")` and send it as a binary WebSocket message to all connected clients

#### Scenario: Streaming completion
- **WHEN** the MiniMax API returns a chunk with `status === 2` (final chunk)
- **THEN** the server SHALL send a `tts_end` JSON control message to signal playback completion

### Requirement: Stream state communication
The server SHALL send state messages (playing, paused, stopped) to clients over the WebSocket connection.

#### Scenario: State change notification
- **WHEN** the audio playback state changes (play → pause, etc.)
- **THEN** the server SHALL broadcast a JSON state message to all connected clients

### Requirement: Handle multiple concurrent clients
The server SHALL support multiple concurrent WebSocket connections for audio streaming.

#### Scenario: Multiple clients receive same stream
- **WHEN** two clients are connected to `/stream`
- **THEN** both SHALL receive the same audio chunks when TTS playback is active

## ADDED Requirements

### Requirement: TTS audio independent from music player
The TTS audio playback SHALL use a dedicated audio channel that is separate from the music player audio element. The music player UI (now-playing display, progress bar, lyrics, queue) SHALL NOT be affected by TTS playback.

#### Scenario: TTS plays while music player shows current track
- **WHEN** TTS voice playback is active on the dedicated TTS audio element
- **THEN** the music player SHALL continue displaying the current song's title, artist, artwork, and queue; the progress bar SHALL reflect the music track's position, not TTS playback

#### Scenario: Music volume ducked during TTS
- **WHEN** TTS playback begins and music is currently playing
- **THEN** the music player volume SHALL be reduced to 30% of user-set volume; when TTS ends, music volume SHALL be restored to the original level

#### Scenario: Music event during TTS is deferred
- **WHEN** the frontend receives a `music` SSE event while TTS is active
- **THEN** the frontend SHALL store the music data as `pendingMusicData` and process it only after receiving `tts_end`
