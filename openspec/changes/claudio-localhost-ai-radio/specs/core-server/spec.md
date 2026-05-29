## ADDED Requirements

### Requirement: Server starts and listens on configured port
The server SHALL start an HTTP server on the port specified in configuration (default 8080) and serve the PWA frontend static files.

#### Scenario: Server starts successfully
- **WHEN** the application is launched with valid configuration
- **THEN** the server SHALL bind to the configured port and log a startup message

#### Scenario: Port already in use
- **WHEN** the configured port is already bound by another process
- **THEN** the server SHALL log an error and exit with code 1

### Requirement: Server serves PWA static files
The server SHALL serve the PWA frontend (HTML, CSS, JS, service worker) from the configured static directory at the root path `/`.

#### Scenario: Root path request
- **WHEN** a GET request is made to `/`
- **THEN** the server SHALL respond with the PWA index.html file with correct Content-Type

#### Scenario: Service worker request
- **WHEN** a GET request is made to `/sw.js`
- **THEN** the server SHALL respond with the service worker JavaScript file with Content-Type `application/javascript`

### Requirement: API routes are registered
The server SHALL register all REST API routes under the `/api/` prefix and a WebSocket endpoint at `/stream`.

#### Scenario: API route availability
- **WHEN** the server starts
- **THEN** all 6 REST endpoints SHALL be accessible under `/api/` and the WebSocket upgrade SHALL be accepted at `/stream`

### Requirement: Graceful shutdown
The server SHALL close all connections and release resources when receiving SIGTERM or SIGINT.

#### Scenario: Shutdown on signal
- **WHEN** the server process receives SIGTERM or SIGINT
- **THEN** the server SHALL stop accepting new connections, close existing WebSocket connections, close the database, and exit gracefully
