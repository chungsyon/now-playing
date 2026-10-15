import CoreGraphics
import CoreImage
import CoreText
import Foundation

/*
 THE RENDERER
 ------------
 One function draws a slide: `renderSlide(stage, project, t)`. The preview in the
 editor and the full-size export both call it, with nothing different but the
 size of the stage. If it looks right in the preview it is right in the file.

 How a frame is built:
   1. fill the stage with the room colour
   2. each visible layer is drawn straight onto the slide, or, when it has
      effects or is part-transparent, alone onto a scratch bitmap, run
      through its effects and then composited
   3. a layer that holds still and needs the scratch path is drawn once and
      kept, because a blurred photo is the same picture every frame

 Everything here is CoreGraphics, CoreText and CoreImage, so the same code runs
 on iPhone and in the Mac test harness.
*/

let roomHex = "#0E0D0C"

/// The decoded pictures a slide draws from.
struct Media {
    var photo: CGImage?
    var cover: CGImage?

    /// Changes whenever a different photo or cover has been handed over.
    var key: String {
        let a = photo.map { ObjectIdentifier($0).hashValue } ?? 0
        let b = cover.map { ObjectIdentifier($0).hashValue } ?? 0
        return "\(a)-\(b)"
    }
}

/// A bitmap whose user space runs like a web canvas: origin top left, y down.
/// Its memory is top row first, blue-green-red-alpha, premultiplied: the
/// layout a video frame wants, so export copies rows straight across.
func makeCanvas(_ width: Int, _ height: Int) -> CGContext {
    let info = CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
    let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                        space: sRGB, bitmapInfo: info)!
    ctx.translateBy(x: 0, y: CGFloat(height))
    ctx.scaleBy(x: 1, y: -1)
    ctx.interpolationQuality = .high
    return ctx
}

/// Draw an image the right way up into a y-down canvas.
func drawImage(_ c: CGContext, _ image: CGImage, _ rect: CGRect) {
    c.saveGState()
    c.translateBy(x: rect.minX, y: rect.maxY)
    c.scaleBy(x: 1, y: -1)
    c.draw(image, in: CGRect(origin: .zero, size: rect.size))
    c.restoreGState()
}

final class Stage {
    let width: Int
    let height: Int
    var media: Media
    let ctx: CGContext

    var W: Double { Double(width) }
    var H: Double { Double(height) }
    var full: CGRect { CGRect(x: 0, y: 0, width: width, height: height) }
    var size: StageSize { StageSize(width: W, height: H) }

    /// Shared by every stage. Colour management is off, so a blur mixes
    /// colours the way a browser's does.
    static let imaging = CIContext(options: [.workingColorSpace: NSNull(), .cacheIntermediates: false])

    // Made on demand.
    private var scratch: CGContext?
    var layerCtx: CGContext {
        if scratch == nil { scratch = makeCanvas(width, height) }
        return scratch!
    }

    // ponytail: one slot. Only a layer with effects is worth keeping, and in
    // every template that is the photo alone. Make it a dictionary keyed by
    // layer id if two effect-laden layers ever become a real arrangement.
    var kept: (key: KeptKey, image: CGImage)?
    var contrast: [ToneKey: Tones] = [:]

    // The glass card's backdrop and rim; see Glass.swift.
    var glassKey: GlassKey?
    var glassImage: CGImage?
    var glassPixels: [UInt8]?
    var glassGeneration = 0
    var frostCtx: CGContext?
    var jitterTable: [Int8]?
    var lens: Lens?
    var middlingKey: [Double]?
    var middlingValue = 0.0

    init(width: Int, height: Int, media: Media = Media()) {
        self.width = max(1, width)
        self.height = max(1, height)
        self.media = media
        self.ctx = makeCanvas(self.width, self.height)
    }

    /// The finished frame.
    func image() -> CGImage? { ctx.makeImage() }

    func beginLayer() -> CGContext {
        let c = layerCtx
        c.clear(full)
        return c
    }

    /// A real gaussian, on the GPU where there is one. `sigma` is in pixels.
    static func blurred(_ image: CGImage, _ sigma: Double) -> CGImage? {
        guard sigma >= 0.5 else { return image }
        let input = CIImage(cgImage: image)
        let output = input.clampedToExtent().applyingGaussianBlur(sigma: sigma).cropped(to: input.extent)
        return imaging.createCGImage(output, from: input.extent)
    }

