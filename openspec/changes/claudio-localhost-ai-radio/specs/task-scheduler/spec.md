## ADDED Requirements

### Requirement: Register cron-based tasks
The scheduler SHALL support registration of tasks with cron expressions and handler functions.

#### Scenario: Register a daily task
- **WHEN** a task is registered with cron `0 7 * * *` (7:00 AM daily) and a handler function
- **THEN** the scheduler SHALL execute the handler function at 7:00 AM each day

#### Scenario: Register multiple tasks
- **WHEN** multiple tasks with different cron expressions are registered
- **THEN** the scheduler SHALL execute each independently on its own schedule

### Requirement: Morning planning task
The system SHALL run a morning planning task that assembles the day's context (weather, calendar, mood) and pre-computes recommendations.

#### Scenario: Morning planning execution
- **WHEN** the morning planning task fires at the configured time (default 7:00 AM)
- **THEN** the scheduler SHALL trigger context assembly for the day ahead and cache the planning result

### Requirement: Morning broadcast task
The system SHALL run a morning broadcast task that generates a TTS audio greeting with weather and schedule summary.

#### Scenario: Morning broadcast execution
- **WHEN** the morning broadcast task fires at the configured time (default 9:00 AM)
- **THEN** the scheduler SHALL call Claude for a morning greeting, synthesize it via TTS, and make it available for playback

### Requirement: Mood check task
The system SHALL run periodic mood check tasks that prompt the user for mood updates and adjust music recommendations accordingly.

#### Scenario: Mood check execution
- **WHEN** the mood check task fires (configurable interval, default every 3 hours)
- **THEN** the scheduler SHALL generate a mood inquiry, send it via TTS, and update the mood context based on user response

### Requirement: Task error handling
The scheduler SHALL handle task execution errors without crashing other tasks or the main server.

#### Scenario: Task handler throws error
- **WHEN** a scheduled task handler throws an uncaught error
- **THEN** the scheduler SHALL log the error, skip that execution, and continue running subsequent scheduled ticks
