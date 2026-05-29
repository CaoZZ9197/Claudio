## MODIFIED Requirements

### Requirement: Search songs
The system SHALL search the NetEase Cloud Music catalog by keyword and return matching songs, with support for excluding previously played track IDs.

#### Scenario: Search by song name
- **WHEN** the music service receives a search query "晴天"
- **THEN** it SHALL call the NetEase search API and return a list of matching tracks with title, artist, album, and track ID

#### Scenario: Search by artist
- **WHEN** the music service receives a search query "周杰伦"
- **THEN** it SHALL return tracks by the matching artist

#### Scenario: No results
- **WHEN** the search query matches no songs
- **THEN** the music service SHALL return an empty list with a "no results" status

#### Scenario: Exclude previously played songs
- **WHEN** the music service receives a search query with an `excludeIds` parameter containing previously played track IDs
- **THEN** it SHALL filter out any results whose IDs match the exclusion list

#### Scenario: Ensure minimum results for radio mode
- **WHEN** the music service is called for radio/station playback and the filtered results have fewer than 5 songs
- **THEN** it SHALL attempt a broader search or return all available results with a flag indicating insufficient results

## ADDED Requirements

### Requirement: Search with configurable result limit
The music service SHALL accept a configurable `limit` parameter to control the number of search results returned, defaulting to 30 when used for radio mode to ensure sufficient unique songs after deduplication.

#### Scenario: Radio search with higher limit
- **WHEN** the music service is called for radio queue building with `limit: 30`
- **THEN** it SHALL request up to 30 results from the NetEase API and return all valid tracks

#### Scenario: Direct search with default limit
- **WHEN** the music service is called without a limit parameter
- **THEN** it SHALL use a default limit appropriate for direct playback (e.g., 10 results)
