import CoreGraphics
import Observation
import QuartzCore
import SwiftUI
import UIKit

/*
 THE EDITOR
 ----------
 Plays the loop, draws the preview, and works out what fingers on the slide
 mean. Tap a layer to select it; drag to move, pinch to resize, twist to
 rotate; grab a corner dot to resize, just outside one to turn. A pinch that
 starts on no layer zooms the view instead, about the fingers. Moving
 together, a gesture moves the whole arrangement, and the last little bit of
 every gesture snaps: to the middle, to anything standing still, to clean
 angles. A light tap of haptics says it landed.
*/

struct Snapped: Equatable {
    var x = false
    var y = false
    var rotation = false
    var any: Bool { x || y || rotation }
}

/// A keyframe picked on a strip, by where it lives and when it is.
struct PickedKey: Hashable {
    var path: PropPath
    var t: Double
}

@MainActor
@Observable
final class EditorEngine {
    enum Tab: String, CaseIterable, Identifiable {
        case slide, layer, motion, song
        var id: String { rawValue }
        var label: String {
            switch self {
            case .slide: return "Slide"
            case .layer: return "Layer"
            case .motion: return "Motion"
            case .song: return "Song"
            }
        }
    }

    static let zooms: [CGFloat] = [1, 1.5, 2, 3]

    let model: AppModel
    var tab: Tab = .slide
    var playing = false
    var zoom: CGFloat = 1
    var pan: CGSize = .zero
    var picked: [PickedKey] = []
    var snapped = Snapped()
    /// The preview's own pixel size: what gestures measure in.
    private(set) var stage = StageSize(width: 1080, height: 1350)
    /// Drawn while a finger is down: a 2x picture costs under half a 3x one,
    /// so the slide keeps up with the finger. Sharp again when it lifts.
    private var quick = StageSize(width: 1080, height: 1350)
    /// The slide's size on screen, in points, zoom included.
    private(set) var viewSize: CGSize = .zero

    @ObservationIgnored let renderer = PreviewRenderer()
    @ObservationIgnored weak var surface: PreviewSurfaceView?
    @ObservationIgnored private var link: CADisplayLink?
    @ObservationIgnored private var playStart: CFTimeInterval = 0
    @ObservationIgnored private var touches: [ObjectIdentifier: CGPoint] = [:]
    @ObservationIgnored private var start: GestureStart?
    @ObservationIgnored private var grabbed: Handle?
    @ObservationIgnored private var panning: (from: CGPoint, pan: CGSize)?
    /// Where each finger is on the screen, for zooming the view.
    @ObservationIgnored private var screens: [ObjectIdentifier: CGPoint] = [:]
    @ObservationIgnored private var pinch: (distance: Double, mid: CGPoint, zoom: CGFloat, pan: CGSize,
                                            center: CGPoint, base: CGSize)?
    /// While the view is being pinched it follows the fingers exactly, and the
    /// picture is stretched rather than redrawn at every size on the way.
    private(set) var pinching = false
    @ObservationIgnored private var pendingSize: (size: CGSize, scale: CGFloat)?
    @ObservationIgnored private let snapFeedback = UIImpactFeedbackGenerator(style: .light)
    @ObservationIgnored private let selectFeedback = UISelectionFeedbackGenerator()

    init(model: AppModel) {
        self.model = model
        renderer.onFrame = { [weak self] image in self?.surface?.show(image) }
    }

    var project: Project? { model.project }
    var loop: Double { model.project?.loopSeconds ?? 8 }

    // MARK: - Lifecycle

    func appear(reduceMotion: Bool) {
        model.onProjectChange = { [weak self] in self?.redraw() }
        model.time = min(model.time, loop)
        // Start paused when the phone asks for less movement.
        if reduceMotion { redraw() } else { play() }
    }

    func disappear() {
        stopLink()
        playing = false
        model.onProjectChange = nil
    }

    // MARK: - Drawing

