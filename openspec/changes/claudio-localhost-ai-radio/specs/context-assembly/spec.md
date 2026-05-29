## ADDED Requirements

### Requirement: Load user taste profiles
The system SHALL load user taste profile files (taste.md, mood-rules.md, playlists.json) from the configured data directory at assembly time.

#### Scenario: All taste files present
- **WHEN** taste.md, mood-rules.md, and playlists.json all exist in the data directory
- **THEN** the context assembler SHALL read all three files and include their content in the system prompt

#### Scenario: Taste file missing
- **WHEN** one or more taste files are missing
- **THEN** the context assembler SHALL log a warning and proceed with available files, including a note in the prompt that taste data is incomplete

### Requirement: Fetch environment data
The system SHALL fetch current weather and today's calendar events for injection into the context window.

#### Scenario: Weather and calendar available
- **WHEN** weather API and calendar API respond successfully
- **THEN** the context assembler SHALL format the weather data (temperature, condition) and calendar events (time, title) into the prompt

#### Scenario: External API failure
- **WHEN** weather or calendar API is unreachable
- **THEN** the context assembler SHALL include a "data unavailable" note and proceed with partial context

### Requirement: Load conversation history
The system SHALL load the last N messages from the chat history store for context continuity.

#### Scenario: History exists
- **WHEN** there are prior chat messages in the database
- **THEN** the context assembler SHALL include the last 20 messages (or configured limit) in chronological order

#### Scenario: No history
- **WHEN** this is the first user interaction
- **THEN** the context assembler SHALL include an empty history section and note "new user session"

### Requirement: Assemble system prompt
The system SHALL combine all context components into a single system prompt string that includes the DJ persona instruction, user tastes, environment, and history.

#### Scenario: Full context assembly
- **WHEN** all context data is collected
- **THEN** the assembler SHALL produce a prompt string with sections for: DJ persona, user tastes, current environment, conversation history, and user input
