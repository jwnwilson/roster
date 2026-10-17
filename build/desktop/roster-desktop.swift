import AppKit
import ApplicationServices
import CoreGraphics

// Read-only until release signing provides a stable permission identity.
guard CommandLine.arguments.count == 1 else {
    fputs("Desktop diagnostics only accepts a read-only probe\n", stderr)
    exit(2)
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
