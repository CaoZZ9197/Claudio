## ADDED Requirements

### Requirement: Search songs
The system SHALL search the NetEase Cloud Music catalog by keyword and return matching songs.

#### Scenario: Search by song name
- **WHEN** the music service receives a search query "晴天"
- **THEN** it SHALL call the NetEase search API and return a list of matching tracks with title, artist, album, and track ID

#### Scenario: Search by artist
- **WHEN** the music service receives a search query "周杰伦"
- **THEN** it SHALL return tracks by the matching artist

#### Scenario: No results
- **WHEN** the search query matches no songs
- **THEN** the music service SHALL return an empty list with a "no results" status

### Requirement: Get playlist details
The system SHALL fetch playlist metadata and track list for a given NetEase playlist ID.

#### Scenario: Fetch playlist
- **WHEN** a valid NetEase playlist ID is provided
- **THEN** the music service SHALL return the playlist name, description, cover image, and full track list

#### Scenario: Invalid playlist ID
- **WHEN** an invalid or non-existent playlist ID is provided
- **THEN** the music service SHALL return an error with "playlist not found"

### Requirement: Fetch lyrics
The system SHALL fetch lyrics for a given NetEase track ID.

#### Scenario: Lyrics available
- **WHEN** a valid track ID is provided and lyrics exist
- **THEN** the music service SHALL return the lyrics text (with optional timestamp annotations)

#### Scenario: No lyrics
- **WHEN** a valid track ID is provided but no lyrics exist
- **THEN** the music service SHALL return an empty lyrics response with status "no lyrics"

### Requirement: Get song audio URL
The system SHALL return a playable audio URL for a given NetEase track ID.

#### Scenario: Audio URL obtained
- **WHEN** a valid track ID is provided and the song is playable
- **THEN** the music service SHALL return a direct audio stream URL

#### Scenario: Song not playable
- **WHEN** the track is not playable (copyright restriction, region lock)
- **THEN** the music service SHALL return an error indicating the track is unavailable
