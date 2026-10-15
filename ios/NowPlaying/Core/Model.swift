import Foundation

/*
 THE DOCUMENT MODEL
 ------------------
 A project is plain data. It is saved as JSON, copied for undo, and nothing in
 this file touches the screen: it only describes what a slide is made of.

 Coordinates are NORMALISED: x and y run 0...1 across the slide, and sizes are
 fractions of the slide width. That is what lets the small on-screen preview
 and the full-size 1080px export share one render function.

 The JSON this writes has the same shape as the web prototype's drafts.
*/

let modelVersion = 1

struct Aspect: Codable, Hashable {
    var id: String
    var w: Int
    var h: Int
}

/// The three ratios Instagram likes.
let namedAspects: [Aspect] = [
    Aspect(id: "1:1", w: 1080, h: 1080),
    Aspect(id: "4:5", w: 1080, h: 1350),
    Aspect(id: "3:4", w: 1080, h: 1440),
]

let loopMin = 6.0
/// Ninety seconds is where Instagram stops taking a video.
let loopMax = 90.0

// MARK: - Animatable values

/// Keyframe easing. All of them settle; none overshoot.
enum Ease: String, Codable, Hashable {
    case linear, out, inOut

    func apply(_ u: Double) -> Double {
        switch self {
        case .linear: return u
        case .out: return 1 - pow(1 - u, 3)
        case .inOut: return u < 0.5 ? 4 * u * u * u : 1 - pow(-2 * u + 2, 3) / 2
        }
    }
}

struct Keyframe: Codable, Hashable {
    var t: Double
    var value: Double
    var ease: Ease?
}

/**
 A number that may be animated. Stored EITHER as a plain value or as a list of
 keyframes, and always read through `at(t)`, so drawing code never cares which.
 */
enum Prop: Hashable, ExpressibleByFloatLiteral, ExpressibleByIntegerLiteral {
    case value(Double)
    case keyframes([Keyframe])

    init(floatLiteral value: Double) { self = .value(value) }
    init(integerLiteral value: Int) { self = .value(Double(value)) }

    var isKeyed: Bool {
        if case .keyframes = self { return true }
        return false
    }

    var frames: [Keyframe] {
        if case .keyframes(let list) = self { return list }
        return []
    }

    /// The value at a moment in time.
    func at(_ t: Double) -> Double {
        switch self {
        case .value(let v):
            return v
        case .keyframes(let f):
            guard let first = f.first, let last = f.last else { return 0 }
            if t <= first.t { return first.value }
            if t >= last.t { return last.value }
            for i in 0..<(f.count - 1) {
                let a = f[i], b = f[i + 1]
                if t >= a.t && t <= b.t {
                    let span = b.t - a.t == 0 ? 1 : b.t - a.t
                    let u = (b.ease ?? .linear).apply((t - a.t) / span)
                    return a.value + (b.value - a.value) * u
                }
            }
            return last.value
        }
    }
}

private struct KeyframeBox: Codable { var keyframes: [Keyframe] }

extension Prop: Codable {
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let v = try? c.decode(Double.self) {
            self = .value(v)
        } else {
            self = .keyframes(try c.decode(KeyframeBox.self).keyframes)
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .value(let v): try c.encode(v)
        case .keyframes(let k): try c.encode(KeyframeBox(keyframes: k))
        }
    }
}

// MARK: - Keyframes

/// Two keyframes closer than this are the same moment.
let sameMoment = 0.05

/// The keyframe at this moment, or nil.
func keyIndex(_ prop: Prop?, at t: Double) -> Int? {
    guard let prop, prop.isKeyed else { return nil }
    return prop.frames.firstIndex { abs($0.t - t) < sameMoment }
}

/// Set the value at a moment. Unkeyed, that is just the value. Keyed, it is a
/// keyframe at that moment, made if there is none: once a slider is animated,
/// moving it anywhere on the timeline records a keyframe there.
func setValue(_ prop: inout Prop?, at t: Double, _ value: Double) {
    guard case .keyframes(var frames) = prop else {
        prop = .value(value)
        return
    }
    if let i = frames.firstIndex(where: { abs($0.t - t) < sameMoment }) {
        frames[i].value = value
    } else {
        frames.append(Keyframe(t: t, value: value, ease: .inOut))
        frames.sort { $0.t < $1.t }
    }
    prop = .keyframes(frames)
}

