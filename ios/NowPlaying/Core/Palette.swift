import CoreGraphics
import Foundation

/*
 PULLING COLOURS OUT OF AN IMAGE
 -------------------------------
 Median cut: put every pixel in one box, keep splitting the biggest box along
 whichever of red, green or blue is most spread out, then average each box.
 The image is shrunk to about 64px first, so it runs in a millisecond or two.
*/

struct RGB: Hashable {
    var r: Int, g: Int, b: Int

    init(_ r: Int, _ g: Int, _ b: Int) { self.r = r; self.g = g; self.b = b }

    init(hex: String) {
        let s = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        let v = Int(s.prefix(6), radix: 16) ?? 0
        self.init((v >> 16) & 255, (v >> 8) & 255, v & 255)
    }

    var hex: String {
        String(format: "#%02x%02x%02x", clamp(r), clamp(g), clamp(b))
    }

    private func clamp(_ v: Int) -> Int { Swift.max(0, Swift.min(255, v)) }

    func mixed(with other: RGB, _ amount: Double) -> RGB {
        func m(_ a: Int, _ b: Int) -> Int { Int((Double(a) + Double(b - a) * amount).rounded()) }
        return RGB(m(r, other.r), m(g, other.g), m(b, other.b))
    }

    /// How light it looks, 0...1 (WCAG relative luminance).
    var luminance: Double {
        func channel(_ v: Int) -> Double {
            let s = Double(v) / 255
            return s <= 0.03928 ? s / 12.92 : pow((s + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
    }

    /// How colourful, 0...1. Grey is 0.
    var saturation: Double {
        let hi = Swift.max(r, g, b), lo = Swift.min(r, g, b)
        return hi == 0 ? 0 : Double(hi - lo) / Double(hi)
    }

    static let white = RGB(255, 255, 255)
    static let black = RGB(0, 0, 0)
}

let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!

func cgColor(_ hex: String, _ alpha: Double = 1) -> CGColor {
    let c = RGB(hex: hex)
    return CGColor(colorSpace: sRGB, components: [CGFloat(c.r) / 255, CGFloat(c.g) / 255, CGFloat(c.b) / 255, CGFloat(alpha)])!
}

func cgColor(_ r: Double, _ g: Double, _ b: Double, _ a: Double) -> CGColor {
    CGColor(colorSpace: sRGB, components: [CGFloat(r) / 255, CGFloat(g) / 255, CGFloat(b) / 255, CGFloat(a)])!
}

// MARK: - Median cut

private func samplePixels(_ image: CGImage) -> [RGB] {
    let scale = 64 / Double(max(image.width, image.height))
    let w = max(1, Int((Double(image.width) * scale).rounded()))
    let h = max(1, Int((Double(image.height) * scale).rounded()))
    var data = [UInt8](repeating: 0, count: w * h * 4)
    let info = CGImageAlphaInfo.premultipliedLast.rawValue
    guard let ctx = CGContext(data: &data, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                              space: sRGB, bitmapInfo: info) else { return [] }
    ctx.interpolationQuality = .medium
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
    var out: [RGB] = []
    out.reserveCapacity(w * h)
    for i in stride(from: 0, to: data.count, by: 4) where data[i + 3] >= 128 {
        out.append(RGB(Int(data[i]), Int(data[i + 1]), Int(data[i + 2])))
    }
    return out
}

private func channel(_ p: RGB, _ c: Int) -> Int { c == 0 ? p.r : c == 1 ? p.g : p.b }

private func splitOnce(_ box: [RGB]) -> [[RGB]] {
    var widest = 0
    var spread = -1
    for c in 0..<3 {
        var lo = 255, hi = 0
        for p in box { lo = min(lo, channel(p, c)); hi = max(hi, channel(p, c)) }
        if hi - lo > spread { spread = hi - lo; widest = c }
    }
    let sorted = box.sorted { channel($0, widest) < channel($1, widest) }
    let middle = sorted.count >> 1
    return [Array(sorted[..<middle]), Array(sorted[middle...])]
}

private func average(_ box: [RGB]) -> RGB {
    var r = 0, g = 0, b = 0
    for p in box { r += p.r; g += p.g; b += p.b }
    let n = Double(max(1, box.count))
    return RGB(Int((Double(r) / n).rounded()), Int((Double(g) / n).rounded()), Int((Double(b) / n).rounded()))
}

/// A handful of hex colours, most common first, near-identical shades merged.
func extractPalette(_ image: CGImage, count: Int = 5) -> [String] {
    let pixels = samplePixels(image)
    if pixels.isEmpty { return [] }
    var boxes = [pixels]
    while boxes.count < count * 2 {
        // Always split the biggest box; that keeps the result balanced.
        boxes.sort { $0.count > $1.count }
        let biggest = boxes.removeFirst()
        if biggest.count < 2 { boxes.append(biggest); break }
        boxes.append(contentsOf: splitOnce(biggest))
    }
    let candidates = boxes.filter { !$0.isEmpty }.sorted { $0.count > $1.count }.map(average)
    var kept: [RGB] = []
    for colour in candidates {
        let tooClose = kept.contains {
            abs($0.r - colour.r) + abs($0.g - colour.g) + abs($0.b - colour.b) < 48
        }
        if !tooClose { kept.append(colour) }
        if kept.count >= count { break }
    }
    return kept.map(\.hex)
}

/// Drop colours that are near-copies of one already in the list.
func dedupeHex(_ list: [String], minDistance: Int = 26) -> [String] {
    var kept: [String] = []
    for hex in list where !hex.isEmpty {
        let c = RGB(hex: hex)
        let tooClose = kept.contains {
            let o = RGB(hex: $0)
            return abs(o.r - c.r) + abs(o.g - c.g) + abs(o.b - c.b) < minDistance
        }
        if !tooClose { kept.append(hex) }
    }
    return kept
}

/// A colour dark enough to sit behind a photo without fighting it.
func asRoomColour(_ hex: String, target: Double = 0.09) -> String {
    let c = RGB(hex: hex)
    let current = c.luminance
    let k = current <= target ? 1 : sqrt(target / current)
    let dim = { (v: Int) in Int((Double(v) * k).rounded()) }
    // Never pure black: a colour darker than the room reads as a hole.
    return RGB(max(dim(c.r), 20), max(dim(c.g), 19), max(dim(c.b), 18)).hex
}

// MARK: - Tones for the furniture

/**
 The colours the player furniture is drawn in, taken from the cover, so the
 bar, the buttons and the words look like they belong to the record.
   accent   the cover's most vivid colour, lifted until it shows on dark
   ink      near-white with a breath of that colour: titles, buttons
   soft     the same, quieter: the times
   deep     the colour pulled most of the way to black: under the glass
 */
struct Tones: Hashable {
    var accent: String
    var ink: String
    var soft: String
    var deep: String
}

func coverTones(_ palette: [String]) -> Tones {
    let colours = palette.prefix(5).map { RGB(hex: $0) }
    var base = RGB(150, 150, 150)
    var best = -1.0
    for (i, c) in colours.enumerated() {
        // A tiny fleck of red should not beat a cover that is mostly blue.
        let score = c.saturation * (1 - Double(i) * 0.08)
        if score > best { best = score; base = c }
    }
    var accent = base
    var step = 0
    while accent.luminance < 0.2 && step < 12 { accent = accent.mixed(with: .white, 0.1); step += 1 }
    return Tones(
        accent: accent.hex,
        ink: base.mixed(with: .white, 0.9).hex,
        soft: base.mixed(with: .white, 0.68).hex,
        deep: base.mixed(with: .black, 0.74).hex
    )
}

/// The same tones turned round for a bright backdrop: dark words in the
/// cover's own hue, and an accent pulled down until it holds against white.
func coverTonesDark(_ palette: [String]) -> Tones {
    let light = coverTones(palette)
    var accent = RGB(hex: light.accent)
    var step = 0
    while accent.luminance > 0.18 && step < 14 { accent = accent.mixed(with: .black, 0.12); step += 1 }
    let base = RGB(hex: light.deep)
    return Tones(
        accent: accent.hex,
        ink: base.mixed(with: .black, 0.55).hex,
        soft: base.mixed(with: .black, 0.25).hex,
        deep: light.ink
    )
}

/// WCAG contrast, 1 (none) to 21 (black on white).
func contrast(_ a: RGB, _ b: RGB) -> Double {
    let la = a.luminance, lb = b.luminance
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
}

/// The colour moved toward white or black, whichever the backdrop allows more
/// of, just far enough to stand out against it by `ratio`.
func legibleOn(_ hex: String, _ behind: RGB, _ ratio: Double) -> String {
    var c = RGB(hex: hex)
    if contrast(c, behind) >= ratio { return hex }
    let toward = contrast(.white, behind) >= contrast(.black, behind) ? RGB.white : RGB.black
    var step = 0
    while contrast(c, behind) < ratio && step < 20 { c = c.mixed(with: toward, 0.12); step += 1 }
    return c.hex
}
