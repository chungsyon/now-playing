import Foundation

/*
 TOUCH GEOMETRY
 --------------
 Everything a gesture needs to know, with no touches in it: where a layer
 sits, what a point is grabbing, how a group moves about its middle, and the
 snapping that does the last little bit of every gesture for you.

 Positions are fractions of the slide (0...1), so a gesture on the small
 preview means exactly the same thing at full export size.
*/

struct StageSize: Hashable {
    var width: Double
    var height: Double
}

struct Bounds: Hashable {
    var cx: Double
    var cy: Double
    var w: Double
    var h: Double
    var rotation: Double
}

// MARK: - Snapping

/// Within this fraction of the slide, a position is taken as lined up.
let snapReach = 0.014
/// Angles worth landing on, and how near you have to get, in degrees.
let snapAngle = 15.0
let snapAngleReach = 4.0

/// How far to move `value` to sit on the nearest target, or 0 for none.
func pullTo(_ value: Double, _ targets: [Double], _ reach: Double) -> Double {
    var shift = 0.0
    var nearest = reach
    for target in targets {
        let gap = abs(target - value)
        if gap < nearest { nearest = gap; shift = target - value }
    }
    return shift
}

/// The nearest clean angle, or the angle itself when none is near enough.
func pullAngle(_ degrees: Double) -> Double {
    let nearest = (degrees / snapAngle).rounded() * snapAngle
    return abs(nearest - degrees) <= snapAngleReach ? nearest : degrees
}

// MARK: - Corner handles

/// How big a corner dot is drawn, in stage pixels.
func handleRadius(_ stage: StageSize) -> Double { max(5, stage.width * 0.013) }
private func grabReach(_ stage: StageSize) -> Double { max(20, stage.width * 0.038) }
private func turnReach(_ stage: StageSize) -> Double { max(24, stage.width * 0.05) }

enum Handle { case scale, rotate }

/// What this point is grabbing on the selected layer: its corner dot, the
/// space just outside one, or nothing.
func handleAt(_ layer: Layer?, _ project: Project, _ stage: StageSize, _ x: Double, _ y: Double, _ t: Double = 0) -> Handle? {
    guard let layer, !layer.locked, layer.visible else { return nil }
    let b = selectionBounds(layer, project, stage, t)
    let angle = -b.rotation * .pi / 180
    let dx = x - b.cx, dy = y - b.cy
    let localX = dx * cos(angle) - dy * sin(angle)
    let localY = dx * sin(angle) + dy * cos(angle)
    let halfW = b.w / 2, halfH = b.h / 2
    let outside = abs(localX) > halfW || abs(localY) > halfH
    // The nearest corner decides: on a short box two can both be in reach.
    let away = [(-1.0, -1.0), (1, -1), (1, 1), (-1, 1)]
        .map { hypot(localX - $0.0 * halfW, localY - $0.1 * halfH) }.min() ?? .infinity
    if away <= grabReach(stage) { return .scale }
    // Turning lives outside the box only, so the inside stays a plain drag.
    if outside && away <= grabReach(stage) + turnReach(stage) { return .rotate }
    return nil
}

// MARK: - Moving a group

struct Member: Hashable {
    var id: String
    var x: Double
    var y: Double
    var scale: Double
    var rotation: Double
}

/// Where everything stands at the moment a gesture begins.
struct GestureStart {
    enum Mode { case one, two, scale, rotate, stretch }

    var layerID: String
    var members: [Member]
    var pivotX: Double
    var pivotY: Double
    var t: Double
    var lead: Member
    var xTargets: [Double]
    var yTargets: [Double]

    var mode: Mode = .one
    var midX = 0.0, midY = 0.0
    var distance = 0.0, angle = 0.0
    var grabRadius = 0.0, grabAngle = 0.0
}

