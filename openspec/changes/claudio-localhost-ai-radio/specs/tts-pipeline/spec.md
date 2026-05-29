## ADDED Requirements

### Requirement: Convert text to speech
The TTS pipeline SHALL convert text input to MP3 audio using the Fish Audio API.

#### Scenario: Successful TTS conversion
- **WHEN** valid text and a valid Fish Audio API key are provided
- **THEN** the pipeline SHALL call Fish Audio, receive audio data, and write an MP3 file to the cache directory

#### Scenario: Fish Audio API error
- **WHEN** the Fish Audio API returns an error or is unreachable
- **THEN** the pipeline SHALL return an error and log the failure reason

### Requirement: Cache TTS results by content hash
The system SHALL cache TTS output files keyed by a content hash of the input text to avoid re-synthesizing identical phrases.

#### Scenario: Cache hit
- **WHEN** TTS is requested for text whose hash matches an existing cached MP3 file
- **THEN** the pipeline SHALL return the cached file path immediately without calling Fish Audio

#### Scenario: Cache miss
- **WHEN** TTS is requested for text whose hash does not match any cached file
- **THEN** the pipeline SHALL call Fish Audio, save the result to cache, and return the new file path

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
