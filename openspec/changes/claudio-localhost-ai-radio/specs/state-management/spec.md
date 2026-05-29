## ADDED Requirements

### Requirement: Store and retrieve chat messages
The system SHALL persist chat messages (user and AI) with timestamps in the SQLite database.

#### Scenario: Save a chat message
- **WHEN** a user sends a message and receives an AI response
- **THEN** both the user message and AI response SHALL be saved with timestamps and roles (user/assistant)

#### Scenario: Retrieve chat history
- **WHEN** chat history is requested with a limit parameter
- **THEN** the system SHALL return messages ordered by timestamp descending, limited to the requested count

### Requirement: Store and retrieve play records
The system SHALL persist music play records (song title, artist, timestamp) in the database.

#### Scenario: Save a play record
- **WHEN** a song starts playing
- **THEN** the system SHALL insert a play record with song title, artist, album, source (NetEase ID), and timestamp

#### Scenario: Query play history
- **WHEN** play history is requested
- **THEN** the system SHALL return play records ordered by timestamp descending

### Requirement: Store user preferences
The system SHALL persist user preference key-value pairs in the database.

#### Scenario: Save a preference
- **WHEN** the user updates a setting (e.g., default volume, preferred genres)
- **THEN** the system SHALL upsert the preference key with the new value

#### Scenario: Retrieve all preferences
- **WHEN** the settings endpoint is queried
- **THEN** the system SHALL return all stored preference key-value pairs

### Requirement: Database initialization
The system SHALL create the SQLite database and all required tables on first startup if they do not exist.

#### Scenario: First startup
- **WHEN** the application starts and the database file does not exist
- **THEN** the system SHALL create the database file, create the `messages`, `plays`, and `preferences` tables with correct schemas

#### Scenario: Subsequent startups
- **WHEN** the application starts and the database file already exists
- **THEN** the system SHALL open the existing database without modifying the schema

### Requirement: Automatic database maintenance
The system SHALL periodically clean up old records to prevent unbounded growth.

#### Scenario: Old message cleanup
- **WHEN** the message count exceeds the configured maximum (default 10,000)
- **THEN** the system SHALL delete the oldest messages beyond the limit
