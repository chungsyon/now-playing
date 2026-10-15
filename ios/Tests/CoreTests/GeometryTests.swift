import Foundation
import Testing
@testable import NowPlaying

/// Ported from js/gestures.test.mjs.
private func near(_ a: Double, _ b: Double, _ slack: Double = 1e-9, _ note: String = "") {
    #expect(abs(a - b) <= slack, "\(a) != \(b) \(note)")
}

private func layer(_ p: Project, _ type: LayerType) -> Layer { p.layers.first { $0.type == type }! }

@Test func snapping() {
    near(pullTo(0.508, [0.5], 0.014), -0.008)
    near(pullTo(0.540, [0.5], 0.014), 0)
    near(pullTo(0.26, [0.5, 0.25], 0.014), -0.01)
    #expect(pullAngle(14) == 15)
    #expect(pullAngle(-31) == -30)
    #expect(pullAngle(22) == 22)
    #expect(pullAngle(0.5) == 0)
}

@Test func movingAGroup() {
    var project = Project()
    let stage = StageSize(width: 540, height: 675)
    let cover = layer(project, .cover)
    var start = gestureStart(project, cover, t: 0)
    #expect(start.members.count == 4, "the photo stays out of the group")
    let members = start.members
    func props(_ m: Member) -> LayerProps { project.layer(m.id)!.props }

    // A plain drag shifts everything by the same amount.
    placeMembers(&project, start, stage, 1, 0, 0.1, -0.05)
    for m in members {
        near(props(m).x.at(0), m.x + 0.1)
        near(props(m).y.at(0), m.y - 0.05)
        near(props(m).scale.at(0), m.scale)
        near(props(m).rotation.at(0), m.rotation)
    }

    // A turn is about the pivot, so the pivot itself does not move...
    placeMembers(&project, start, stage, 1, 90, 0, 0)
    let n = Double(members.count)
    near(members.reduce(0) { $0 + props($1).x.at(0) } / n, start.pivotX)
    near(members.reduce(0) { $0 + props($1).y.at(0) } / n, start.pivotY)

    // ...and the gaps keep their length, measured in pixels.
    let gapBefore = hypot((members[0].x - members[1].x) * stage.width, (members[0].y - members[1].y) * stage.height)
    let gapAfter = hypot((props(members[0]).x.at(0) - props(members[1]).x.at(0)) * stage.width,
                         (props(members[0]).y.at(0) - props(members[1]).y.at(0)) * stage.height)
    near(gapAfter, gapBefore)

    // Resizing pulls members toward the pivot by the same factor.
    placeMembers(&project, start, stage, 0.5, 0, 0, 0)
    let shrunk = hypot((props(members[0]).x.at(0) - props(members[1]).x.at(0)) * stage.width,
                       (props(members[0]).y.at(0) - props(members[1]).y.at(0)) * stage.height)
    near(shrunk, gapBefore * 0.5)
    near(props(members[0]).scale.at(0), members[0].scale * 0.5)

    // Every call measures from the start, so repeating one is not cumulative.
    placeMembers(&project, start, stage, 0.5, 0, 0, 0)
    near(props(members[0]).scale.at(0), members[0].scale * 0.5)

    // Grouping off leaves one layer on its own.
    project.grouped = false
    start = gestureStart(project, cover, t: 0)
    #expect(start.members.count == 1)
}

@Test func cornerHandles() {
    var p = Project(template: .vinyl)
    p.grouped = false
    let st = StageSize(width: 1080, height: 1350)
    var sleeve = layer(p, .cover)
    let b = layerBounds(sleeve, p, st)
    let corner = (x: b.cx + b.w / 2, y: b.cy + b.h / 2)
    func out(_ d: Double) -> Handle? { handleAt(sleeve, p, st, corner.x + d, corner.y + d) }

    #expect(handleAt(sleeve, p, st, corner.x, corner.y) == .scale, "on the dot")
    #expect(out(20) == .scale, "near enough to the dot")
    #expect(out(45) == .rotate, "just outside it")
    #expect(out(200) == nil, "well clear of it")
    #expect(handleAt(sleeve, p, st, b.cx, b.cy) == nil, "the middle is a plain drag")
    #expect(handleAt(sleeve, p, st, b.cx, b.cy + b.h / 2 - 5) == nil, "inside the edge")

    // A turned layer carries its corners round with it.
    var wide = Project(template: .player)
    wide.grouped = false
    let barIndex = wide.layers.firstIndex { $0.type == .progressBar }!
    let flat = layerBounds(wide.layers[barIndex], wide, st)
    let wasCorner = (x: flat.cx + flat.w / 2, y: flat.cy + flat.h / 2)
    #expect(handleAt(wide.layers[barIndex], wide, st, wasCorner.x, wasCorner.y) == .scale, "corner, flat")
    wide.layers[barIndex].props.rotation = 90
    let turned = layerBounds(wide.layers[barIndex], wide, st)
    let nowCorner = (x: turned.cx - turned.h / 2, y: turned.cy + turned.w / 2)
    #expect(handleAt(wide.layers[barIndex], wide, st, nowCorner.x, nowCorner.y) == .scale, "corner, turned")
    #expect(handleAt(wide.layers[barIndex], wide, st, wasCorner.x, wasCorner.y) == nil, "where it used to be")

    // A locked layer has no handles.
    sleeve.locked = true
    #expect(handleAt(sleeve, p, st, corner.x, corner.y) == nil, "locked")
    #expect(handleAt(nil, p, st, corner.x, corner.y) == nil, "nothing selected")
}