    /// The slide's on-screen size and the screen's sharpness decide the
    /// preview's pixel size, never past the slide's real size. Everything is
    /// stored as fractions, so this changes nothing but sharpness.
    func setViewSize(_ size: CGSize, scale: CGFloat) {
        guard let project, size.width > 1 else { return }
        viewSize = size
        if pinching {
            pendingSize = (size, scale)
            return
        }
        let width = min(project.aspect.w, Int((size.width * min(3, scale)).rounded()))
        let height = Int((Double(width) * Double(project.aspect.h) / Double(project.aspect.w)).rounded())
        let next = StageSize(width: Double(width), height: Double(height))
        // Within a few pixels, keep what is there: same picture.
        if abs(next.width - stage.width) > 4 || abs(next.height - stage.height) > 4 { stage = next }
        let quickWidth = min(Int(stage.width), Int((size.width * min(2, scale)).rounded()))
        quick = StageSize(width: Double(quickWidth),
                          height: (Double(quickWidth) * Double(project.aspect.h) / Double(project.aspect.w)).rounded())
        redraw()
    }

    func redraw() {
        guard let project, stage.width > 1 else { return }
        let size = touches.isEmpty ? stage : quick
        renderer.request(.init(project: project, media: model.media, t: model.time,
                               width: Int(size.width), height: Int(size.height)))
    }

    // MARK: - Time

    func togglePlay() {
        playing ? pause() : play()
    }

