import CoreText
import Foundation

/*
 THE SLIDE'S TYPEFACES
 ---------------------
 The interface uses the system font. The slide draws its words in these
 faces, bundled with the app (all under the SIL Open Font License). Most are
 variable fonts, so weight is set on the font's own weight axis rather than
 picked from a list of files.

 Fonts are opened straight from their files, so nothing has to be registered
 by name. A letter a face does not have (Korean, say) falls back to the
 system's own font, as it would on the web.
*/

enum SlideFonts {
    /// Where the .ttf files are. The app finds them in its bundle; the test
    /// harness points this at the source folder.
    nonisolated(unsafe) static var directory: URL?

    private static let files: [FontChoice: String] = [
        .serif: "instrument-serif-400",
        .elegant: "cormorant-garamond-var",
        .sans: "dm-sans-var",
        .clean: "figtree-var",
        .geometric: "montserrat-var",
        .mono: "jetbrains-mono-var",
    ]

    /// The weights each face can actually reach.
    private static let weights: [FontChoice: ClosedRange<Double>] = [
        .serif: 400...400,
        .elegant: 300...700,
        .sans: 100...1000,
        .clean: 300...900,
        .geometric: 100...900,
        .mono: 400...800,
    ]

    private static let lock = NSLock()
    nonisolated(unsafe) private static var bases: [FontChoice: CTFontDescriptor] = [:]
    nonisolated(unsafe) private static var cache: [String: CTFontDescriptor] = [:]

    private static func url(for choice: FontChoice) -> URL? {
        guard let name = files[choice] else { return nil }
        if let directory {
            let url = directory.appendingPathComponent(name + ".ttf")
            if FileManager.default.fileExists(atPath: url.path) { return url }
        }
        return Bundle.main.url(forResource: name, withExtension: "ttf")
            ?? Bundle.main.url(forResource: name, withExtension: "ttf", subdirectory: "Fonts")
    }

    private static func base(_ choice: FontChoice) -> CTFontDescriptor? {
        if let found = bases[choice] { return found }
        guard let url = url(for: choice),
              let list = CTFontManagerCreateFontDescriptorsFromURL(url as CFURL) as? [CTFontDescriptor],
              let first = list.first else { return nil }
        bases[choice] = first
        return first
    }

    /// The face at a weight and a size, in pixels.
    static func font(_ choice: FontChoice, weight: Double, size: Double) -> CTFont {
        lock.lock()
        defer { lock.unlock() }
        let range = weights[choice] ?? 400...400
        let w = min(range.upperBound, max(range.lowerBound, weight))
        let key = "\(choice.rawValue)-\(Int(w))"
        var descriptor = cache[key]
        if descriptor == nil, let base = base(choice) {
            descriptor = range.lowerBound == range.upperBound
                ? base
                : CTFontDescriptorCreateCopyWithVariation(base, NSNumber(value: 0x7767_6874) as CFNumber, CGFloat(w))
            cache[key] = descriptor
        }
        if let descriptor {
            return CTFontCreateWithFontDescriptor(descriptor, CGFloat(size), nil)
        }
        // The file is missing: the system face, at roughly the same weight.
        let system = CTFontCreateUIFontForLanguage(choice == .mono ? .userFixedPitch : .system, CGFloat(size), nil)
            ?? CTFontCreateWithName("Helvetica" as CFString, CGFloat(size), nil)
        return system
    }
}
