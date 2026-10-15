import Foundation
import Testing
@testable import NowPlaying

/// Ported from js/model.test.mjs.
@Test func keyframesBehaveLikeTheWebVersion() {
    var radius: Prop? = 0

    // Unkeyed, a slider just sets the value.
    setValue(&radius, at: 3, 10)
    #expect(radius == .value(10))

    // The first diamond starts keying, holding the value as it is.
    toggleKey(&radius, at: 0, fallback: 0)
    #expect(radius?.isKeyed == true)
    #expect(radius?.at(0) == 10)

    // Moving the slider elsewhere on the timeline records a keyframe there.
    setValue(&radius, at: 4, 50)
    #expect(radius?.frames.count == 2)
    #expect(radius?.at(4) == 50)
    let middle = radius!.at(2)
    #expect(middle > 10 && middle < 50, "eases between the two")

    // At a keyframe's moment, the slider edits that keyframe.
    setValue(&radius, at: 4.02, 40)
    #expect(radius?.frames.count == 2)
    #expect(radius?.at(4) == 40)

    // Keyframes stay in time order whichever order they are made in.
    setValue(&radius, at: 1, 20)
    #expect(radius?.frames.map(\.t) == [0, 1, 4])

    // The diamond on a keyframe removes it; removing the last leaves a value.
    toggleKey(&radius, at: 1, fallback: 0)
    #expect(keyIndex(radius, at: 1) == nil)
    toggleKey(&radius, at: 4, fallback: 0)
    toggleKey(&radius, at: 0, fallback: 0)
    #expect(radius == .value(10))
}

@Test func projectsRoundTripThroughJSON() throws {
    for template in TemplateID.allCases {
        var project = Project(template: template)
        project.layers[1].props.x = .keyframes([Keyframe(t: 0, value: 0.2, ease: .inOut), Keyframe(t: 3, value: 0.8, ease: .inOut)])
        let data = try JSONEncoder().encode(project)
        let back = try JSONDecoder().decode(Project.self, from: data)
        #expect(back == project, "\(template) survives a save")
        // The same shape as the web drafts: a plain number or { keyframes }.
        let json = String(data: data, encoding: .utf8)!
        #expect(json.contains("\"keyframes\""))
    }
}

@Test func recordTurnsAWholeNumberOfTimes() {
    #expect(turnsPerLoop(30, 8) == 4)
    #expect(turnsPerLoop(1, 6) == 1)
    #expect(abs(actualRpm(33, 8) - 30) < 1e-9)
    #expect(formatTime(72.9) == "1:12")
    #expect(formatTime(-3) == "0:00")
}

@Test func paletteHelpers() {
    #expect(RGB(hex: "#ff8000") == RGB(255, 128, 0))
    #expect(RGB(255, 128, 0).hex == "#ff8000")
    #expect(dedupeHex(["#101010", "#121212", "#ffffff"]) == ["#101010", "#ffffff"])
    // A room colour is never brighter than asked, and never pure black.
    let room = RGB(hex: asRoomColour("#ffcc00"))
    #expect(room.luminance <= 0.1)
    #expect(RGB(hex: asRoomColour("#000000")) == RGB(20, 19, 18))
    // Pushed far enough to read.
    let behind = RGB(128, 128, 128)
    #expect(contrast(RGB(hex: legibleOn("#999999", behind, 4.5)), behind) >= 4.5)
}

@Test func bitrateComesDownForLongLoops() {
    #expect(VideoExport.bitrate(for: 8) == 12_000_000)
    #expect(VideoExport.bitrate(for: 90) < 2_000_000 * 2)
    #expect(VideoExport.bitrate(for: 600) == 2_500_000)
}