    func play() {
        guard !playing else { return }
        playing = true
        playStart = CACurrentMediaTime() - model.time
        let link = CADisplayLink(target: DisplayLinkProxy(self), selector: #selector(DisplayLinkProxy.tick))
        // The file is thirty frames a second, so the preview is too: drawing at
        // the screen's 120 would be four times the work to show the same thing.
        link.preferredFrameRateRange = CAFrameRateRange(minimum: 30, maximum: 30, preferred: 30)
        link.add(to: .main, forMode: .common)
        self.link = link
    }

    /// Stop where it is. Editing a value means editing it at one moment.
    func pause() {
        guard playing else { return }
        playing = false
        stopLink()
        model.time = position()
        redraw()
    }

    private func stopLink() {
        link?.invalidate()
        link = nil
    }

    private func position() -> Double {
        (CACurrentMediaTime() - playStart).truncatingRemainder(dividingBy: max(0.1, loop))
    }

    fileprivate func tick() {
        guard playing else { return }
        model.time = position()
        redraw()
    }

    /// Go to a moment and stay there.
    func seek(_ t: Double) {
        pause()
        model.time = max(0, min(loop, t))
        redraw()
    }

    // MARK: - Zoom

    func zoom(by step: Int) {
        // A pinch can leave the zoom between steps; the buttons go to the next one.
        let next = step > 0 ? Self.zooms.first { $0 > zoom + 0.01 } : Self.zooms.last { $0 < zoom - 0.01 }
        guard let next else { return }
        // The view keeps the same middle as it grows or shrinks.
        pan = CGSize(width: pan.width * next / zoom, height: pan.height * next / zoom)
        zoom = next
        if zoom == 1 { pan = .zero }
    }

    // MARK: - Selection

    func select(_ id: String?) {
        let changed = id != model.selectedLayerId
        model.selectedLayerId = id
        if changed {
            selectFeedback.selectionChanged()
            // The panel follows the selection, the way an inspector does.
            if id != nil && tab == .slide { tab = .layer }
        }
        redraw()
    }

    /// Select from the list, or let go with nil, and show what it can do.
    func pick(_ id: String?) {
        model.selectedLayerId = id
        tab = .layer
        redraw()
    }

    // MARK: - Keyframes

    func toggleKeys(_ paths: [PropPath], fallback: Double) {
        guard let lead = paths.first else { return }
        pause()
        let t = model.time
        let on = keyIndex(model.project?[lead], at: t) != nil
        model.edit { project in
            for path in paths {
                // All of them follow the lead: on together, off together.
                if (keyIndex(project[path], at: t) != nil) == on {
                    var prop = project[path]
                    toggleKey(&prop, at: t, fallback: fallback)
                    project[path] = prop
                }
            }
        }
    }

    /// Set a value at the playhead, across every path a control moves.
    func setValues(_ value: Double, _ paths: [PropPath]) {
        pause()
        let t = model.time
        model.edit { project in
            for path in paths {
                var prop = project[path]
                setValue(&prop, at: t, value)
                project[path] = prop
            }
        }
    }

    func deletePicked() {
        guard !picked.isEmpty else { return }
        model.edit { project in
            for key in picked {
                guard case .keyframes(var frames)? = project[key.path],
                      let i = frames.firstIndex(where: { abs($0.t - key.t) < 1e-9 }) else { continue }
                let held = frames.remove(at: i)
                // The last one gone: back to a plain value, the one it held.
                project[key.path] = frames.isEmpty ? .value(held.value) : .keyframes(frames)
            }
        }
        picked = []
    }

    // MARK: - Touches
    // Points arrive in the preview's pixels. `screen` is where the finger is
    // in the window, which only panning a zoomed view needs.

    private var selectedLayer: Layer? { model.selectedLayer }

    func touchesBegan(_ new: [(ObjectIdentifier, CGPoint, CGPoint)]) {
        guard let project = model.project else { return }
        for (id, point, screen) in new { touches[id] = point; screens[id] = screen }
        // Moving something means moving it at one moment, so time stops first.
        pause()

        if touches.count == 1, let point = touches.values.first {
            let t = model.time
            // A corner of what is already selected is taken first, so reaching
            // for a handle never picks up whatever sits behind it.
            grabbed = handleAt(selectedLayer, project, stage, point.x, point.y, t)
            // A selected pane, or a group, keeps hold of any touch inside it:
            // it sits under everything, so otherwise almost every touch on it
            // would land on the cover or the words instead.
            var keep = false
            if grabbed == nil, let held = selectedLayer {
                keep = (held.type.isPane || project.movesWith(held).count > 1)
                    && inside(selectionBounds(held, project, stage, t), point.x, point.y)
            }
            if grabbed == nil && !keep {
                select(layerAt(project, stage, point.x, point.y, t)?.id)
            }
            // Zoomed in, a touch that picks nothing up moves the view instead.
            if zoom > 1 && model.selectedLayerId == nil, let screen = new.first?.2 {
                panning = (screen, pan)
            }
        } else if touches.count == 2 && new.count == 2 {
            // Both fingers landed at once, as a pinch usually does. It belongs
            // to what is held, if it is between them, or else to whatever lies
            // between them or under either one. Nothing there: zoom the view.
            let p = Array(touches.values)
            let spots = [CGPoint(x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2)] + p
            let t = model.time
            let holding = selectedLayer.map { held in
                spots.contains { inside(selectionBounds(held, project, stage, t), $0.x, $0.y) }
            } ?? false
            if !holding {
                select(spots.lazy.compactMap { layerAt(project, self.stage, $0.x, $0.y, t) }.first?.id)
            }
        }
        beginGesture()
        // Two fingers and nothing to hold: zoom the view.
        if touches.count == 2 && start == nil { beginPinch() }
    }

    private func beginPinch() {
        let s = Array(screens.values)
        guard s.count == 2, let surface, zoom > 0 else { return }
        panning = nil
        pinch = (hypot(s[1].x - s[0].x, s[1].y - s[0].y),
                 CGPoint(x: (s[0].x + s[1].x) / 2, y: (s[0].y + s[1].y) / 2),
                 zoom, pan,
                 surface.convert(CGPoint(x: surface.bounds.midX, y: surface.bounds.midY), to: nil),
                 CGSize(width: viewSize.width / zoom, height: viewSize.height / zoom))
        pinching = true
    }

    private func beginGesture() {
        guard let project = model.project, let layer = selectedLayer, !layer.locked else {
            start = nil
            return
        }
        var base = gestureStart(project, layer, t: model.time)
        let points = Array(touches.values)

        if points.count >= 2 {
            let two = twoFinger(points)
            base.mode = .two
            base.midX = two.midX; base.midY = two.midY
            base.distance = two.distance; base.angle = two.angle
            start = base
            return
        }
        guard let only = points.first else { start = nil; return }
        guard let grabbed else {
            base.mode = .one
            base.midX = only.x; base.midY = only.y
            start = base
            return
        }
        // A handle works about the middle of the layer it belongs to (or of
        // the group's box, moving together), so the corner stays under the
        // finger instead of drifting away from it.
        let box = base.members.count > 1 ? selectionBounds(layer, project, stage, base.t) : nil
        let px = box?.cx ?? base.lead.x * stage.width
        let py = box?.cy ?? base.lead.y * stage.height
        base.pivotX = px / stage.width
        base.pivotY = py / stage.height
        // On its own, a pane's corner changes its width and height apart.
        base.mode = grabbed == .scale && base.members.count == 1 && layer.type.isPane ? .stretch
            : grabbed == .scale ? .scale : .rotate
        base.midX = only.x; base.midY = only.y
        base.grabRadius = hypot(only.x - px, only.y - py)
        base.grabAngle = atan2(only.y - py, only.x - px) * 180 / .pi
        start = base
    }

    private func twoFinger(_ p: [CGPoint]) -> (midX: Double, midY: Double, distance: Double, angle: Double) {
        let a = p[0], b = p[1]
        return ((a.x + b.x) / 2, (a.y + b.y) / 2, hypot(b.x - a.x, b.y - a.y), atan2(b.y - a.y, b.x - a.x) * 180 / .pi)
    }

    func touchesMoved(_ moved: [(ObjectIdentifier, CGPoint, CGPoint)]) {
        for (id, point, screen) in moved where touches[id] != nil { touches[id] = point; screens[id] = screen }

        if let pinch {
            let s = Array(screens.values)
            guard s.count == 2 else { return }
            let mid = CGPoint(x: (s[0].x + s[1].x) / 2, y: (s[0].y + s[1].y) / 2)
            let next = max(1, min(Self.zooms.last!, pinch.zoom * hypot(s[1].x - s[0].x, s[1].y - s[0].y) / max(1, pinch.distance)))
            let k = next / pinch.zoom
            // The part of the slide that was between the fingers stays between them.
            let x = mid.x - (pinch.center.x - pinch.pan.width) - (pinch.mid.x - pinch.center.x) * k
            let y = mid.y - (pinch.center.y - pinch.pan.height) - (pinch.mid.y - pinch.center.y) * k
            let limit = CGSize(width: pinch.base.width * (next - 1) / 2, height: pinch.base.height * (next - 1) / 2)
            zoom = next
            pan = CGSize(width: max(-limit.width, min(limit.width, x)), height: max(-limit.height, min(limit.height, y)))
            return
        }

        if let panning, let screen = moved.first?.2 {
            let limit = CGSize(width: max(0, viewSize.width - viewSize.width / zoom) / 2,
                               height: max(0, viewSize.height - viewSize.height / zoom) / 2)
            pan = CGSize(width: max(-limit.width, min(limit.width, panning.pan.width + screen.x - panning.from.x)),
                         height: max(-limit.height, min(limit.height, panning.pan.height + screen.y - panning.from.y)))
            return
        }
        guard let start else { return }
        let points = Array(touches.values)
        let stage = self.stage

        if start.mode == .stretch, let only = points.first {
            // The corner goes where the finger is; the opposite corner mirrors
            // it, so the pane stays centred where it was.
            let angle = -start.lead.rotation * .pi / 180
            let ox = only.x - start.pivotX * stage.width
            let oy = only.y - start.pivotY * stage.height
            let localX = ox * cos(angle) - oy * sin(angle)
            let localY = ox * sin(angle) + oy * cos(angle)
            let w = max(stage.width * 0.08, abs(localX) * 2)
            let h = max(stage.width * 0.08, abs(localY) * 2)
            model.edit { project in
                var scale = project[.layer(start.lead.id, .scale)]
                setValue(&scale, at: start.t, w / stage.width)
                project[.layer(start.lead.id, .scale)] = scale
                var ratio = project[.layer(start.lead.id, .ratio)]
                setValue(&ratio, at: start.t, h / w)
                project[.layer(start.lead.id, .ratio)] = ratio
            }
            return
        }

        var k = 1.0, turn = 0.0, dx = 0.0, dy = 0.0
        switch start.mode {
        case .two where points.count >= 2:
            let now = twoFinger(points)
            if start.distance > 4 { k = now.distance / start.distance }
            // Snap the angle the layer ENDS on, not the amount the fingers
            // turned, so a tilt lands on 15 degrees, not 15 from where it was.
            turn = pullAngle(start.lead.rotation + (now.angle - start.angle)) - start.lead.rotation
            dx = (now.midX - start.midX) / stage.width
            dy = (now.midY - start.midY) / stage.height
        case .scale, .rotate:
            guard let only = points.first else { return }
            let px = start.pivotX * stage.width, py = start.pivotY * stage.height
            if start.mode == .scale {
                if start.grabRadius > 4 { k = hypot(only.x - px, only.y - py) / start.grabRadius }
            } else {
                let now = atan2(only.y - py, only.x - px) * 180 / .pi
                turn = pullAngle(start.lead.rotation + (now - start.grabAngle)) - start.lead.rotation
            }
        case .one:
            guard let only = points.first else { return }
            dx = (only.x - start.midX) / stage.width
            dy = (only.y - start.midY) / stage.height
        default:
            return
        }

        // Placed once to see where the finger put it, then nudged onto
        // whichever guide it came close to, and placed again. The nudge moves
        // the whole group, so nothing inside it shifts.
        var landed = Snapped()
        model.edit { project in
            placeMembers(&project, start, stage, k, turn, dx, dy)
            guard let lead = project.layer(start.lead.id)?.props else { return }
            let lining = start.mode == .one || start.mode == .two
            let pullX = lining ? pullTo(lead.x.at(start.t), start.xTargets, snapReach) : 0
            let pullY = lining ? pullTo(lead.y.at(start.t), start.yTargets, snapReach) : 0
            if pullX != 0 || pullY != 0 { placeMembers(&project, start, stage, k, turn, dx + pullX, dy + pullY) }
            let rotation = project.layer(start.lead.id)?.props.rotation.at(start.t) ?? 0
            landed = Snapped(x: pullX != 0, y: pullY != 0,
                             rotation: turn != 0 && abs(rotation.truncatingRemainder(dividingBy: snapAngle)) < 0.001)
        }
        if landed != snapped {
            if (landed.x && !snapped.x) || (landed.y && !snapped.y) || (landed.rotation && !snapped.rotation) {
                snapFeedback.impactOccurred()
            }
            snapped = landed
        }
    }

    func touchesEnded(_ ended: [ObjectIdentifier]) {
        for id in ended { touches[id] = nil; screens[id] = nil }
        if pinch != nil {
            pinch = nil
            pinching = false
            if zoom < 1.05 { zoom = 1; pan = .zero }
            if let pending = pendingSize {
                pendingSize = nil
                setViewSize(pending.size, scale: pending.scale)
            }
        }
        if touches.isEmpty {
            start = nil
            grabbed = nil
            panning = nil
            // The guides go away with the fingers.
            if snapped.any { snapped = Snapped() }
            redraw()
        } else {
            // A finger lifted: carry on with what is left, which, zoomed in
            // with nothing held, is moving the view.
            panning = nil
            if zoom > 1 && model.selectedLayerId == nil, let screen = screens.values.first { panning = (screen, pan) }
            beginGesture()
        }
    }
}

/// CADisplayLink holds its target strongly; this keeps the engine free.
private final class DisplayLinkProxy: NSObject {
    weak var engine: EditorEngine?
    init(_ engine: EditorEngine) { self.engine = engine }
    @objc func tick() {
        MainActor.assumeIsolated { engine?.tick() }
    }
}
