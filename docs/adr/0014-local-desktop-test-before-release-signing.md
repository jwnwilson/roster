# ADR 0014: Validate local keyboard control before release signing

Status: Accepted for a local prototype. Supersedes ADR 0013's prohibition on permission requests for this explicitly requested experiment; ROS-19 remains the production signing prerequisite.

## Context

The user chose the quickest local experiment, including manually granting macOS permissions. Stable Developer ID signing is needed for durable permission identity across updates, but is not a prerequisite for testing an ad-hoc build in a logged-in desktop session.

## Decision

Reuse the native desktop helper. Add an explicit Accessibility request and one fixed control test: Roster creates a uniquely titled disposable window, the helper posts a generated test phrase as native keyboard events to its parent Roster process, and Roster reads the field back and captures only that window. Never write the expected phrase into the field with JavaScript. Only exact readback counts as success.

The helper requires the supplied PID to equal its parent PID, validates the UUID, checks Accessibility/input-posting permission, and verifies the foreground application and unique focused-window title before each character. Events target that PID rather than the global desktop. Closing or defocusing the window stops subsequent input. No arbitrary target, text, shell command, file edits or clipboard access are accepted.

Both the Desktop button and the fixed `test_local_desktop` MCP tool use one application-wide test coordinator. Concurrent tests are rejected; windows close on failure or completion. Agent requests require a native confirmation identifying the requesting agent before each test. Plan-mode sessions cannot execute the test. Permission requests are UI-only, asynchronous acknowledgments rather than claims of permission granted.

The evidence screenshot uses Electron's own test-window capture, so Screen Recording permission is unnecessary for this experiment. It does not demonstrate whole-desktop capture, arbitrary-app control, mouse control, or remote-network access. The test is a cross-process native input proof, not a complete remote desktop feature.

## Consequences

A locally packaged ad-hoc build is sufficient for validation. Users must explicitly approve Accessibility in System Settings, restart the same build and run the test in their logged-in desktop session. Rebuilds/updates may require granting access again. Stable signing, wider app control, per-agent grants and authenticated access to another laptop remain separate work.

Tests exercise fixed helper arguments, busy/focus/failure handling, verified readback, UI permission acknowledgments and MCP evidence/error responses. Native compilation and packaged-app checks supplement the suite; successful actual keyboard delivery still requires a live desktop with permission granted.
