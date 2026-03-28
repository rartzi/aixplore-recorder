import Cocoa

// Monitors global mouse clicks (all apps except AIXplore itself) without
// requiring Accessibility permission. Outputs one JSON line per click:
// {"x":123,"y":456}
// Coordinates are in CGPoint space (top-left origin, logical pixels).

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)  // background-only, no dock icon

NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { event in
    guard let cgEvent = event.cgEvent else { return }
    let loc = cgEvent.location
    let line = "{\"x\":\(Int(loc.x)),\"y\":\(Int(loc.y))}\n"
    guard let data = line.data(using: .utf8) else { return }
    FileHandle.standardOutput.write(data)
}

app.run()