/// Add a keyframe here holding the value as it is, or take away the one here.
func toggleKey(_ prop: inout Prop?, at t: Double, fallback: Double) {
    let current = prop?.at(t) ?? fallback
    guard case .keyframes(var frames) = prop else {
        prop = .keyframes([Keyframe(t: t, value: current, ease: .inOut)])
        return
    }
    guard let i = frames.firstIndex(where: { abs($0.t - t) < sameMoment }) else {
        setValue(&prop, at: t, current)
        return
    }
    frames.remove(at: i)
    // The last keyframe gone: back to a plain value, the one showing now.
    prop = frames.isEmpty ? .value(current) : .keyframes(frames)
}

// MARK: - Layers

enum LayerType: String, Codable, Hashable {
    case photo, disc, cover, text, progressBar, controls, card, window, artPanel

    var label: String {
        switch self {
        case .photo: return "Photo"
        case .disc: return "Record"
        case .cover: return "Cover"
        case .text: return "Text"
        case .progressBar: return "Progress"
        case .controls: return "Controls"
        case .card: return "Card"
        case .window: return "Window"
        case .artPanel: return "Art panel"
        }
    }

    /// Panels with a free shape: a corner reshapes them.
    var isPane: Bool { self == .card || self == .window || self == .artPanel }
}

enum PhotoMode: String, Codable, Hashable { case photo, solid }
enum TextBind: String, Codable, Hashable { case title, artist, album }
enum TextAlign: String, Codable, Hashable { case left, center, right }

/// The faces a text layer can be set in, in the order the editor offers them.
enum FontChoice: String, Codable, Hashable, CaseIterable, Identifiable {
    case serif, elegant, sans, clean, geometric, mono
    var id: String { rawValue }
    var label: String {
        switch self {
        case .serif: return "Serif"
        case .elegant: return "Elegant"
        case .sans: return "Sans"
        case .clean: return "Clean"
        case .geometric: return "Round"
        case .mono: return "Mono"
        }
    }
}

/// How round each corner of a pane is: top left, top right, bottom right,
/// bottom left, as a multiple of the pane's corner roundness.
enum CornerShape: String, Codable, Hashable, CaseIterable, Identifiable {
    case round, bookmark, leaf, leafFlip, top, square
    var id: String { rawValue }
    var label: String {
        switch self {
        case .round: return "All round"
        case .bookmark: return "Bookmark"
        case .leaf: return "Top right and bottom left"
        case .leafFlip: return "Top left and bottom right"
        case .top: return "Top only"
        case .square: return "Square"
        }
    }
    var corners: [Double] {
        switch self {
        case .round: return [1, 1, 1, 1]
        case .bookmark: return [1, 2.2, 1, 1]
        case .leaf: return [0, 2, 0, 2]
        case .leafFlip: return [2, 0, 2, 0]
        case .top: return [1.5, 1.5, 0, 0]
        case .square: return [0, 0, 0, 0]
        }
    }
}

/// The numbers a gesture, a slider or a keyframe strip can reach by name.
enum NumKey: String, Hashable, CaseIterable {
    case x, y, scale, rotation, opacity, mono, ratio, radius, blur, grain, dim, shadow
}

/**
 Every layer shares the same five transform properties, so drag, pinch and
 twist work on all of them without special cases. The rest belong to one kind
 of layer each and are nil elsewhere.
 */
struct LayerProps: Codable, Hashable {
    var x: Prop = 0.5
    var y: Prop = 0.5
    var scale: Prop = 1
    var rotation: Prop = 0
    var opacity: Prop = 1

