// Prints the RapidRAW content window's geometry: "X Y W H WINDOWID" (points, space-separated).
// Uses CGWindowList because for a Tauri `decorations:false` (WKWebView) window the
// AppleScript `front window` route returns a bogus ~33px sliver. Window METADATA does NOT
// require Screen Recording permission (only pixel capture does), so this works regardless.
import CoreGraphics
import Foundation

let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
guard let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else {
    FileHandle.standardError.write("rr-bounds: could not read window list\n".data(using: .utf8)!)
    exit(1)
}

// Pick the largest layer-0 window owned by RapidRAW (filters out the thin helper strip).
var best: (num: Int, x: Int, y: Int, w: Int, h: Int, area: Int)?
for w in list {
    let owner = (w[kCGWindowOwnerName as String] as? String) ?? ""
    let layer = (w[kCGWindowLayer as String] as? Int) ?? -1
    guard owner.contains("Rapid"), layer == 0,
          let b = w[kCGWindowBounds as String] as? [String: CGFloat] else { continue }
    let x = Int(b["X"] ?? 0), y = Int(b["Y"] ?? 0)
    let wd = Int(b["Width"] ?? 0), ht = Int(b["Height"] ?? 0)
    let num = (w[kCGWindowNumber as String] as? Int) ?? -1
    let area = wd * ht
    if best == nil || area > best!.area {
        best = (num, x, y, wd, ht, area)
    }
}

guard let r = best else {
    FileHandle.standardError.write("rr-bounds: RapidRAW window not found (is the app running?)\n".data(using: .utf8)!)
    exit(2)
}
print("\(r.x) \(r.y) \(r.w) \(r.h) \(r.num)")