func gestureStart(_ project: Project, _ layer: Layer, t: Double) -> GestureStart {
    let members = project.movesWith(layer).map {
        Member(id: $0.id, x: $0.props.x.at(t), y: $0.props.y.at(t),
               scale: $0.props.scale.at(t), rotation: $0.props.rotation.at(t))
    }
    // A pinch or a twist turns the whole arrangement about its middle.
    let n = Double(max(1, members.count))
    let pivotX = members.reduce(0) { $0 + $1.x } / n
    let pivotY = members.reduce(0) { $0 + $1.y } / n
    // Guides: the middle of the slide, and the middle of anything standing still.
    let ids = Set(members.map(\.id))
    let others = project.layers.filter { $0.visible && $0.type != .photo && !ids.contains($0.id) }
    return GestureStart(
        layerID: layer.id, members: members, pivotX: pivotX, pivotY: pivotY, t: t,
        lead: members.first { $0.id == layer.id } ?? members[0],
        xTargets: [0.5] + others.map { $0.props.x.at(t) },
        yTargets: [0.5] + others.map { $0.props.y.at(t) }
    )
}

/**
 Put every member of a gesture where that gesture says it goes.

 Turning and resizing happen about the pivot in slide PIXELS, not fractions:
 a slide is taller than it is wide, so a circle drawn in fractions would come
 out an ellipse. `k` resizes, `turn` is degrees, `dx` and `dy` shift, all
 measured from where the gesture started, so a long drag never drifts.
 Values are written at `start.t`: plain stays plain, keyed gets a keyframe.
 */
func placeMembers(_ project: inout Project, _ start: GestureStart, _ stage: StageSize,
                  _ k: Double, _ turn: Double, _ dx: Double, _ dy: Double) {
    let t = start.t
    // If anything in the group is keyframed, the rest are given keyframes at
    // the same moments, holding still, so the group never comes apart.
    for key in [NumKey.x, .y, .scale, .rotation] {
        var times = Set<Double>()
        for m in start.members {
            if let prop = project[.layer(m.id, key)], prop.isKeyed { times.formUnion(prop.frames.map(\.t)) }
        }
        if times.isEmpty { continue }
        for m in start.members {
            guard let prop = project[.layer(m.id, key)], !prop.isKeyed else { continue }
            let still = prop.at(t)
            project[.layer(m.id, key)] = .keyframes(times.sorted().map { Keyframe(t: $0, value: still, ease: .inOut) })
        }
    }
    let radians = turn * .pi / 180
    let c = cos(radians), s = sin(radians)
    let px = start.pivotX * stage.width
    let py = start.pivotY * stage.height
    for m in start.members {
        let ox = m.x * stage.width - px
        let oy = m.y * stage.height - py
        set(&project, .layer(m.id, .x), t, (px + (ox * c - oy * s) * k) / stage.width + dx)
        set(&project, .layer(m.id, .y), t, (py + (ox * s + oy * c) * k) / stage.height + dy)
        set(&project, .layer(m.id, .scale), t, max(0.02, m.scale * k))
        set(&project, .layer(m.id, .rotation), t, m.rotation + turn)
    }
}

private func set(_ project: inout Project, _ path: PropPath, _ t: Double, _ value: Double) {
    var prop = project[path]
    setValue(&prop, at: t, value)
    project[path] = prop
}

// MARK: - Where things are

private func boundText(_ layer: Layer, _ project: Project) -> String {
    switch layer.props.bind {
    case .title: return project.song.title
    case .artist: return project.song.artist
    case .album: return project.song.album
    case nil: return layer.props.text ?? ""
    }
}

