## ADDED Requirements

### Requirement: Fetch current weather
The system SHALL fetch current weather conditions from OpenWeather API for a configured location.

#### Scenario: Weather fetch success
- **WHEN** the weather client is called with a valid API key and location
- **THEN** it SHALL return temperature, weather condition description, humidity, and city name

#### Scenario: API key missing
- **WHEN** the OpenWeather API key is not configured
- **THEN** the weather client SHALL return an error indicating missing configuration

### Requirement: Fetch weather forecast
The system SHALL fetch a multi-day weather forecast from OpenWeather API.

#### Scenario: Forecast fetch success
- **WHEN** a forecast request is made with valid configuration
- **THEN** it SHALL return a list of daily forecasts with high/low temperature and condition for the next 3 days

### Requirement: Fetch calendar events
The system SHALL fetch today's calendar events from Feishu (Lark) API.

#### Scenario: Calendar fetch success
- **WHEN** the calendar client is called with valid Feishu credentials
- **THEN** it SHALL return a list of today's events with title, start time, end time, and location

#### Scenario: No events today
- **WHEN** the calendar client is called and there are no events for today
- **THEN** it SHALL return an empty event list

### Requirement: Discover UPnP devices
The system SHALL discover UPnP MediaRenderer devices on the local network.

#### Scenario: Device discovered
- **WHEN** UPnP discovery is triggered
- **THEN** the UPnP client SHALL return a list of available MediaRenderer devices with friendly name, IP address, and port

#### Scenario: No devices found
- **WHEN** no UPnP MediaRenderer devices are on the network
- **THEN** the UPnP client SHALL return an empty device list

### Requirement: Cast to UPnP device
The system SHALL be able to send an audio URL to a selected UPnP MediaRenderer for playback.

#### Scenario: Cast audio URL
- **WHEN** a valid audio URL and target UPnP device are provided
- **THEN** the UPnP client SHALL send the SetAVTransportURI action and start playback on the device

#### Scenario: Cast to unavailable device
- **WHEN** the target UPnP device is no longer reachable
- **THEN** the UPnP client SHALL return a connection error