    /**
     Whichever image holds the finished layer. Blur runs first; everything else
     runs after it, on the pixels. That is also the order that makes sense:
     film grain belongs on top of a blurred photo, not underneath it.
     */
    func applyEffects(_ chain: [Effect], _ t: Double) -> CGImage? {
        let c = layerCtx
        // Two blurs on one layer add up as the squares of their radii, as two
        // gaussians do. One blur is the case that actually happens.
        let radii = chain.filter { $0.type == .blur }.map { $0.value("radius", at: t) }
        if !radii.isEmpty {
            let sigma = sqrt(radii.reduce(0) { $0 + $1 * $1 }) * W / 1000
            if sigma >= 0.5, let source = c.makeImage(), let soft = Stage.blurred(source, sigma) {
                c.clear(full)
                drawImage(c, soft, full)
            }
        }
        for effect in chain where effect.type != .blur {
            guard let data = c.data?.assumingMemoryBound(to: UInt8.self) else { break }
            switch effect.type {
            case .grain:
                applyGrain(data, c.bytesPerRow, effect.value("amount", at: t), effect.value("size", at: t), t)
            case .vignette:
                applyVignette(data, c.bytesPerRow, effect.value("amount", at: t), effect.value("softness", at: t))
            case .blur:
                break
            }
        }
        return c.makeImage()
    }

    /// Film grain on a coarse grid, so it reads as film rather than screen
    /// noise. It changes 24 times a second, like real grain.
    private func applyGrain(_ data: UnsafeMutablePointer<UInt8>, _ bpr: Int, _ amount: Double, _ size: Double, _ t: Double) {
        let cell = max(size, 1)
        let frame = Int((t * 24).rounded(.down))
        for y in 0..<height {
            let cy = Int(Double(y) / cell)
            let row = data + y * bpr
            for x in 0..<width {
                let o = x * 4
                let a = Double(row[o + 3])
                if a == 0 { continue }
                let n = noise(Int(Double(x) / cell), cy, frame) - 0.5
                let d = n * amount * a
                for ch in 0..<3 {
                    row[o + ch] = UInt8(max(0, min(a, Double(row[o + ch]) + d)))
                }
            }
        }
    }

    /// Darkens toward the corners, measured in round units whatever the shape.
    private func applyVignette(_ data: UnsafeMutablePointer<UInt8>, _ bpr: Int, _ amount: Double, _ softness: Double) {
        let aspect = W / H
        let lo = 1 - softness
        for y in 0..<height {
            let dy = (Double(y) + 0.5) / H - 0.5
            let row = data + y * bpr
            for x in 0..<width {
                let dx = ((Double(x) + 0.5) / W - 0.5) * aspect
                let r = sqrt(dx * dx + dy * dy) * 1.41421356
                let u = max(0, min(1, (r - lo) / max(1e-6, 1 - lo)))
                let edge = 1 - amount * u * u * (3 - 2 * u)
                if edge >= 0.999 { continue }
                let o = x * 4
                for ch in 0..<4 { row[o + ch] = UInt8(Double(row[o + ch]) * edge) }
            }
        }
    }
}

/// A cheap, steady hash: the same cell at the same frame always gives the
/// same grain, so the file is identical every time it is made.
@inline(__always)
func noise(_ x: Int, _ y: Int, _ z: Int) -> Double {
    var h = UInt32(truncatingIfNeeded: x &* 374_761_393 &+ y &* 668_265_263 &+ z &* 1_442_695_041)
    h = (h ^ (h >> 13)) &* 1_274_126_177
    h ^= h >> 16
    return Double(h) / Double(UInt32.max)
}

// MARK: - Keys for what is kept

struct KeptKey: Hashable {
    var layer: Layer
    var width: Int
    var height: Int
    var media: String
    var palette: [String]
    var title: String
    var artist: String
    var album: String
}

struct ToneKey: Hashable {
    var id: String
    var x: Int, y: Int, scale: Int
    var width: Int
    var media: String
    var below: [Layer]
    var palette: [String]
    var moment: Int
}

/// True when this layer looks the same at every moment of the loop.
func holdsStill(_ layer: Layer) -> Bool {
    switch layer.type {
    // These draw a different picture at every moment.
    case .disc, .progressBar: return false
    // The glass shows the photo through it, which its own data knows nothing
    // about; the glass keeps its own expensive part instead.
    case .card, .window: return false
    default: break
    }
    if layer.props.hasKeyframes { return false }
    // Grain moves with time.
    return !layer.effects.contains { $0.isKeyed || $0.type == .grain }
}

// MARK: - render

