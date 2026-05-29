## ADDED Requirements

### Requirement: Minimum search results for radio mode
The music service SHALL return at least 5 songs when searching for radio/station mode playback.

#### Scenario: Sufficient results available
- **WHEN** a radio search returns 10 or more results
- **THEN** the system SHALL include at least 5 songs in the playback queue

#### Scenario: Limited results
- **WHEN** a radio search returns fewer than 5 results (e.g., 3)
- **THEN** the system SHALL include all available results and mark the queue as having limited availability

### Requirement: Deduplication against played history
The radio queue SHALL NOT contain songs that have already been played in the current session.

#### Scenario: Filter duplicate on search
- **WHEN** search results include a song whose ID exists in the session's playedIds
- **THEN** that song SHALL be excluded from the queue

#### Scenario: Filter duplicate on auto-refill
- **WHEN** the queue is refilled via auto-continue and search results include previously played songs
- **THEN** those duplicates SHALL be excluded, and additional results SHALL be fetched if the filtered count falls below the minimum

### Requirement: Auto-continue when queue is exhausted
The system SHALL automatically search and queue more songs of the same type when the playback queue is nearly exhausted (fewer than 2 songs remaining).

#### Scenario: Queue running low triggers refill
- **WHEN** the playback queue has 1 song remaining
- **THEN** the system SHALL proactively search for more songs matching the current session's music type and append them to the queue

#### Scenario: Queue empty triggers immediate refill
- **WHEN** the playback queue is empty and the next song is requested
- **THEN** the system SHALL search for more songs matching the current session context before reporting an empty queue

#### Scenario: No session context available
- **WHEN** the queue is empty and no radio session context exists
- **THEN** the system SHALL use the user's default taste profile to search for songs

### Requirement: Queue management via radio session
The radio session module SHALL manage the playback queue as a first-in-first-out list with operations for enqueue, dequeue, replace, and clear.

#### Scenario: Dequeue next song
- **WHEN** the player finishes the current song
- **THEN** the radio session SHALL return the next song from the queue and move it to the played history

#### Scenario: Replace entire queue
- **WHEN** a music type switch occurs
- **THEN** the radio session SHALL replace the entire queue with the new search results and reset the played history for the new session context
