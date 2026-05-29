## ADDED Requirements

### Requirement: Establish WebSocket connection
The server SHALL accept WebSocket connections at the `/stream` endpoint for real-time audio streaming.

#### Scenario: Client connects
- **WHEN** a client initiates a WebSocket handshake to `/stream`
- **THEN** the server SHALL upgrade the connection and track the client session

#### Scenario: Client disconnects
- **WHEN** a connected WebSocket client disconnects
- **THEN** the server SHALL clean up the session and stop any active audio streaming for that client

### Requirement: Stream audio chunks
The server SHALL stream TTS audio data to connected WebSocket clients in chunks.

#### Scenario: Audio streaming
- **WHEN** a TTS audio file is ready for playback
- **THEN** the server SHALL read the MP3 file in chunks and send each chunk as a binary WebSocket message to all connected clients

#### Scenario: Streaming completion
- **WHEN** all chunks of an audio file have been sent
- **THEN** the server SHALL send an "end" control message to signal playback completion

### Requirement: Handle multiple concurrent clients
The server SHALL support multiple concurrent WebSocket connections for audio streaming.

#### Scenario: Multiple clients receive same stream
- **WHEN** two clients are connected to `/stream`
- **THEN** both SHALL receive the same audio chunks when TTS playback is active

### Requirement: Stream state communication
The server SHALL send state messages (playing, paused, stopped) to clients over the WebSocket connection.

#### Scenario: State change notification
- **WHEN** the audio playback state changes (play → pause, etc.)
- **THEN** the server SHALL broadcast a JSON state message to all connected clients
