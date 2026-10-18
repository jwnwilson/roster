import AppKit
import ApplicationServices
import CoreGraphics

func fail(_ message: String) -> Never {
    fputs(message + "\n", stderr)
    exit(1)
}

func focusedTestWindow(_ pid: pid_t, _ title: String) -> Bool {
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else { return false }
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 0.5)
    var window: CFTypeRef?
    guard AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute as CFString, &window) == .success,
          let value = window, CFGetTypeID(value) == AXUIElementGetTypeID() else { return false }
    var actual: CFTypeRef?
    let focused = unsafeBitCast(value, to: AXUIElement.self)
    guard AXUIElementCopyAttributeValue(focused, kAXTitleAttribute as CFString, &actual) == .success else { return false }
    return (actual as? String) == title
}

let args = Array(CommandLine.arguments.dropFirst())
if args == ["--request-accessibility"] {
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
    _ = AXIsProcessTrustedWithOptions(options)
    // Prompting is asynchronous. This acknowledgment is never reported as a grant.
    print("{}")
    exit(0)
} else if args.first == "--type-test" {
    guard args.count == 3, let pid = pid_t(args[1]), pid > 0, pid == getppid(),
          let uuid = UUID(uuidString: args[2]), uuid.uuidString.lowercased() == args[2] else {
        fail("Invalid local test target. The helper can only type into its parent Roster process.")
    }
    guard AXIsProcessTrusted(), CGPreflightPostEventAccess() else {
        fail("Accessibility access is required. Request access in Desktop, approve the app/helper in System Settings, then quit and reopen Roster.")
    }
    let title = "Roster Desktop Test " + args[2]
    for character in ("Roster test " + args[2]).utf16 {
        guard focusedTestWindow(pid, title) else {
            fail("The disposable test window is not focused. Run the test again and leave it focused.")
        }
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
              let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) else {
            fail("Could not create keyboard events.")
        }
        var unicode = character
        down.flags = []
        up.flags = []
        down.keyboardSetUnicodeString(stringLength: 1, unicodeString: &unicode)
        up.keyboardSetUnicodeString(stringLength: 1, unicodeString: &unicode)
        down.postToPid(pid)
        up.postToPid(pid)
        usleep(10_000)
    }
    print("{}")
    exit(0)
} else if !args.isEmpty {
    fail("Unknown desktop helper command.")
}
struct Report: Encodable {
    let accessibilityTrusted: Bool
    let screenCaptureAllowed: Bool
    let inputPostingAllowed: Bool
    let visibleScreens: Int
    let frontmostApp: String?
    // Keep the absent app explicit so the IPC schema can distinguish it from a broken response.
    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(accessibilityTrusted, forKey: .accessibilityTrusted)
        try values.encode(screenCaptureAllowed, forKey: .screenCaptureAllowed)
        try values.encode(inputPostingAllowed, forKey: .inputPostingAllowed)
        try values.encode(visibleScreens, forKey: .visibleScreens)
        try values.encode(frontmostApp, forKey: .frontmostApp)
    }
    enum CodingKeys: String, CodingKey {
        case accessibilityTrusted, screenCaptureAllowed, inputPostingAllowed, visibleScreens, frontmostApp
    }
}
let report = Report(accessibilityTrusted: AXIsProcessTrusted(),
    screenCaptureAllowed: CGPreflightScreenCaptureAccess(),
    inputPostingAllowed: CGPreflightPostEventAccess(),
    visibleScreens: NSScreen.screens.count,
    frontmostApp: NSWorkspace.shared.frontmostApplication?.localizedName)
do {
    let data = try JSONEncoder().encode(report)
    print(String(decoding: data, as: UTF8.self))
} catch {
    fputs("Could not encode desktop diagnostics\n", stderr)
    exit(1)
}
