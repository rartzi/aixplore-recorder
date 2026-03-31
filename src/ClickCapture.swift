import Cocoa
import CoreGraphics

// ── Mode A: window-bounds query ──────────────────────────────────────────────
// Called once at recording start: ./click-capture --window-id <ID>
// Outputs: {"type":"window_bounds","x":N,"y":N,"w":N,"h":N}
// Uses CGWindowListCopyWindowInfo — no Accessibility permission required.
// Bounds are in logical screen coordinates (same space as Electron screen APIs).

if CommandLine.arguments.count >= 3 && CommandLine.arguments[1] == "--window-id",
   let rawID = UInt32(CommandLine.arguments[2]) {
    let windowID = CGWindowID(rawID)
    let info = CGWindowListCopyWindowInfo([.optionIncludingWindow], windowID) as? [[String: Any]]
    if let bounds = (info?.first)?[kCGWindowBounds as String] as? [String: CGFloat] {
        let x = Int(bounds["X"] ?? 0), y = Int(bounds["Y"] ?? 0)
        let w = Int(bounds["Width"] ?? 0), h = Int(bounds["Height"] ?? 0)
        let line = "{\"type\":\"window_bounds\",\"x\":\(x),\"y\":\(y),\"w\":\(w),\"h\":\(h)}\n"
        FileHandle.standardOutput.write(line.data(using: .utf8)!)
    }
    exit(0)
}

// ── Mode B: global mouse event monitor ───────────────────────────────────────
// Runs for the duration of a recording session.
// Outputs one JSON line per left/right click: {"x":N,"y":N}
// NSEvent global monitor does NOT require Accessibility permission.

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)

NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { event in
    guard let cgEvent = event.cgEvent else { return }
    let loc = cgEvent.location
    let line = "{\"x\":\(Int(loc.x)),\"y\":\(Int(loc.y))}\n"
    FileHandle.standardOutput.write(line.data(using: .utf8)!)
}

app.run()
