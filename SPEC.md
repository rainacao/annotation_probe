# Annotation Probe

## Goal
A browser-based research tool for presenting an image sequence, collecting touch/stylus/mouse annotations in a separate participant window, recording the participant display, and exporting final annotated images with an event log.

## Architecture
- `index.html` is the experimenter controller for image upload, sequence navigation, condition assignment, display recording, and session export.
- `participant.html` is a separate popup window for image presentation, navigation, and annotation.
- A session-scoped `BroadcastChannel` synchronizes image blobs, strokes, settings, and navigation between same-origin pages.
- Imported image files and per-image vector annotation paths remain in memory for the session; no server upload or remote persistence.
- Pointer Events power red/blue pen strokes in two widths and erasing across mouse, touch, and stylus.
- The experimenter starts `getDisplayMedia` recording and chooses which display or window to capture. A timestamped JSON log records condition changes, tool/color/size changes, image navigation, and normalized pointer paths.
- Export a ZIP containing each final original-resolution annotated PNG, the interaction log, and the WebM recording when one was made.

## Design Decisions
- User supplies the image series at runtime; image files are not bundled with the app.
- Final image exports use the original image resolution.
- The participant window must be opened from the controller and served from the same origin; the session channel is local to that browser session.
- Display capture requires browser permission and a secure context; `localhost` is supported for local experiments.
- The no-tools condition hides all participant drawing controls while leaving image navigation available.
- Users must export before closing or refreshing the controller.
- No backend or third-party runtime dependency is required.
