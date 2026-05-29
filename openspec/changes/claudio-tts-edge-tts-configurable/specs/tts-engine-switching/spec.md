## ADDED Requirements

### Requirement: TTS provider configuration
The system SHALL accept a `TTS_PROVIDER` environment variable to select the TTS engine. Valid values are `minimax` and `edge-tts`. If not set, the default SHALL be `minimax`.

#### Scenario: Default provider
- **WHEN** `TTS_PROVIDER` is not set
- **THEN** the system SHALL use MiniMax TTS as the engine

#### Scenario: Explicit provider selection
- **WHEN** `TTS_PROVIDER` is set to `edge-tts`
- **THEN** the system SHALL use Edge-TTS as the engine

#### Scenario: Invalid provider value
- **WHEN** `TTS_PROVIDER` is set to an unrecognized value
- **THEN** the system SHALL log a warning and fall back to `minimax`

### Requirement: Edge-TTS engine voice configuration
The system SHALL accept `EDGE_TTS_VOICE` environment variable to configure the Edge-TTS voice name. The default SHALL be `zh-CN-XiaoxiaoNeural`.

#### Scenario: Default voice
- **WHEN** `EDGE_TTS_VOICE` is not set
- **THEN** the system SHALL use `zh-CN-XiaoxiaoNeural` as the Edge-TTS voice

#### Scenario: Custom voice
- **WHEN** `EDGE_TTS_VOICE` is set to `zh-CN-YunxiNeural`
- **THEN** the system SHALL use that voice for Edge-TTS synthesis

### Requirement: Edge-TTS engine speech rate and pitch configuration
The system SHALL accept `EDGE_TTS_RATE` and `EDGE_TTS_PITCH` environment variables to configure speech speed and pitch for Edge-TTS. Defaults SHALL be `+0%` for rate and `+0Hz` for pitch.

#### Scenario: Default rate and pitch
- **WHEN** `EDGE_TTS_RATE` and `EDGE_TTS_PITCH` are not set
- **THEN** the system SHALL use `+0%` rate and `+0Hz` pitch

#### Scenario: Custom rate
- **WHEN** `EDGE_TTS_RATE` is set to `+10%`
- **THEN** the system SHALL synthesize speech at 10% faster than normal speed

### Requirement: Unified TTS adapter interface
The system SHALL provide a TTS adapter that exposes a unified `synthesize(text, onAudioChunk)` method, dispatching to the configured engine internally.

#### Scenario: Adapter dispatches to MiniMax
- **WHEN** `TTS_PROVIDER` is `minimax` and `synthesize(text, cb)` is called
- **THEN** the adapter SHALL delegate to the MiniMax engine and invoke `cb` with MP3 audio Buffer chunks

#### Scenario: Adapter dispatches to Edge-TTS
- **WHEN** `TTS_PROVIDER` is `edge-tts` and `synthesize(text, cb)` is called
- **THEN** the adapter SHALL delegate to the Edge-TTS engine and invoke `cb` with MP3 audio Buffer chunks

#### Scenario: Adapter serialization lock
- **WHEN** two concurrent `synthesize()` calls are made to the adapter
- **THEN** the adapter SHALL queue the second call until the first completes (same behavior as current MiniMax singleton)

### Requirement: Edge-TTS synthesis produces MP3 audio
The Edge-TTS engine SHALL convert input text to MP3 audio and deliver it via an `onAudioChunk` callback, matching the same interface as MiniMax TTS.

#### Scenario: Successful Edge-TTS synthesis
- **WHEN** valid text is provided to the Edge-TTS engine
- **THEN** the engine SHALL call the Microsoft Edge TTS service via HTTP, receive MP3 audio data, and invoke `onAudioChunk` with the audio Buffer

#### Scenario: Edge-TTS network error
- **WHEN** the Edge-TTS service is unreachable
- **THEN** the engine SHALL throw an error with a descriptive message

#### Scenario: Edge-TTS empty text
- **WHEN** empty or whitespace-only text is provided
- **THEN** the engine SHALL throw an error indicating text cannot be empty

### Requirement: TTS engine initialization on server start
The system SHALL initialize the configured TTS engine during server startup via a unified `initTTS()` call, replacing the hardcoded `initMiniMaxTTS()`.

#### Scenario: MiniMax initialization
- **WHEN** `TTS_PROVIDER` is `minimax` and the server starts
- **THEN** the system SHALL initialize the MiniMax TTS engine

#### Scenario: Edge-TTS initialization
- **WHEN** `TTS_PROVIDER` is `edge-tts` and the server starts
- **THEN** the system SHALL initialize the Edge-TTS engine (a no-op for HTTP-based engines)

#### Scenario: Initialization failure does not block server
- **WHEN** TTS engine initialization fails (e.g., network error)
- **THEN** the server SHALL still start and log a warning, with TTS unavailable until reconnection or restart