    // photo
    var mode: PhotoMode?
    var solidColor: String?
    var mono: Prop?
    // record
    var rpm: Double?
    var direction: Double?
    var labelColor: String?
    var showLabelArt: Bool?
    // cover
    var shadow: Prop?
    var round: Bool?
    // text
    var bind: TextBind?
    var text: String?
    var size: Double?
    var font: FontChoice?
    var align: TextAlign?
    var tracking: Double?
    var uppercase: Bool?
    var weight: Double?
    var maxWidth: Double?
    var tone: String?
    var color: String?
    // progress bar and controls
    var speed: Double?
    var showTimes: Bool?
    var style: String?
    var ring: Bool?
    // panes
    var ratio: Prop?
    var radius: Prop?
    var blur: Prop?
    var grain: Prop?
    var dim: Prop?
    var corners: CornerShape?

    subscript(key key: NumKey) -> Prop? {
        get {
            switch key {
            case .x: return x
            case .y: return y
            case .scale: return scale
            case .rotation: return rotation
            case .opacity: return opacity
            case .mono: return mono
            case .ratio: return ratio
            case .radius: return radius
            case .blur: return blur
            case .grain: return grain
            case .dim: return dim
            case .shadow: return shadow
            }
        }
        set {
            switch key {
            case .x: x = newValue ?? x
            case .y: y = newValue ?? y
            case .scale: scale = newValue ?? scale
            case .rotation: rotation = newValue ?? rotation
            case .opacity: opacity = newValue ?? opacity
            case .mono: mono = newValue
            case .ratio: ratio = newValue
            case .radius: radius = newValue
            case .blur: blur = newValue
            case .grain: grain = newValue
            case .dim: dim = newValue
            case .shadow: shadow = newValue
            }
        }
    }

    var hasKeyframes: Bool { NumKey.allCases.contains { self[key: $0]?.isKeyed == true } }
}

struct Layer: Codable, Hashable, Identifiable {
    var id: String
    var type: LayerType
    var name: String
    var visible = true
    var locked = false
    var props = LayerProps()
    var effects: [Effect] = []
}

/// Short, readable, unique-enough ids.
func newId(_ prefix: String = "l") -> String {
    prefix + UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(12).lowercased()
}

func makeLayer(_ type: LayerType, _ name: String, locked: Bool = false, effects: [Effect] = [],
               _ configure: (inout LayerProps) -> Void = { _ in }) -> Layer {
    var props = LayerProps()
    configure(&props)
    return Layer(id: newId(), type: type, name: name, visible: true, locked: locked, props: props, effects: effects)
}

// MARK: - Song

struct Song: Codable, Hashable {
    var id: String?
    var source: String?
    var title = ""
    var artist = ""
    var album = ""
    var year = ""
    var durationMs: Double = 0
    var version = ""
    var artworkUrl100 = ""
    var coverUrls: [String] = []
    var clipStartSeconds: Double = 0
}

// MARK: - Templates

/**
 A template returns a starting list of layers. It is only called when you pick
 one; after that the layers are yours and the template has no further say.
 */
enum TemplateID: String, Codable, Hashable, CaseIterable, Identifiable {
    case vinyl, player, window, media, bookmark

    var id: String { rawValue }

    var label: String {
        switch self {
        case .vinyl: return "Vinyl"
        case .player: return "Player"
        case .window: return "Window"
        case .media: return "Media"
        case .bookmark: return "Bookmark"
        }
    }

    var summary: String {
        switch self {
        case .vinyl: return "Your photo, with a sleeve in the corner and the record turning behind it."
        case .player: return "A large cover on a pane of glass over your blurred photo, with the time running underneath."
        case .window: return "Your photo in black and white, with one window where it stays in full colour."
        case .media: return "A wide panel made of the cover, with the song and its controls on it, like a phone's media card."
        case .bookmark: return "A tall strip of glass down one side, like a bookmark, with a round cover."
        }
    }

    /// Laid out for the slide it is going on, so it holds together on any shape.
    var fitsAnyShape: Bool { self != .vinyl }