/// Roughly where a layer sits, in slide pixels. Good enough to tap.
func layerBounds(_ layer: Layer, _ project: Project, _ stage: StageSize, _ t: Double = 0) -> Bounds {
    let p = layer.props
    let scale = p.scale.at(t)
    let cx = p.x.at(t) * stage.width
    let cy = p.y.at(t) * stage.height
    let rotation = p.rotation.at(t)
    var w: Double, h: Double
    // Text set from one end sits to one side of its point, and a bar's times
    // hang below it, so the box is not always centred on x, y.
    var shift = 0.0, drop = 0.0

    switch layer.type {
    case .photo:
        return Bounds(cx: stage.width / 2, cy: stage.height / 2, w: stage.width, h: stage.height, rotation: 0)
    case .disc, .cover:
        w = stage.width * scale; h = w
    case .text:
        let size = stage.width * (p.size ?? 0.05) * scale
        let text = boundText(layer, project)
        let chars = Double(max(4, (text.isEmpty ? "Untitled" : text).count))
        w = chars * size * (0.55 + (p.tracking ?? 0))
        if let maxWidth = p.maxWidth { w = min(w, stage.width * maxWidth * scale) }
        h = size * 1.6
        shift = p.align == .left ? w / 2 : p.align == .right ? -w / 2 : 0
    case .progressBar:
        // Just the bar, its knob and the times under it, as the renderer draws them.
        w = stage.width * scale
        let pill = p.style == "pill"
        let thickness = pill ? w * 0.032 : max(2, w * 0.0075)
        let knob = pill ? thickness * 0.85 : thickness * 1.9
        let timeSize = w * (p.font != nil ? 0.045 : 0.036)
        let timesAt = pill ? thickness / 2 + timeSize * 1.3 : timeSize * 1.9
        let pad = stage.width * 0.012
        let top = -knob - pad
        let bottom = ((p.showTimes ?? false) ? timesAt + timeSize * 0.6 : knob) + pad
        h = bottom - top
        drop = (top + bottom) / 2
    case .controls:
        w = stage.width * scale; h = stage.width * scale * 0.42
    case .card, .window, .artPanel:
        w = stage.width * scale
        let fallback = layer.type == .card ? 1.2 : layer.type == .window ? 1.6 : 0.5
        let ratio = p.ratio?.at(t) ?? fallback
        h = w * (ratio == 0 ? fallback : ratio)
    }
    let a = rotation * .pi / 180
    return Bounds(cx: cx + shift * cos(a) - drop * sin(a), cy: cy + shift * sin(a) + drop * cos(a),
                  w: w, h: h, rotation: rotation)
}

/// The box that is selected when this layer is. Moving together, that is the
/// whole group, upright; on its own it is the layer's own box.
func selectionBounds(_ layer: Layer, _ project: Project, _ stage: StageSize, _ t: Double = 0) -> Bounds {
    let members = project.movesWith(layer)
    if members.count < 2 { return layerBounds(layer, project, stage, t) }
    var left = Double.infinity, top = Double.infinity, right = -Double.infinity, bottom = -Double.infinity
    for member in members {
        let b = layerBounds(member, project, stage, t)
        let a = b.rotation * .pi / 180
        let rx = (abs(b.w * cos(a)) + abs(b.h * sin(a))) / 2
        let ry = (abs(b.w * sin(a)) + abs(b.h * cos(a))) / 2
        left = min(left, b.cx - rx); right = max(right, b.cx + rx)
        top = min(top, b.cy - ry); bottom = max(bottom, b.cy + ry)
    }
    return Bounds(cx: (left + right) / 2, cy: (top + bottom) / 2, w: right - left, h: bottom - top, rotation: 0)
}

/// Inside a box, with a little slack so small text is still easy to hit.
func inside(_ b: Bounds, _ x: Double, _ y: Double) -> Bool {
    let angle = -b.rotation * .pi / 180
    let dx = x - b.cx, dy = y - b.cy
    let localX = dx * cos(angle) - dy * sin(angle)
    let localY = dx * sin(angle) + dy * cos(angle)
    return abs(localX) <= max(b.w / 2, 22) && abs(localY) <= max(b.h / 2, 22)
}

/// The topmost layer under this point that can actually be picked up.
func layerAt(_ project: Project, _ stage: StageSize, _ x: Double, _ y: Double, _ t: Double = 0) -> Layer? {
    for layer in project.layers.reversed() {
        if !layer.visible || layer.locked { continue }
        if layer.type == .cover && !project.showCover { continue }
        if inside(layerBounds(layer, project, stage, t), x, y) { return layer }
    }
    return nil
}

// MARK: - Fitting a layout to a slide

/**
 Fit the furniture, as one piece, inside the slide. Positions are fractions of
 each side but sizes are fractions of the width, so a layout made for an
 upright slide does not survive being stretched onto a wide one. This lays it
 out on the slide it was made for, shrinks it there until it fits the real
 slide with a margin, and centres it. A slide it already fits is left alone.
 */
