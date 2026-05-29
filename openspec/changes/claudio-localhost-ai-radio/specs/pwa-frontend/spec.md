## ADDED Requirements

### Requirement: Player UI
The PWA SHALL display a music player interface with play/pause, skip, volume control, and now-playing information.

#### Scenario: Now playing display
- **WHEN** a song is playing
- **THEN** the player SHALL show the song title, artist, album art (if available), playback progress, and duration

#### Scenario: Playback controls
- **WHEN** the user clicks play/pause, skip, or adjusts volume
- **THEN** the PWA SHALL send the corresponding control command to `POST /api/player/control`

### Requirement: Chat interface
The PWA SHALL provide a chat interface where the user can send text messages and receive AI responses.

#### Scenario: Send a message
- **WHEN** the user types a message and submits it
- **THEN** the PWA SHALL send it to `POST /api/chat`, display a loading indicator, and show the AI response when received

#### Scenario: Message history display
- **WHEN** the chat view is opened
- **THEN** the PWA SHALL load and display recent chat messages from `GET /api/history`

### Requirement: User profile management
The PWA SHALL provide an interface for editing taste profile files (taste.md, mood-rules.md, playlists.json).

#### Scenario: Edit taste profile
- **WHEN** the user opens the profile section
- **THEN** the PWA SHALL display the current taste.md content in an editable text area and allow saving changes

### Requirement: Settings panel
The PWA SHALL provide a settings interface for configuring API keys, preferences, and scheduler times.

#### Scenario: Update settings
- **WHEN** the user modifies a setting and saves
- **THEN** the PWA SHALL POST the updated settings and display a success confirmation

### Requirement: Service worker for offline support
The PWA SHALL register a service worker that caches the app shell (HTML, CSS, JS, icons) for offline launch.

#### Scenario: Offline launch
- **WHEN** the user opens the PWA without network connectivity to the server
- **THEN** the service worker SHALL serve the cached app shell, displaying a "server unavailable" message

### Requirement: Installable PWA
The PWA SHALL include a web manifest with name, icons, and display mode so the browser can offer "Add to Home Screen".

#### Scenario: Add to home screen
- **WHEN** the user visits the PWA in a supporting browser
- **THEN** the browser SHALL offer the "Add to Home Screen" prompt based on the manifest