@Test func groupSelectionBox() {
    var p = Project(template: .window)
    let st = StageSize(width: 1080, height: 1350)
    let pane = layer(p, .window)
    let title = layer(p, .text)
    let group = selectionBounds(pane, p, st)
    #expect(selectionBounds(title, p, st) == group, "same box from any member")
    let own = layerBounds(pane, p, st)
    #expect(group.h > own.h, "bigger than the window alone")
    #expect(handleAt(title, p, st, group.cx + group.w / 2, group.cy + group.h / 2) == .scale, "group corner")
    p.grouped = false
    #expect(selectionBounds(pane, p, st) == own, "on its own, its own box")
}

@Test func fittingToALandscapeSlide() {
    for template in [TemplateID.vinyl, .player] {
        var wide = Project(aspect: Aspect(id: "photo", w: 1080, h: 600), template: template)
        fitToSlide(&wide)
        let slide = StageSize(width: 1080, height: 600)
        for l in wide.layers where l.type != .photo {
            let b = layerBounds(l, wide, slide)
            #expect(b.cy - b.h / 2 >= -1e-9 && b.cy + b.h / 2 <= 600 + 1e-9, "\(template) \(l.name) spills")
            #expect(b.cx - b.w / 2 >= -1e-9 && b.cx + b.w / 2 <= 1080 + 1e-9, "\(template) \(l.name) spills sideways")
        }
        let sleeve = layerBounds(layer(wide, .cover), wide, slide)
        let title = layerBounds(wide.layers.first { $0.name == "Title" }!, wide, slide)
        #expect(title.cy > sleeve.cy + sleeve.h / 2, "\(template) title sits on the sleeve")
        // An upright slide already fits, so it is left exactly as made.
        let tall = Project(template: template)
        var copy = tall
        fitToSlide(&copy)
        #expect(copy.layers == tall.layers)
    }
}

@Test func keyframesAndGroups() {
    // One member keyed, the rest plain: a drag at t=4 moves the group only at 4.
    var p = Project()
    let cover = layer(p, .cover)
    let group = p.movesWith(cover)
    p[.layer(cover.id, .x)] = .keyframes([Keyframe(t: 0, value: 0.36, ease: nil)])
    let rest = group.filter { $0.id != cover.id }
    let start = GestureStart(
        layerID: cover.id,
        members: p.movesWith(p.layer(cover.id)).map {
            Member(id: $0.id, x: $0.props.x.at(4), y: $0.props.y.at(4), scale: $0.props.scale.at(4), rotation: $0.props.rotation.at(4))
        },
        pivotX: 0.5, pivotY: 0.5, t: 4,
        lead: Member(id: cover.id, x: 0.36, y: 0.64, scale: 0.44, rotation: 0),
        xTargets: [], yTargets: []
    )
    let before = rest.map { $0.props.x.at(0) }
    placeMembers(&p, start, StageSize(width: 1080, height: 1350), 1, 0, 0.1, 0)
    for (i, l) in rest.enumerated() {
        let x = p.layer(l.id)!.props.x
        #expect(x.isKeyed, "\(l.name) was given keyframes")
        near(x.at(0), before[i])
        near(x.at(4), before[i] + 0.1)
    }

    // A keyed style fitted onto a wide slide keeps its keyframes.
    var wide = Project(aspect: Aspect(id: "x", w: 1080, h: 600))
    let i = wide.layers.firstIndex { $0.type == .cover }!
    wide.layers[i].props.y = .keyframes([Keyframe(t: 0, value: 0.5, ease: nil), Keyframe(t: 2, value: 0.7, ease: nil)])
    fitToSlide(&wide, madeFor: LayoutSize(w: 1080, h: 1350))
    #expect(wide.layers[i].props.y.frames.count == 2, "keyframes survive a fit")

    // A card added to an animated group is keyed to travel with it.
    var q = Project()
    for l in q.movesWith(layer(q, .cover)) {
        let y = l.props.y.at(0)
        q[.layer(l.id, .y)] = .keyframes([Keyframe(t: 0, value: y, ease: nil), Keyframe(t: 4, value: y - 0.2, ease: nil)])
    }
    setCard(&q, on: true)
    let card = layer(q, .card)
    #expect(card.props.y.isKeyed, "the card is keyed")
    near(card.props.y.at(0) - card.props.y.at(4), 0.2, 1e-6)
    #expect(q.layers[1].type == .card, "straight above the photo")
}