    func build(_ aspect: Aspect = namedAspects[1]) -> [Layer] {
        // Distance from the middle of the slide, in slide widths, turned into
        // a fraction of the height.
        let across = Double(aspect.w) / Double(aspect.h)
        let at = { (offset: Double) in 0.5 + offset * across }

        switch self {
        case .vinyl:
            return [
                makeLayer(.photo, "Photo", locked: true) { $0.mode = .photo },
                makeLayer(.disc, "Record") {
                    $0.x = 0.66; $0.y = 0.64; $0.scale = 0.44
                    $0.rpm = 30; $0.direction = 1; $0.showLabelArt = true
                },
                makeLayer(.cover, "Sleeve") { $0.x = 0.36; $0.y = 0.64; $0.scale = 0.44; $0.shadow = 0.55 },
                makeLayer(.text, "Title") {
                    $0.bind = .title; $0.x = 0.5; $0.y = 0.875; $0.size = 0.054
                    $0.font = .serif; $0.align = .center; $0.tracking = 0
                },
                makeLayer(.text, "Artist") {
                    $0.bind = .artist; $0.x = 0.5; $0.y = 0.928; $0.size = 0.03
                    $0.font = .sans; $0.align = .center; $0.tracking = 0.1; $0.uppercase = true
                },
            ]

        case .player:
            let k = 0.93
            return [
                makeLayer(.photo, "Photo", locked: true, effects: [Effect(type: .blur, params: ["radius": 34])]) {
                    $0.mode = .photo
                },
                makeLayer(.card, "Card") {
                    $0.x = 0.5; $0.y = .value(at(0)); $0.scale = .value(0.78 * k)
                    $0.ratio = .value(0.92 / 0.78); $0.radius = 0.075; $0.blur = 12
                },
                makeLayer(.cover, "Cover") {
                    $0.x = 0.5; $0.y = .value(at(-0.17 * k)); $0.scale = .value(0.46 * k); $0.shadow = 0.5
                },
                makeLayer(.text, "Title") {
                    $0.bind = .title; $0.x = 0.5; $0.y = .value(at(0.125 * k)); $0.size = 0.054
                    $0.scale = .value(k); $0.maxWidth = 0.66; $0.font = .serif; $0.align = .center; $0.tracking = 0
                },
                makeLayer(.text, "Artist") {
                    $0.bind = .artist; $0.x = 0.5; $0.y = .value(at(0.17 * k)); $0.size = 0.03
                    $0.scale = .value(k); $0.maxWidth = 0.66; $0.font = .sans; $0.align = .center
                    $0.tracking = 0.1; $0.uppercase = true
                },
                makeLayer(.progressBar, "Progress") {
                    $0.x = 0.5; $0.y = .value(at(0.235 * k)); $0.scale = .value(0.62 * k)
                    $0.speed = 1; $0.showTimes = true
                },
                makeLayer(.controls, "Controls") { $0.x = 0.5; $0.y = .value(at(0.355 * k)); $0.scale = .value(0.27 * k) },
            ]

        case .window:
            return [
                makeLayer(.photo, "Photo", locked: true) { $0.mode = .photo; $0.mono = 1 },
                makeLayer(.window, "Window") {
                    $0.x = 0.5; $0.y = .value(at(-0.18)); $0.scale = 0.5; $0.ratio = 1.3; $0.radius = 0.06
                },
                // A small player under the window: the cover, and the song beside it.
                makeLayer(.cover, "Cover") { $0.x = 0.31; $0.y = .value(at(0.245)); $0.scale = 0.12; $0.shadow = 0.35 },
                makeLayer(.text, "Title") {
                    $0.bind = .title; $0.x = 0.4; $0.y = .value(at(0.225)); $0.size = 0.056; $0.maxWidth = 0.36
                    $0.font = .elegant; $0.weight = 500; $0.align = .left; $0.tracking = 0
                },
                makeLayer(.text, "Artist") {
                    $0.bind = .artist; $0.x = 0.4; $0.y = .value(at(0.272)); $0.size = 0.028; $0.maxWidth = 0.36
                    $0.font = .sans; $0.weight = 400; $0.align = .left; $0.tracking = 0.02
                },
                makeLayer(.progressBar, "Progress") {
                    $0.x = 0.5; $0.y = .value(at(0.37)); $0.scale = 0.5; $0.speed = 1; $0.showTimes = true
                },
                makeLayer(.controls, "Controls") { $0.x = 0.5; $0.y = .value(at(0.47)); $0.scale = 0.24 },
            ]

        case .media:
            let left = { (p: inout LayerProps) in
                p.font = .clean; p.align = .left; p.x = 0.14; p.maxWidth = 0.55
            }
            return [
                makeLayer(.photo, "Photo", locked: true) { $0.mode = .photo },
                makeLayer(.artPanel, "Art panel") {
                    $0.x = 0.5; $0.y = .value(at(0)); $0.scale = 0.86; $0.ratio = 0.5; $0.radius = 0.09; $0.dim = 0.35
                },
                makeLayer(.text, "Label") {
                    left(&$0); $0.text = "Phone speaker"; $0.y = .value(at(-0.15)); $0.size = 0.026; $0.weight = 500
                },
                makeLayer(.text, "Title") {
                    left(&$0); $0.bind = .title; $0.y = .value(at(-0.087)); $0.size = 0.056; $0.weight = 600
                    $0.tracking = -0.01
                },
                makeLayer(.text, "Artist") {
                    left(&$0); $0.bind = .artist; $0.y = .value(at(-0.037)); $0.size = 0.032; $0.weight = 400
                },
                makeLayer(.progressBar, "Progress") {
                    $0.x = 0.5; $0.y = .value(at(0.035)); $0.scale = 0.72; $0.speed = 1; $0.showTimes = true
                    $0.style = "pill"; $0.font = .clean
                },
                makeLayer(.controls, "Controls") { $0.x = 0.5; $0.y = .value(at(0.15)); $0.scale = 0.62; $0.style = "media" },
            ]

        case .bookmark:
            let x = 0.72
            let round = { (p: inout LayerProps) in
                p.font = .clean; p.align = .center; p.x = .value(x)
            }
            return [
                makeLayer(.photo, "Photo", locked: true) { $0.mode = .photo },
                makeLayer(.card, "Card") {
                    $0.x = .value(x); $0.y = .value(at(-0.02)); $0.scale = 0.4; $0.ratio = 2.2; $0.radius = 0.09
                    $0.corners = .bookmark; $0.blur = 30
                },
                makeLayer(.text, "Label") {
                    round(&$0); $0.text = "Now playing"; $0.uppercase = true; $0.maxWidth = 0.3
                    $0.y = .value(at(-0.372)); $0.size = 0.026; $0.weight = 500; $0.tracking = 0.06
                },
                makeLayer(.text, "Album") {
                    round(&$0); $0.bind = .album; $0.uppercase = true; $0.maxWidth = 0.3
                    $0.y = .value(at(-0.336)); $0.size = 0.03; $0.weight = 700; $0.tracking = 0.08
                },
                makeLayer(.cover, "Cover") {
                    $0.x = .value(x); $0.y = .value(at(-0.17)); $0.scale = 0.24; $0.shadow = 0.35; $0.round = true
                },
                makeLayer(.text, "Title") {
                    round(&$0); $0.bind = .title; $0.maxWidth = 0.3; $0.y = .value(at(0)); $0.size = 0.05
                    $0.weight = 700; $0.tracking = -0.01; $0.tone = "accent"
                },
                makeLayer(.text, "Artist") {
                    round(&$0); $0.bind = .artist; $0.maxWidth = 0.3; $0.y = .value(at(0.045)); $0.size = 0.028
                    $0.weight = 400; $0.tracking = 0; $0.tone = "accent"
                },
                makeLayer(.progressBar, "Progress") {
                    $0.x = .value(x); $0.y = .value(at(0.16)); $0.scale = 0.32; $0.speed = 1; $0.showTimes = true
                    $0.font = .clean
                },
                makeLayer(.controls, "Controls") { $0.x = .value(x); $0.y = .value(at(0.28)); $0.scale = 0.26; $0.ring = true },
            ]
        }
    }
}