func fitToSlide(_ project: inout Project, madeFor: LayoutSize? = nil) {
    let W = Double(project.aspect.w), H = Double(project.aspect.h)
    let furniture = project.layers.filter { $0.type != .photo }
    if furniture.isEmpty { return }

    func edges(_ stage: StageSize) -> (l: Double, r: Double, t: Double, b: Double) {
        var box = (l: Double.infinity, r: -Double.infinity, t: Double.infinity, b: -Double.infinity)
        for layer in furniture {
            let b = layerBounds(layer, project, stage)
            box.l = min(box.l, b.cx - b.w / 2); box.r = max(box.r, b.cx + b.w / 2)
            box.t = min(box.t, b.cy - b.h / 2); box.b = max(box.b, b.cy + b.h / 2)
        }
        return box
    }

    let now = edges(StageSize(width: W, height: H))
    if now.l >= 0 && now.t >= 0 && now.r <= W && now.b <= H { return }

    let from = madeFor ?? project.layoutAspect
    let ratio = from.map { Double($0.h) / Double($0.w) } ?? 1350.0 / 1080
    let source = StageSize(width: W, height: W * ratio)
    let box = edges(source)
    let margin = 0.06
    let k = min(1, W * (1 - margin * 2) / (box.r - box.l), H * (1 - margin * 2) / (box.b - box.t))
    let midX = (box.l + box.r) / 2, midY = (box.t + box.b) / 2

    // Keyframed values move keyframe by keyframe, so an animated style keeps
    // animating on a slide of another shape.
    func remap(_ prop: Prop, _ fn: (Double) -> Double) -> Prop {
        switch prop {
        case .value(let v): return .value(fn(v))
        case .keyframes(let frames): return .keyframes(frames.map { var f = $0; f.value = fn(f.value); return f })
        }
    }
    for i in project.layers.indices where project.layers[i].type != .photo {
        project.layers[i].props.x = remap(project.layers[i].props.x) { (W / 2 + ($0 * source.width - midX) * k) / W }
        project.layers[i].props.y = remap(project.layers[i].props.y) { (H / 2 + ($0 * source.height - midY) * k) / H }
        project.layers[i].props.scale = remap(project.layers[i].props.scale) { $0 * k }
    }
    project.layoutAspect = LayoutSize(w: project.aspect.w, h: project.aspect.h)
}

/// Put a glass card behind the furniture, with room round it, or take it
/// away. It goes straight above the photo, where the glass expects to be.
func setCard(_ project: inout Project, on: Bool) {
    project.layers.removeAll { $0.type == .card }
    guard on else { return }
    let stage = StageSize(width: Double(project.aspect.w), height: Double(project.aspect.h))
    let furniture = project.layers.filter { $0.type != .photo && $0.visible }
    if furniture.isEmpty { return }

    func around(_ t: Double) -> (x: Double, y: Double, scale: Double, ratio: Double) {
        var l = Double.infinity, r = -Double.infinity, top = Double.infinity, bottom = -Double.infinity
        for layer in furniture {
            let b = layerBounds(layer, project, stage, t)
            let reach = max(b.w, b.h) / 2
            let halfW = b.rotation != 0 ? reach : b.w / 2
            let halfH = b.rotation != 0 ? reach : b.h / 2
            l = min(l, b.cx - halfW); r = max(r, b.cx + halfW)
            top = min(top, b.cy - halfH); bottom = max(bottom, b.cy + halfH)
        }
        let pad = stage.width * 0.06
        let w = r - l + pad * 2
        return ((l + r) / 2 / stage.width, (top + bottom) / 2 / stage.height, w / stage.width, (bottom - top + pad * 2) / w)
    }

    // Animated furniture: the card is worked out at each keyframe and keyed
    // to match, so it travels with what it holds.
    var times = Set<Double>()
    for layer in furniture {
        for key in [NumKey.x, .y, .scale] {
            if let prop = layer.props[key: key], prop.isKeyed { times.formUnion(prop.frames.map(\.t)) }
        }
    }
    let sorted = times.sorted()
    let first = around(sorted.first ?? 0)
    var card = makeLayer(.card, "Card") {
        $0.x = .value(first.x); $0.y = .value(first.y); $0.scale = .value(first.scale)
        $0.ratio = .value(first.ratio); $0.radius = 0.075; $0.blur = 12
    }
    if !sorted.isEmpty {
        let at = sorted.map(around)
        card.props.x = .keyframes(zip(sorted, at).map { Keyframe(t: $0, value: $1.x, ease: .inOut) })
        card.props.y = .keyframes(zip(sorted, at).map { Keyframe(t: $0, value: $1.y, ease: .inOut) })
        card.props.scale = .keyframes(zip(sorted, at).map { Keyframe(t: $0, value: $1.scale, ease: .inOut) })
    }
    let index = (project.photoIndex ?? -1) + 1
    project.layers.insert(card, at: index)
}