/// Draw the slide at moment `t`, in seconds, onto the stage.
func renderSlide(_ stage: Stage, _ project: Project, _ t: Double) {
    let ctx = stage.ctx
    ctx.saveGState()
    ctx.setFillColor(cgColor(roomHex))
    ctx.fill(stage.full)

    for layer in project.layers {
        if !layer.visible { continue }
        if layer.type == .cover && !project.showCover { continue }
        // One slider fades everything on the photo, keeping each layer's
        // own opacity relative to the rest.
        let opacity = layer.props.opacity.at(t) * (layer.type == .photo ? 1 : project.overlayOpacity ?? 1)
        if opacity <= 0.001 { continue }

        // The scratch bitmap is only needed when something has to see the
        // layer whole: an effect, or a part-transparent layer whose own shapes
        // overlap. Most layers are neither.
        if opacity > 0.999 && layer.effects.isEmpty {
            ctx.saveGState()
            stage.drawLayer(ctx, layer, project, t)
            ctx.restoreGState()
            continue
        }

        let key = holdsStill(layer)
            ? KeptKey(layer: layer, width: stage.width, height: stage.height, media: stage.media.key,
                      palette: project.palette, title: project.song.title, artist: project.song.artist,
                      album: project.song.album)
            : nil
        var finished: CGImage? = nil
        if let key, let kept = stage.kept, kept.key == key { finished = kept.image }
        if finished == nil {
            let c = stage.beginLayer()
            c.saveGState()
            stage.drawLayer(c, layer, project, t)
            c.restoreGState()
            finished = stage.applyEffects(layer.effects, t)
            if let key, let finished { stage.kept = (key, finished) }
        }
        if let finished {
            ctx.saveGState()
            ctx.setAlpha(CGFloat(opacity))
            drawImage(ctx, finished, stage.full)
            ctx.restoreGState()
        }
    }
    ctx.restoreGState()
}

// MARK: - Drawing one layer

extension Stage {
    func drawLayer(_ c: CGContext, _ layer: Layer, _ project: Project, _ t: Double) {
        switch layer.type {
        case .photo: drawPhoto(c, layer, project, t)
        case .disc: drawDisc(c, layer, project, t)
        case .cover: drawCover(c, layer, project, t)
        case .text: drawText(c, layer, project, t)
        case .progressBar: drawProgressBar(c, layer, project, t)
        case .controls: drawControls(c, layer, project, t)
        case .card: drawCard(c, layer, project, t)
        case .window: drawWindow(c, layer, project, t)
        case .artPanel: drawArtPanel(c, layer, project, t)
        }
    }

    /// The layer's own position and angle in effect. `m` is that placement,
    /// from the layer's own space onto the slide.
    func placed(_ c: CGContext, _ layer: Layer, _ t: Double, _ draw: (CGContext, Double, CGAffineTransform) -> Void) {
        let p = layer.props
        let m = CGAffineTransform(translationX: p.x.at(t) * W, y: p.y.at(t) * H)
            .rotated(by: p.rotation.at(t) * .pi / 180)
        c.saveGState()
        c.concatenate(m)
        draw(c, p.scale.at(t), m)
        c.restoreGState()
    }

    // --- photo ---------------------------------------------------------------

    func drawPhoto(_ c: CGContext, _ layer: Layer, _ project: Project, _ t: Double) {
        let p = layer.props
        if p.mode == .solid {
            c.setFillColor(cgColor(p.solidColor ?? project.palette.first ?? roomHex))
            c.fill(full)
            return
        }
        guard let image = media.photo else {
            c.setFillColor(cgColor("#1A1817"))
            c.fill(full)
            return
        }
        paintPhoto(c, layer, t, image)

        // Black and white, as far as the slider says: a grey laid over with
        // the saturation blend takes the colour out.
        let mono = p.mono?.at(t) ?? 0
        if mono > 0.001 {
            c.saveGState()
            c.setBlendMode(.saturation)
            c.setAlpha(CGFloat(min(1, mono)))
            c.setFillColor(cgColor("#808080"))
            c.fill(full)
            c.restoreGState()
        }
    }

    /// The photo itself, filling the stage and keeping its own shape.
    func paintPhoto(_ c: CGContext, _ layer: Layer, _ t: Double, _ image: CGImage) {
        let p = layer.props
        // A blurred background is drawn slightly large so the blur has
        // something to pull in at the edges.
        let grow = layer.effects.contains { $0.type == .blur } ? 1.08 : 1
        let iw = Double(image.width), ih = Double(image.height)
        let s = max(W / iw, H / ih) * grow * p.scale.at(t)
        let w = iw * s, h = ih * s
        c.saveGState()
        c.translateBy(x: p.x.at(t) * W, y: p.y.at(t) * H)
        c.rotate(by: p.rotation.at(t) * .pi / 180)
        drawImage(c, image, CGRect(x: -w / 2, y: -h / 2, width: w, height: h))
        c.restoreGState()
    }

    // --- art panel -------------------------------------------------------------

