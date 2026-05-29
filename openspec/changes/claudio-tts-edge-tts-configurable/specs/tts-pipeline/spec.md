## MODIFIED Requirements

### Requirement: Convert text to speech
The TTS pipeline SHALL convert text input to MP3 audio using the configured TTS provider (MiniMax or Edge-TTS), as determined by the `TTS_PROVIDER` environment variable.

#### Scenario: Successful TTS conversion with MiniMax
- **WHEN** valid text is provided and `TTS_PROVIDER` is `minimax` (default)
- **THEN** the pipeline SHALL call MiniMax API, receive audio data, and deliver it as MP3 audio chunks

#### Scenario: Successful TTS conversion with Edge-TTS
- **WHEN** valid text is provided and `TTS_PROVIDER` is `edge-tts`
- **THEN** the pipeline SHALL call Microsoft Edge TTS service, receive audio data, and deliver it as MP3 audio chunks

#### Scenario: TTS API error
- **WHEN** the configured TTS provider returns an error or is unreachable
- **THEN** the pipeline SHALL return an error and log the failure reason
