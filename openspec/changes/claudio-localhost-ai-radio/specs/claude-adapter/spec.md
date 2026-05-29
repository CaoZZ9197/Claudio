## ADDED Requirements

### Requirement: Call Claude API with assembled context
The claude-adapter SHALL send the assembled system prompt and user message to the Claude API and receive a structured response.

#### Scenario: Successful API call
- **WHEN** a valid system prompt and user message are provided
- **THEN** the adapter SHALL call the Anthropic API, wait for completion, and return the full response text

#### Scenario: API timeout
- **WHEN** the Claude API does not respond within the configured timeout (default 30s)
- **THEN** the adapter SHALL abort the request and return a timeout error

### Requirement: Parse JSON from Claude response
The adapter SHALL extract and validate JSON from Claude's response, parsing it into typed action objects.

#### Scenario: Valid JSON with action
- **WHEN** Claude's response contains `{ "action": "play_music", "query": "jazz" }`
- **THEN** the adapter SHALL return `{ action: "play_music", params: { query: "jazz" } }`

#### Scenario: Plain text response (no JSON)
- **WHEN** Claude's response is conversational text without a structured action
- **THEN** the adapter SHALL return `{ action: "say", params: { text: "<the message>" } }`

#### Scenario: Malformed JSON
- **WHEN** Claude's response contains invalid JSON in the action block
- **THEN** the adapter SHALL log the parsing error and return `{ action: "say", params: { text: "<raw response>" } }` as fallback

### Requirement: Support multiple Claude actions
The adapter SHALL recognize and parse the following action types: `play_music`, `say`, `announce_weather`, `announce_schedule`, `mood_check`, `control_player`.

#### Scenario: Each supported action type
- **WHEN** Claude returns any of the recognized action types with valid parameters
- **THEN** the adapter SHALL correctly parse each into its corresponding typed object

### Requirement: API key configuration
The adapter SHALL require a valid Anthropic API key provided via environment variable or config file.

#### Scenario: Missing API key
- **WHEN** the ANTHROPIC_API_KEY is not set
- **THEN** the adapter SHALL throw a configuration error on initialization