// MARK: - Projects

struct LayoutSize: Codable, Hashable {
    var w: Int
    var h: Int
}

struct Project: Codable, Hashable {
    var version = modelVersion
    var aspect: Aspect
    var song = Song()
    var loopSeconds: Double = 8
    var template: TemplateID
    /// The shape the layers were laid out for. fitToSlide works from this.
    var layoutAspect: LayoutSize?
    var showCover = true
    /// The furniture moves as one arrangement.
    var grouped = true
    /// Fades everything on the photo together. Optional so drafts saved
    /// before it still open; nil means fully there.
    var overlayOpacity: Double?
    /// Colours pulled from the cover or the photo.
    var palette: [String] = []
    var layers: [Layer]

    init(aspect: Aspect = namedAspects[1], template: TemplateID = .vinyl, song: Song = Song()) {
        self.aspect = aspect
        self.song = song
        self.template = template
        self.layoutAspect = template.fitsAnyShape ? LayoutSize(w: aspect.w, h: aspect.h) : LayoutSize(w: 1080, h: 1350)
        self.layers = template.build(aspect)
    }

    /// Swap the template but keep the song, the ratio and the loop length.
    mutating func applyTemplate(_ id: TemplateID) {
        template = id
        layers = id.build(aspect)
        layoutAspect = id.fitsAnyShape ? LayoutSize(w: aspect.w, h: aspect.h) : LayoutSize(w: 1080, h: 1350)
    }

