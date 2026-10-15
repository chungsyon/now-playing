import AVFoundation
import CoreGraphics
import Foundation
import Testing
@testable import NowPlaying

/*
 Renders every template with a made-up photo and cover. Set NP_RENDER_DIR to a
 folder to keep the frames as PNGs and look at them.
*/

private let fonts = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .appendingPathComponent("NowPlaying/Resources/Fonts")

/// A landscape-ish photo: a sky, a sun and a dark horizon, so light and dark
/// backdrops both get tested.
private func samplePhoto(_ w: Int = 1200, _ h: Int = 1500) -> CGImage {
    let c = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: sRGB,
                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    let sky = CGGradient(colorsSpace: sRGB, colors: [cgColor("#2b4d7e"), cgColor("#f2b880"), cgColor("#f7e3c4")] as CFArray,
                         locations: [0, 0.6, 1])!
    c.drawLinearGradient(sky, start: CGPoint(x: 0, y: h), end: CGPoint(x: 0, y: h / 3), options: [])
    c.setFillColor(cgColor("#fff4d6"))
    c.fillEllipse(in: CGRect(x: w / 2 - 120, y: h / 2, width: 240, height: 240))
    c.setFillColor(cgColor("#1d2a24"))
    c.fill(CGRect(x: 0, y: 0, width: w, height: h / 3))
    for i in 0..<14 {
        c.setFillColor(cgColor(i % 2 == 0 ? "#30473a" : "#0f1712"))
        c.fill(CGRect(x: i * w / 14, y: 0, width: w / 20, height: h / 3 + (i * 37 % 140)))
    }
    return c.makeImage()!
}

private func sampleCover(_ size: Int = 600) -> CGImage {
    let c = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: sRGB,
                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    c.setFillColor(cgColor("#c2412d"))
    c.fill(CGRect(x: 0, y: 0, width: size, height: size))
    c.setFillColor(cgColor("#f1d6a0"))
    c.fillEllipse(in: CGRect(x: size / 5, y: size / 5, width: size * 3 / 5, height: size * 3 / 5))
    c.setFillColor(cgColor("#1c1a3a"))
    c.fill(CGRect(x: 0, y: 0, width: size, height: size / 6))
    return c.makeImage()!
}

private func sampleProject(_ template: TemplateID, aspect: Aspect = namedAspects[1]) -> (Project, Media) {
    SlideFonts.directory = fonts
    let media = Media(photo: samplePhoto(), cover: sampleCover())
    var project = Project(aspect: aspect, template: template)
    project.song = Song(id: "it1", source: "itunes", title: "Through the Night", artist: "IU", album: "Palette",
                        year: "2017", durationMs: 254_000, version: "Original", clipStartSeconds: 72)
    project.palette = dedupeHex(extractPalette(media.cover!) + extractPalette(media.photo!))
    fitToSlide(&project)
    return (project, media)
}

private func save(_ image: CGImage, _ name: String) {
    guard let dir = ProcessInfo.processInfo.environment["NP_RENDER_DIR"] else { return }
    try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    try? ImageLoading.png(image)?.write(to: URL(fileURLWithPath: dir).appendingPathComponent(name + ".png"))
}

private func pixels(_ stage: Stage) -> [UInt8] {
    let ctx = stage.ctx
    return [UInt8](UnsafeBufferPointer(start: ctx.data!.assumingMemoryBound(to: UInt8.self), count: ctx.bytesPerRow * ctx.height))
}

