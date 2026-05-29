## MODIFIED Requirements

### Requirement: Convert text to speech
The TTS pipeline SHALL convert text input to MP3 audio using the MiniMax Speech-2.8-Turbo HTTP streaming API.

#### Scenario: Successful TTS conversion
- **WHEN** valid text and a valid MiniMax API key are provided
- **THEN** the pipeline SHALL call MiniMax T2A API with `stream: true`, decode hex-encoded audio chunks from the SSE-like response, and invoke the `onAudioChunk` callback for each chunk

#### Scenario: MiniMax API error
- **WHEN** the MiniMax API returns an error status code or is unreachable
- **THEN** the pipeline SHALL throw an error and log the failure reason

### Requirement: Strict TTS synthesis scope
The system SHALL synthesize TTS audio ONLY for text that will be streamed to the frontend for actual playback. Specifically, only the `say` or `text` field from Claude's response intended for user-facing voice output.

#### Scenario: TTS synthesized for streaming reply
- **WHEN** `routeMessageStream` has a `sayText` from Claude's response
- **THEN** the system SHALL call `streamTtsSay(sayText)` to synthesize and broadcast audio via WebSocket

#### Scenario: No TTS synthesized for non-streaming path
- **WHEN** `executeAction` or `executeDjResponse` processes a `say`, `announce_weather`, `announce_schedule`, or `mood_check` action
- **THEN** the system SHALL NOT call MiniMax TTS synthesis; it SHALL return the text content in the JSON response only

#### Scenario: Scheduler TTS preserved
- **WHEN** the task scheduler triggers morning broadcast or mood check
- **THEN** the system SHALL continue to synthesize and broadcast TTS audio via WebSocket for actual voice announcements

### Requirement: Cache TTS results by content hash
The system SHALL cache TTS output files keyed by a content hash of the input text to avoid re-synthesizing identical phrases.

#### Scenario: Cache hit
- **WHEN** TTS is requested for text whose hash matches an existing cached MP3 file
- **THEN** the pipeline SHALL return the cached file path immediately without calling the TTS API

#### Scenario: Cache miss
- **WHEN** TTS is requested for text whose hash does not match any cached file
- **THEN** the pipeline SHALL call the TTS API, save the result to cache, and return the new file path

### Requirement: Return audio file URL
The pipeline SHALL return a URL path that can be used by the frontend to stream or download the audio.

#### Scenario: Audio URL generated
- **WHEN** TTS synthesis completes (from cache or fresh)
- **THEN** the pipeline SHALL return a relative URL like `/audio/tts/<hash>.mp3`

### Requirement: Serve cached audio files
The server SHALL serve cached TTS files under the `/audio/tts/` path.

#### Scenario: Audio file served
- **WHEN** a GET request is made to `/audio/tts/<hash>.mp3` for an existing file
- **THEN** the server SHALL respond with the MP3 file and Content-Type `audio/mpeg`

#### Scenario: Audio file not found
- **WHEN** a GET request is made for a non-existent audio file
- **THEN** the server SHALL respond with 404

## REMOVED Requirements

### Requirement: Fish Audio API as TTS backend
**Reason**: MiniMax Speech-2.8-Turbo HTTP streaming API replaces Fish Audio as the TTS backend. Fish Audio code (`src/tts.js`) was never called in the current implementation.
**Migration**: No migration needed. MiniMax TTS (`src/minimax-tts.js`) is the only active TTS implementation.