    func layer(_ id: String?) -> Layer? {
        guard let id else { return nil }
        return layers.first { $0.id == id }
    }

    func index(of id: String?) -> Int? {
        guard let id else { return nil }
        return layers.firstIndex { $0.id == id }
    }

    var photoIndex: Int? { layers.firstIndex { $0.type == .photo } }

    /**
     WHAT MOVES TOGETHER
     The cover, the words, the bar and the buttons are one arrangement, not five
     loose pieces, so by default dragging any of them drags all of them. Two
     ways out: turn grouping off, or lock the one layer you want to leave. The
     photo never joins; it is the background.
     */
    func movesWith(_ layer: Layer?) -> [Layer] {
        guard let layer else { return [] }
        if !grouped || layer.type == .photo { return [layer] }
        // The layer itself always belongs, even hidden.
        return layers.filter { $0.id == layer.id || ($0.type != .photo && !$0.locked && $0.visible) }
    }

    /// Read or write any animatable number by path. This is what a keyframe
    /// strip or a slider holds on to.
    subscript(path: PropPath) -> Prop? {
        get {
            switch path {
            case let .layer(id, key):
                return layer(id)?.props[key: key]
            case let .effect(id, index, param):
                guard let l = layer(id), l.effects.indices.contains(index) else { return nil }
                return l.effects[index].params[param]
            }
        }
        set {
            switch path {
            case let .layer(id, key):
                guard let i = index(of: id) else { return }
                layers[i].props[key: key] = newValue
            case let .effect(id, index, param):
                guard let i = self.index(of: id), layers[i].effects.indices.contains(index) else { return }
                layers[i].effects[index].params[param] = newValue
            }
        }
    }
}

/// Where an animatable number lives in a project.
enum PropPath: Hashable {
    case layer(String, NumKey)
    case effect(String, Int, String)
}

/// How many whole turns the record makes over one loop. The loop only closes
/// if the record ends where it started, so the speed is rounded to whole turns.
func turnsPerLoop(_ rpm: Double, _ loopSeconds: Double) -> Int {
    max(1, Int((rpm / 60 * loopSeconds).rounded()))
}

func actualRpm(_ rpm: Double, _ loopSeconds: Double) -> Double {
    Double(turnsPerLoop(rpm, loopSeconds)) / loopSeconds * 60
}

/// A project without the photo or the song: that is what a saved style is.
struct Style: Codable, Hashable, Identifiable {
    var id: String
    var name: String
    var updatedAt: Date
    var project: Project

    init(project: Project, name: String) {
        var copy = project
        copy.song = Song()
        self.id = newId("s")
        self.name = name
        self.updatedAt = Date()
        self.project = copy
    }
}

/// m:ss, used everywhere a time is shown.
func formatTime(_ seconds: Double) -> String {
    let s = seconds.isFinite && seconds > 0 ? seconds : 0
    let whole = Int(s.rounded(.down))
    return "\(whole / 60):" + String(format: "%02d", whole % 60)
}