@Test(arguments: TemplateID.allCases)
func everyTemplateDraws(_ template: TemplateID) throws {
    let (project, media) = sampleProject(template)
    let stage = Stage(width: project.aspect.w, height: project.aspect.h, media: media)
    renderSlide(stage, project, 1.3)
    let image = try #require(stage.image())
    save(image, "template-\(template.rawValue)")
    #expect(image.width == 1080 && image.height == 1350)

    // The top left of the slide is the photo's sky, not its ground: the
    // picture is the right way up.
    let top = stage.averageColour(x0: 20, y0: 20, x1: 120, y1: 60)
    let bottom = stage.averageColour(x0: 20, y0: 1290, x1: 120, y1: 1330)
    if template != .player { #expect(top.luminance > bottom.luminance, "upright") }
}

@Test func otherShapesDraw() throws {
    for aspect in [namedAspects[0], namedAspects[2], Aspect(id: "photo", w: 1080, h: 720)] {
        for template in [TemplateID.player, .bookmark] {
            let (project, media) = sampleProject(template, aspect: aspect)
            let stage = Stage(width: aspect.w, height: aspect.h, media: media)
            renderSlide(stage, project, 0)
            save(try #require(stage.image()), "shape-\(aspect.w)x\(aspect.h)-\(template.rawValue)")
        }
    }
}

@Test func previewMatchesFileAtAnotherSize() throws {
    // The preview draws the same slide smaller; the furniture lands in the
    // same place, so a small render scaled up is close to the big one.
    let (project, media) = sampleProject(.vinyl)
    let small = Stage(width: 360, height: 450, media: media)
    renderSlide(small, project, 2)
    save(try #require(small.image()), "preview-vinyl-360")
}

@Test func theLoopCloses() {
    for template in [TemplateID.vinyl, .player] {
        let (project, media) = sampleProject(template)
        let a = Stage(width: 270, height: 338, media: media)
        let b = Stage(width: 270, height: 338, media: media)
        renderSlide(a, project, 0)
        renderSlide(b, project, project.loopSeconds)
        // The record has turned a whole number of times and the bar has
        // dissolved back to its start: the last frame is the first.
        let pa = pixels(a), pb = pixels(b)
        var differ = 0
        for i in stride(from: 0, to: pa.count, by: 4) where abs(Int(pa[i]) - Int(pb[i])) > 3 { differ += 1 }
        #expect(differ < pa.count / 4 / 500, "\(template): \(differ) pixels differ")
    }
}

@Test func opacityZeroLeavesOnlyThePhoto() {
    let (project, media) = sampleProject(.player)
    var faded = project
    faded.overlayOpacity = .keyframes([Keyframe(t: 0, value: 1), Keyframe(t: 1, value: 0)])
    var bare = project
    for i in bare.layers.indices where bare.layers[i].type != .photo { bare.layers[i].visible = false }
    let a = Stage(width: 270, height: 338, media: media)
    let b = Stage(width: 270, height: 338, media: media)
    renderSlide(a, faded, 1)
    renderSlide(b, bare, 1)
    #expect(pixels(a) == pixels(b))
}

@Test func exportIsSilentH264() async throws {
    var (project, media) = sampleProject(.player)
    project.loopSeconds = 2
    var last = 0.0
    let result = try await VideoExport.render(project, media: media, name: "np-test-\(UUID().uuidString.prefix(6))") {
        last = $0
    }
    defer { try? FileManager.default.removeItem(at: result.url) }
    #expect(last == 1)
    #expect(result.frames == 60)
    #expect(result.bytes > 10_000)

    let asset = AVURLAsset(url: result.url)
    let video = try await asset.loadTracks(withMediaType: .video)
    let audio = try await asset.loadTracks(withMediaType: .audio)
    #expect(video.count == 1)
    #expect(audio.isEmpty, "never any audio")
    let size = try await video[0].load(.naturalSize)
    #expect(size == CGSize(width: 1080, height: 1350))
    let duration = try await asset.load(.duration)
    #expect(abs(duration.seconds - 2) < 0.05)
    if let dir = ProcessInfo.processInfo.environment["NP_RENDER_DIR"] {
        try? FileManager.default.copyItem(at: result.url, to: URL(fileURLWithPath: dir).appendingPathComponent("export.mp4"))
    }
}

@Test func renderSpeed() {
    // Dragging a layer at the preview's sharp (3x) and quick (2x) sizes.
    // A frame should leave room for thirty a second; this Mac is a rough guide.
    for template in TemplateID.allCases {
        var (project, media) = sampleProject(template)
        guard let moved = project.layers.first(where: { $0.type != .photo })?.id else { continue }
        var line = "\(template.rawValue):"
        for width in [1080, 720] {
            let stage = Stage(width: width, height: width * 5 / 4, media: media)
            renderSlide(stage, project, 0)
            let started = Date()
            for i in 0..<20 {
                project[.layer(moved, .x)] = .value(0.3 + Double(i) / 50)
                renderSlide(stage, project, 0)
            }
            line += String(format: " %dpx %.1f ms", width, Date().timeIntervalSince(started) / 20 * 1000)
        }
        print(line)
    }
}