    /// A panel made of the cover itself, cropped to fill it, darkened toward
    /// the side where the words sit, as a phone's media card is.
    func drawArtPanel(_ c: CGContext, _ layer: Layer, _ project: Project, _ t: Double) {
        let p = layer.props
        placed(c, layer, t) { c, scale, _ in
            let w = W * scale
            let ratio = p.ratio?.at(t) ?? 0.5
            let h = w * (ratio == 0 ? 0.5 : ratio)
            guard w >= 2 && h >= 2 else { return }
            let path = roundedRect(-w / 2, -h / 2, w, h, cornerRadii(p, t, w, h, p.radius?.at(t) ?? 0.09))

            c.saveGState()
            c.setShadow(offset: CGSize(width: 0, height: -w * 0.015), blur: w * 0.05, color: cgColor(0, 0, 0, 0.35))
            c.addPath(path)
            c.setFillColor(cgColor(project.palette.count > 1 ? project.palette[1] : "#1F2430"))
            c.fillPath()
            c.restoreGState()

            c.saveGState()
            c.addPath(path)
            c.clip()
            if let image = media.cover {
                let fit = max(w / Double(image.width), h / Double(image.height))
                let iw = Double(image.width) * fit, ih = Double(image.height) * fit
                drawImage(c, image, CGRect(x: -iw / 2, y: -ih / 2, width: iw, height: ih))
            }
            let dim = p.dim?.at(t) ?? 0.35
            let shade = CGGradient(colorsSpace: sRGB,
                                   colors: [cgColor(0, 0, 0, min(1, dim * 1.4)), cgColor(0, 0, 0, dim * 0.6)] as CFArray,
                                   locations: [0, 1])!
            c.drawLinearGradient(shade, start: CGPoint(x: -w / 2, y: 0), end: CGPoint(x: w / 2, y: 0),
                                 options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
            c.restoreGState()
        }
    }

    // --- colour window ---------------------------------------------------------

    /// A window onto the photo as it really is, sharp and in full colour, lined
    /// up exactly with the same spot of the photo around it, in a light frame.
    func drawWindow(_ c: CGContext, _ layer: Layer, _ project: Project, _ t: Double) {
        let p = layer.props
        let photo = project.layers.first { $0.type == .photo }
        placed(c, layer, t) { c, scale, m in
            let w = W * scale
            let ratio = p.ratio?.at(t) ?? 1.6
            let h = w * (ratio == 0 ? 1.6 : ratio)
            guard w >= 1 && h >= 1 else { return }
            // Roundness here is a fraction of the shorter side.
            let roundness = min(w, h) / w * (p.radius?.at(t) ?? 0.06)
            let path = roundedRect(-w / 2, -h / 2, w, h, cornerRadii(p, t, w, h, roundness))

            c.saveGState()
            c.setShadow(offset: CGSize(width: 0, height: -w * 0.02), blur: w * 0.06, color: cgColor(0, 0, 0, 0.35))
            c.addPath(path)
            c.setFillColor(cgColor("#1A1817"))
            c.fillPath()
            c.restoreGState()

            if let image = media.photo, var plain = photo, plain.props.mode != .solid {
                plain.effects = []
                c.saveGState()
                c.addPath(path)
                c.clip()
                c.concatenate(m.inverted())
                paintPhoto(c, plain, t, image)
                c.restoreGState()
            }

            c.setLineWidth(max(1.5, w * 0.008))
            c.setStrokeColor(cgColor(255, 255, 255, 0.92))
            c.addPath(path)
            c.strokePath()
        }
    }

    // --- record ----------------------------------------------------------------

    func drawDisc(_ c: CGContext, _ layer: Layer, _ project: Project, _ t: Double) {
        let p = layer.props
        let turns = Double(turnsPerLoop(p.rpm ?? 30, project.loopSeconds))
        let direction: Double = (p.direction ?? 1) >= 0 ? 1 : -1
        let angle = t / project.loopSeconds * turns * .pi * 2 * direction
        let labelColor = p.labelColor ?? project.palette.first ?? "#F2A65A"
        let cover = media.cover

        placed(c, layer, t) { c, scale, _ in
            let R = W * 0.5 * scale
            let labelR = R * 0.34
            let holeR = R * 0.033
            let disc = CGRect(x: -R, y: -R, width: R * 2, height: R * 2)

            // A soft warm shadow under the record, never a hard black one.
            c.saveGState()
            c.setShadow(offset: CGSize(width: 0, height: -R * 0.05), blur: R * 0.22, color: cgColor(12, 8, 4, 0.55))
            c.setFillColor(cgColor("#0B0B0B"))
            c.fillEllipse(in: disc)
            c.restoreGState()

            c.saveGState()
            c.rotate(by: angle)

            c.saveGState()
            c.addEllipse(in: disc)
            c.clip()
            let body = CGGradient(colorsSpace: sRGB,
                                  colors: [cgColor("#1B1A19"), cgColor("#121110"), cgColor("#070706")] as CFArray,
                                  locations: [0, 0.7, 1])!
            c.drawRadialGradient(body, startCenter: .zero, startRadius: labelR * 0.8, endCenter: .zero, endRadius: R,
                                 options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
            c.restoreGState()

            // Grooves.
            c.setLineWidth(max(1, R * 0.0035))
            let gap = R * 0.013
            var r = labelR + gap * 2
            while r < R - gap {
                let bright = Int((r / gap).rounded()) % 2 == 0 ? 0.055 : 0.018
                c.setStrokeColor(cgColor(255, 240, 225, bright))
                c.strokeEllipse(in: CGRect(x: -r, y: -r, width: r * 2, height: r * 2))
                r += gap
            }

            // The label.
            let label = CGRect(x: -labelR, y: -labelR, width: labelR * 2, height: labelR * 2)
            c.setFillColor(cgColor(labelColor))
            c.fillEllipse(in: label)
            if p.showLabelArt == true, let cover, project.showCover {
                c.saveGState()
                c.addEllipse(in: label)
                c.clip()
                drawImage(c, cover, label)
                c.restoreGState()
            } else {
                c.setStrokeColor(cgColor(20, 15, 10, 0.28))
                c.setLineWidth(max(1, R * 0.008))
                for f in [0.74, 0.5] {
                    c.strokeEllipse(in: CGRect(x: -labelR * f, y: -labelR * f, width: labelR * f * 2, height: labelR * f * 2))
                }
            }
            c.setFillColor(cgColor(roomHex))
            c.fillEllipse(in: CGRect(x: -holeR, y: -holeR, width: holeR * 2, height: holeR * 2))
            c.restoreGState()

            // The light does not turn with the record: a soft sweep, not gloss.
            c.saveGState()
            c.addEllipse(in: disc)
            c.clip()
            let sheen = CGGradient(colorsSpace: sRGB, colors: [
                cgColor(255, 238, 214, 0), cgColor(255, 238, 214, 0.05), cgColor(255, 238, 214, 0),
                cgColor(255, 238, 214, 0.028), cgColor(255, 238, 214, 0),
            ] as CFArray, locations: [0, 0.34, 0.46, 0.74, 1])!
            c.drawLinearGradient(sheen, start: CGPoint(x: -R, y: -R), end: CGPoint(x: R, y: R),
                                 options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
            c.restoreGState()
        }
    }

    // --- cover -----------------------------------------------------------------

    func drawCover(_ c: CGContext, _ layer: Layer, _ project: Project, _ t: Double) {
        let p = layer.props
        let image = media.cover
        placed(c, layer, t) { c, scale, _ in
            let size = W * scale
            let half = size / 2
            let box = CGRect(x: -half, y: -half, width: size, height: size)
            // A round cover is a circle cut from the middle of the square art.
            let outline = p.round == true ? CGPath(ellipseIn: box, transform: nil) : CGPath(rect: box, transform: nil)

            c.saveGState()
            c.setShadow(offset: CGSize(width: 0, height: -size * 0.035), blur: size * 0.16,
                        color: cgColor(10, 6, 3, p.shadow?.at(t) ?? 0.5))
            c.setFillColor(cgColor(project.palette.count > 1 ? project.palette[1] : "#2A2724"))
            c.addPath(outline)
            c.fillPath()
            c.restoreGState()

            // The cover art itself is never blurred, tinted or stretched.
            if let image {
                c.saveGState()
                c.addPath(outline)
                c.clip()
                drawImage(c, image, box)
                c.restoreGState()
            }

            c.setStrokeColor(cgColor(255, 240, 225, 0.10))
            c.setLineWidth(max(1, size * 0.004))
            c.addPath(outline)
            c.strokePath()
        }
    }

    // --- text ------------------------------------------------------------------

    func textFor(_ layer: Layer, _ project: Project) -> String {
        switch layer.props.bind {
        case .title: return project.song.title.isEmpty ? "Untitled" : project.song.title
        case .artist: return project.song.artist.isEmpty ? "Unknown artist" : project.song.artist
        // No album, no line: a song typed in by hand may not have one.
        case .album: return project.song.album
        case nil: return layer.props.text ?? ""
        }
    }

    /**
     The tones for words and buttons, chosen by what is actually behind them.
     Pale words vanish on a bright sky and dark ones on a night, so the slide
     under a layer is measured before it is drawn, and each tone is pushed just
     far enough to clear reading contrast. Kept until anything relevant moves.
     */
    func tonesFor(_ layer: Layer, _ project: Project, _ t: Double) -> Tones {
        let p = layer.props
        let index = project.layers.firstIndex { $0.id == layer.id } ?? 0
        let below = Array(project.layers[..<index])
        let key = ToneKey(
            id: layer.id,
            x: Int((p.x.at(t) * 200).rounded()), y: Int((p.y.at(t) * 200).rounded()),
            scale: Int((p.scale.at(t) * 200).rounded()),
            width: width, media: media.key, below: below, palette: project.palette,
            // A moving photo changes what is behind; checked ten times a second.
            moment: below.contains { !holdsStill($0) } ? Int((t * 10).rounded()) : 0
        )
        if let found = contrast[key] { return found }

        let scale = p.scale.at(t)
        let size = layer.type == .text ? W * (p.size ?? 0.05) * scale : W * scale * 0.1
        let reach = layer.type == .text ? min(W * (p.maxWidth ?? 0.5) * scale, size * 6) : W * scale
        let cx = p.x.at(t) * W + (p.align == .left ? reach / 2 : p.align == .right ? -reach / 2 : 0)
        let cy = p.y.at(t) * H
        let behind = averageColour(x0: cx - reach / 2, y0: cy - size, x1: cx + reach / 2, y1: cy + size)
        let base = behind.luminance > 0.18 ? coverTonesDark(project.palette) : coverTones(project.palette)
        let tones = Tones(
            accent: legibleOn(base.accent, behind, 4.5),
            ink: legibleOn(base.ink, behind, 7),
            soft: legibleOn(base.soft, behind, 4.5),
            deep: base.deep
        )
        if contrast.count > 200 { contrast.removeAll() }
        contrast[key] = tones
        return tones
    }

    /// The average colour of a patch of the slide as drawn so far.
    func averageColour(x0: Double, y0: Double, x1: Double, y1: Double) -> RGB {
        guard let data = ctx.data?.assumingMemoryBound(to: UInt8.self) else { return RGB(0, 0, 0) }
        let bpr = ctx.bytesPerRow
        let left = max(0, min(W - 1, x0)), right = max(0, min(W - 1, x1))
        let top = max(0, min(H - 1, y0)), bottom = max(0, min(H - 1, y1))
        var r = 0.0, g = 0.0, b = 0.0, n = 0.0
        for j in 0..<8 {
            let y = Int(top + (bottom - top) * (Double(j) + 0.5) / 8)
            for i in 0..<16 {
                let x = Int(left + (right - left) * (Double(i) + 0.5) / 16)
                let o = y * bpr + x * 4
                b += Double(data[o]); g += Double(data[o + 1]); r += Double(data[o + 2]); n += 1
            }
        }
        return RGB(Int((r / n).rounded()), Int((g / n).rounded()), Int((b / n).rounded()))
    }

    private func textColour(_ p: LayerProps, _ tones: Tones) -> CGColor {
        // The colours the templates used to write in by hand count as unset.
        if let colour = p.color, colour != "#F3EFE9", colour != "#A8A097" { return cgColor(colour) }
        if p.tone == "accent" { return cgColor(tones.accent) }
        return p.bind == .artist ? cgColor(tones.ink, 0.85) : cgColor(tones.ink)
    }

    func drawText(_ c: CGContext, _ layer: Layer, _ project: Project, _ t: Double) {
        let p = layer.props
        var value = textFor(layer, project)
        if p.uppercase == true { value = value.uppercased() }
        if value.isEmpty { return }
        let tones = tonesFor(layer, project, t)
        // The artist line is small, so it is semibold unless the layer says.
        let weight = p.weight ?? (p.bind == .artist ? 600 : 400)
        let face = p.font ?? .sans
        let tracking = p.tracking ?? 0

        placed(c, layer, t) { c, scale, _ in
            var size = W * (p.size ?? 0.05) * scale
            var font = SlideFonts.font(face, weight: weight, size: size)
            // A line with a limit shrinks to fit it, so a long title stays
            // inside the card rather than running off its sides.
            if let maxWidth = p.maxWidth {
                let room = W * maxWidth * scale
                let wide = textWidth(value, font) + tracking * size * Double(max(0, value.count - 1))
                if wide > room {
                    size *= room / wide
                    font = SlideFonts.font(face, weight: weight, size: size)
                }
            }
            drawLine(c, value, font, textColour(p, tones), x: 0, y: 0, align: p.align ?? .center, tracking: tracking * size)
        }
    }

    // --- progress bar ------------------------------------------------------------

    func drawProgressBar(_ c: CGContext, _ layer: Layer, _ project: Project, _ t: Double) {
        let p = layer.props
        let trackSeconds = project.song.durationMs / 1000
        let tones = tonesFor(layer, project, t)
        let speed = (p.speed ?? 1) == 0 ? 1 : (p.speed ?? 1)
        let positionAt = { (moment: Double) in project.song.clipStartSeconds + moment * speed }

        placed(c, layer, t) { c, scale, _ in
            let width = W * scale
            let half = width / 2
            // The pill style is a thick bar, as on a phone's media card.
            let pill = p.style == "pill"
            let thickness = pill ? width * 0.032 : max(2, width * 0.0075)
            // Times in the slide's own face run at 4.5% of the bar, as music
            // apps set them; monospace digits are wider, so a touch smaller.
            let timeSize = width * (p.font != nil ? 0.045 : 0.036)
            let clock = { (s: Double) -> String in
                let text = formatTime(s)
                return pill && text.count < 5 ? String(repeating: "0", count: 5 - text.count) + text : text
            }
            let timesAt = pill ? thickness / 2 + timeSize * 1.3 : timeSize * 1.9

            // The line itself is always fully there.
            c.setLineCap(.round)
            c.setLineWidth(thickness)
            c.setStrokeColor(cgColor(tones.ink, pill ? 0.3 : 0.24))
            c.move(to: CGPoint(x: -half, y: 0))
            c.addLine(to: CGPoint(x: half, y: 0))
            c.strokePath()

            // At the loop point the bar has to go back to where it started.
            // Rather than snap, the ending dissolves into the start over the
            // last fraction of a second, so the reset reads as a soft cut.
            let fade = min(0.35, project.loopSeconds * 0.06)
            let into = t - (project.loopSeconds - fade)
            let blend = into > 0 ? min(1, into / fade) : 0
            let states: [(at: Double, alpha: Double)] = blend > 0
                ? [(positionAt(t), 1 - blend), (positionAt(0), blend)]
                : [(positionAt(t), 1)]

            let font = SlideFonts.font(p.font ?? .mono, weight: 400, size: timeSize)
            for state in states {
                let fraction = trackSeconds > 0 ? min(1, max(0, state.at / trackSeconds)) : 0
                let x = -half + width * fraction
                c.saveGState()
                c.setAlpha(CGFloat(state.alpha))
                c.setStrokeColor(pill ? cgColor(tones.ink, 0.85) : cgColor(tones.accent))
                c.setLineWidth(thickness)
                c.move(to: CGPoint(x: -half, y: 0))
                c.addLine(to: CGPoint(x: x, y: 0))
                c.strokePath()

                let knob = pill ? thickness * 0.85 : thickness * 1.9
                c.setFillColor(cgColor(tones.ink))
                c.fillEllipse(in: CGRect(x: x - knob, y: -knob, width: knob * 2, height: knob * 2))

                if p.showTimes == true {
                    let ink = cgColor(tones.soft, 0.85)
                    drawLine(c, clock(state.at), font, ink, x: -half, y: timesAt, align: .left)
                    // A phone's card shows the length; Apple counts down what is left.
                    let right = pill ? clock(trackSeconds)
                        : trackSeconds > 0 ? "-" + formatTime(max(0, trackSeconds - state.at)) : "0:00"
                    drawLine(c, right, font, ink, x: half, y: timesAt, align: .right)
                }
                c.restoreGState()
            }
        }
    }

    // --- transport icons (decorative) --------------------------------------------

    func drawControls(_ c: CGContext, _ layer: Layer, _ project: Project, _ t: Double) {
        let ink = cgColor(tonesFor(layer, project, t).ink, 0.9)
        let p = layer.props
        placed(c, layer, t) { c, scale, _ in
            let width = W * scale
            let unit = width * 0.13
            let gap = width * 0.32
            c.setFillColor(ink)
            c.setStrokeColor(ink)
            c.setLineWidth(max(1.5, unit * 0.12))
            c.setLineJoin(.round)

            func triangle(_ cx: Double, _ dir: Double, _ size: Double) {
                c.move(to: CGPoint(x: cx + size / 2 * dir, y: 0))
                c.addLine(to: CGPoint(x: cx - size / 2 * dir, y: -size * 0.58))
                c.addLine(to: CGPoint(x: cx - size / 2 * dir, y: size * 0.58))
                c.closePath()
                c.fillPath()
            }
            // Back and forward as a pair of arrows each.
            func double(_ cx: Double, _ dir: Double) {
                triangle(cx - unit * 0.3 * dir, dir, unit * 0.75)
                triangle(cx + unit * 0.3 * dir, dir, unit * 0.75)
            }
            func pause(_ cx: Double, _ u: Double) {
                let barW = u * 0.3, barH = u * 1.05
                for side in [-1.0, 1] {
                    c.addPath(roundedRect(cx + side * u * 0.24 - barW / 2, -barH / 2, barW, barH, [barW * 0.3]))
                    c.fillPath()
                }
            }

            // A phone's media row: shuffle, previous, pause, next, evenly spread.
            if p.style == "media" {
                let step = width / 4
                let u = unit * 0.68
                // |< and >|: the arrow points at a bar on its far side.
                func skip(_ cx: Double, _ dir: Double) {
                    triangle(cx - u * 0.1 * dir, dir, u * 0.8)
                    let bar = max(1.5, u * 0.14)
                    c.fill(CGRect(x: cx + dir * u * 0.38 - bar / 2, y: -u * 0.46, width: bar, height: u * 0.92))
                }
                // Shuffle: two lines that cross, each ending in an arrowhead.
                c.saveGState()
                c.translateBy(x: -step * 1.5, y: 0)
                c.setLineCap(.round)
                for flip in [1.0, -1] {
                    c.move(to: CGPoint(x: -u * 0.55, y: -u * 0.36 * flip))
                    c.addLine(to: CGPoint(x: -u * 0.2, y: -u * 0.36 * flip))
                    c.addLine(to: CGPoint(x: u * 0.2, y: u * 0.36 * flip))
                    c.addLine(to: CGPoint(x: u * 0.55, y: u * 0.36 * flip))
                    c.strokePath()
                    c.move(to: CGPoint(x: u * 0.38, y: u * 0.36 * flip - u * 0.17))
                    c.addLine(to: CGPoint(x: u * 0.55, y: u * 0.36 * flip))
                    c.addLine(to: CGPoint(x: u * 0.38, y: u * 0.36 * flip + u * 0.17))
                    c.strokePath()
                }
                c.restoreGState()
                skip(-step * 0.5, -1)
                pause(step * 0.5, u)
                skip(step * 1.5, 1)
                return
            }

            double(-gap, -1)
            // Pause can sit in a soft disc, as on the bookmark.
            if p.ring == true {
                c.saveGState()
                c.setFillColor(cgColor(255, 255, 255, 0.22))
                c.fillEllipse(in: CGRect(x: -unit * 0.95, y: -unit * 0.95, width: unit * 1.9, height: unit * 1.9))
                c.restoreGState()
            }
            // Pause, a little larger than its neighbours: two rounded bars.
            pause(0, unit)
            double(gap, 1)
        }
    }
}

// MARK: - Shapes and words

/// The four radii of a pane, in pixels, from its roundness and shape.
func cornerRadii(_ p: LayerProps, _ t: Double, _ w: Double, _ h: Double, _ roundness: Double) -> [Double] {
    let most = min(w, h) / 2
    let r = w * max(0, roundness)
    return (p.corners ?? .round).corners.map { min(most, r * $0) }
}

/// A rectangle with its own radius at each corner: top left, top right,
/// bottom right, bottom left. One radius means all four.
func roundedRect(_ x: Double, _ y: Double, _ w: Double, _ h: Double, _ radii: [Double]) -> CGPath {
    let all = radii.count == 4 ? radii : Array(repeating: radii.first ?? 0, count: 4)
    let r = all.map { max(0, min($0, w / 2, h / 2)) }
    let path = CGMutablePath()
    path.move(to: CGPoint(x: x + r[0], y: y))
    path.addArc(tangent1End: CGPoint(x: x + w, y: y), tangent2End: CGPoint(x: x + w, y: y + h), radius: r[1])
    path.addArc(tangent1End: CGPoint(x: x + w, y: y + h), tangent2End: CGPoint(x: x, y: y + h), radius: r[2])
    path.addArc(tangent1End: CGPoint(x: x, y: y + h), tangent2End: CGPoint(x: x, y: y), radius: r[3])
    path.addArc(tangent1End: CGPoint(x: x, y: y), tangent2End: CGPoint(x: x + w, y: y), radius: r[0])
    path.closeSubpath()
    return path
}

private func line(_ text: String, _ font: CTFont, _ colour: CGColor?, _ tracking: Double) -> CTLine {
    var attributes: [NSAttributedString.Key: Any] = [NSAttributedString.Key(kCTFontAttributeName as String): font]
    if let colour { attributes[NSAttributedString.Key(kCTForegroundColorAttributeName as String)] = colour }
    // Tracking, not kerning: it spaces the letters and keeps the font's own
    // pair adjustments, so the words never look subtly off.
    if tracking != 0 { attributes[NSAttributedString.Key(kCTTrackingAttributeName as String)] = tracking }
    return CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: attributes))
}

func textWidth(_ text: String, _ font: CTFont) -> Double {
    Double(CTLineGetTypographicBounds(line(text, font, nil, 0), nil, nil, nil))
}

/// One line of text, centred vertically on `y` like a canvas's middle baseline.
func drawLine(_ c: CGContext, _ text: String, _ font: CTFont, _ colour: CGColor,
              x: Double, y: Double, align: TextAlign, tracking: Double = 0) {
    let run = line(text, font, colour, tracking)
    // Tracking also pads after the last letter, which is not part of the
    // word's width when it comes to centring it.
    let total = Double(CTLineGetTypographicBounds(run, nil, nil, nil)) - tracking
    let start = align == .center ? x - total / 2 : align == .right ? x - total : x
    let baseline = y + (Double(CTFontGetAscent(font)) - Double(CTFontGetDescent(font))) / 2
    c.saveGState()
    c.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
    c.textPosition = CGPoint(x: start, y: baseline)
    CTLineDraw(run, c)
    c.restoreGState()
}
