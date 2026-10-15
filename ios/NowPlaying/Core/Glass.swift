import CoreGraphics
import Foundation

/*
 THE GLASS CARD
 --------------
 The panel the player sits on, made as Apple's Liquid Glass: a clear pane
 that lets the picture through, bends it at a rounded rim like a lens, takes a
 breath of the cover's colour, and catches the light along its edge.
*/

struct GlassKey: Hashable {
    var photo: Layer?
    var width: Int
    var height: Int
    var media: String
    var moment: Int
    var pixels: Int
    var grain: Int
}

/// The rim of a pane, worked out once per card shape.
final class Lens {
    let key: [Int]
    let W: Int
    let H: Int
    var index: [Int] = []
    var at: [Float] = []
    var nx: [Float] = []
    var ny: [Float] = []
    var bend: [Float] = []
    var line: [Float] = []
    var glow: [Float] = []
    var cover: [Float] = []
    var pixels: [UInt8]
    var image: CGImage?
    var drawn: [Double]?

    init(key: [Int], W: Int, H: Int) {
        self.key = key
        self.W = W
        self.H = H
        self.pixels = [UInt8](repeating: 0, count: W * H * 4)
    }
}

extension Stage {
    /**
     What the card is made from: everything drawn so far, frosted by the card's
     own amount, with its colour lifted. Under the card that is the photo, which
     holds still, so this is kept and only redone when the photo changes.

     ponytail: the key only knows about the photo, which is right while the
     card sits straight above it, as every template puts it. A layer slipped in
     between would freeze into the glass until the photo next changed.
     */
    func glassBehind(_ project: Project, _ t: Double, _ pixels: Double, _ grain: Double) -> CGImage? {
        let photo = project.layers.first { $0.type == .photo }
        let key = GlassKey(
            photo: photo, width: width, height: height, media: media.key,
            // A keyframed photo changes under the glass: redone ten times a second.
            moment: photo.map { holdsStill($0) } == false ? Int((t * 10).rounded()) : 0,
            pixels: Int((pixels * 2).rounded()), grain: Int((grain * 100).rounded())
        )
        if key == glassKey { return glassImage }

        guard let snapshot = ctx.makeImage() else { return nil }
        let soft = Stage.blurred(snapshot, pixels) ?? snapshot
        if frostCtx == nil { frostCtx = makeCanvas(width, height) }
        let f = frostCtx!
        f.clear(full)
        drawImage(f, soft, full)
        guard let data = f.data?.assumingMemoryBound(to: UInt8.self) else { return nil }
        let bpr = f.bytesPerRow

        // Frosted glass is a rough surface: each point bends light from
        // somewhere slightly different, so the picture breaks into a fine
        // speckle. Every pixel takes its colour from a random spot nearby,
        // fixed per slide so nothing shimmers. `grain` is how far that reaches.
        let reach = pixels * 0.8 * grain
        if pixels >= 0.5 && grain > 0.001 && reach >= 0.5 {
            let from = [UInt8](UnsafeBufferPointer(start: data, count: bpr * height))
            let jitter = jitter()
            for y in 0..<height {
                for x in 0..<width {
                    let i = y * width + x
                    var sx = x + Int(Double(jitter[i * 2]) * reach / 127)
                    var sy = y + Int(Double(jitter[i * 2 + 1]) * reach / 127)
                    sx = sx < 0 ? 0 : sx >= width ? width - 1 : sx
                    sy = sy < 0 ? 0 : sy >= height ? height - 1 : sy
                    let o = y * bpr + x * 4, s = sy * bpr + sx * 4
                    data[o] = from[s]; data[o + 1] = from[s + 1]; data[o + 2] = from[s + 2]; data[o + 3] = from[s + 3]
                }
            }
        }

        // Glass lifts the colour of what is behind it rather than dulling it:
        // saturate 1.5 and brighten 6%, as the web's filters do.
        let s = 1.5, k = 1.06
        for y in 0..<height {
            let row = data + y * bpr
            for x in 0..<width {
                let o = x * 4
                let b = Double(row[o]), g = Double(row[o + 1]), r = Double(row[o + 2])
                let r2 = ((0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b) * k
                let g2 = ((0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b) * k
                let b2 = ((0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b) * k
                let a = Double(row[o + 3])
                row[o] = UInt8(max(0, min(a, b2)))
                row[o + 1] = UInt8(max(0, min(a, g2)))
                row[o + 2] = UInt8(max(0, min(a, r2)))
            }
        }

        // Kept top row first, blue-green-red-alpha, for the lens to read.
        var packed = [UInt8](repeating: 0, count: width * height * 4)
        for y in 0..<height {
            memcpy(&packed[y * width * 4], data + y * bpr, width * 4)
        }
        glassPixels = packed
        glassImage = f.makeImage()
        glassKey = key
        glassGeneration += 1
        return glassImage
    }

    /// Which way each pixel looks for its colour, two signed bytes apiece.
    /// Two random numbers added together lean toward the middle, so most
    /// pixels move a little and a few move a lot, as on real frosted glass.
    func jitter() -> [Int8] {
        if let table = jitterTable { return table }
        var seed: UInt64 = 1_234_567
        func random() -> Double {
            seed = (seed &* 1_103_515_245 &+ 12345) & 0x7fff_ffff
            return Double(seed) / Double(0x7fff_ffff)
        }
        var table = [Int8](repeating: 0, count: width * height * 2)
        for i in table.indices { table[i] = Int8(((random() + random() - 1) * 127).rounded()) }
        jitterTable = table
        return table
    }

    /**
     The rim of a pane of Liquid Glass. The pane is a slab whose edge rounds
     over like a squircle across a bezel. Light coming up through that curved
     edge is bent by Snell's law (glass, n = 1.5), so each point of the rim
     shows the backdrop from a little further in, strongest right at the edge.
     The flat middle bends nothing. Each point keeps its outward normal, which
     the highlight uses.
     */
    func lensFor(_ w: Double, _ h: Double, _ radii: [Double]) -> Lens {
        let W = Int(w.rounded(.up)), H = Int(h.rounded(.up))
        let bezel = max(4, min(w, h) * 0.11)
        let key = [W, H] + radii.map { Int($0.rounded()) } + [Int(bezel.rounded())]
        if let lens, lens.key == key { return lens }

        let made = Lens(key: key, W: W, H: H)
        let sheen = max(1.2, min(w, h) * 0.006)
        for j in 0..<H {
            for i in 0..<W {
                let px = Double(i) + 0.5 - w / 2
                let py = Double(j) + 0.5 - h / 2
                let r = radii[py < 0 ? (px < 0 ? 0 : 1) : (px < 0 ? 3 : 2)]
                let qx = abs(px) - (w / 2 - r)
                let qy = abs(py) - (h / 2 - r)
                // Distance in from the edge, and the way out.
                var d: Double, ox: Double, oy: Double
                if qx > 0 && qy > 0 {
                    let len = max(1e-9, hypot(qx, qy))
                    d = r - len
                    ox = qx / len * (px < 0 ? -1 : 1)
                    oy = qy / len * (py < 0 ? -1 : 1)
                } else if qx > qy {
                    d = r - qx; ox = px < 0 ? -1 : 1; oy = 0
                } else {
                    d = r - qy; ox = 0; oy = py < 0 ? -1 : 1
                }
                if d <= -0.5 || d >= bezel { continue }

                let x = max(0, d) / bezel
                let inner = 1 - x
                let rest = 1 - pow(inner, 4)
                let slope = min(40, pow(inner, 3) / pow(max(1e-3, rest), 0.75))
                let tilt = atan(slope)
                let bent = tilt - asin(sin(tilt) / 1.5)

                made.index.append((j * W + i) * 4)
                made.at.append(Float(px)); made.at.append(Float(py))
                made.nx.append(Float(ox))
                made.ny.append(Float(oy))
                made.bend.append(Float(min(bezel, bezel * 0.6 * tan(bent))))
                made.line.append(Float(exp(-max(0, d) / sheen)))
                made.glow.append(Float(pow(inner, 3)))
                made.cover.append(Float(min(1, d + 0.5)))
            }
        }
        lens = made
        return made
    }

    /**
     Bend the backdrop through the rim and light its edge, into the lens's own
     image, in the card's own coordinates. `m` maps those onto the slide.
     Red, green and blue bend by slightly different amounts, as in real glass,
     which leaves a faint rainbow fringe where the bend is strongest.
     */
    func paintLens(_ lens: Lens, _ m: CGAffineTransform) {
        guard let src = glassPixels else { return }
        let SW = width, SH = height
        // The light comes from up and to the left of the slide. Turning the
        // card turns the edge, not the light.
        let angle = atan2(Double(m.b), Double(m.a))
        let lx = -0.6 * cos(angle) - 0.8 * sin(angle)
        let ly = 0.6 * sin(angle) - 0.8 * cos(angle)
        let a = Double(m.a), b = Double(m.b), c = Double(m.c), d = Double(m.d), e = Double(m.tx), f = Double(m.ty)

        lens.pixels.withUnsafeMutableBufferPointer { out in
            src.withUnsafeBufferPointer { src in
                @inline(__always) func sample(_ x: Double, _ y: Double, _ ch: Int) -> Double {
                    var X = Int(a * x + c * y + e)
                    var Y = Int(b * x + d * y + f)
                    X = X < 0 ? 0 : X >= SW ? SW - 1 : X
                    Y = Y < 0 ? 0 : Y >= SH ? SH - 1 : Y
                    return Double(src[(Y * SW + X) * 4 + ch])
                }
                for k in 0..<lens.nx.count {
                    let px = Double(lens.at[k * 2]), py = Double(lens.at[k * 2 + 1])
                    let o = lens.index[k]
                    let ox = Double(lens.nx[k] * lens.bend[k]), oy = Double(lens.ny[k] * lens.bend[k])
                    // Glass pixels are blue, green, red, alpha.
                    let red = sample(px - ox * 0.9, py - oy * 0.9, 2)
                    let green = sample(px - ox, py - oy, 1)
                    let blue = sample(px - ox * 1.12, py - oy * 1.12, 0)
                    // A thin bright line right at the edge where it faces the
                    // light, a softer glow fading in across the bezel.
                    let facing = Double(lens.nx[k]) * lx + Double(lens.ny[k]) * ly
                    let lit = facing > 0 ? facing * facing : 0.35 * facing * facing
                    let light = min(1, Double(lens.line[k]) * (0.24 + 0.71 * lit) + Double(lens.glow[k]) * (0.1 + 0.12 * lit))
                    let alpha = Double(lens.cover[k])
                    out[o] = UInt8((blue + (255 - blue) * light) * alpha)
                    out[o + 1] = UInt8((green + (255 - green) * light) * alpha)
                    out[o + 2] = UInt8((red + (255 - red) * light) * alpha)
                    out[o + 3] = UInt8(255 * alpha)
                }
            }
        }
        let info = CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
        let provider = CGDataProvider(data: Data(lens.pixels) as CFData)!
        lens.image = CGImage(width: lens.W, height: lens.H, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: lens.W * 4,
                             space: sRGB, bitmapInfo: CGBitmapInfo(rawValue: info), provider: provider,
                             decode: nil, shouldInterpolate: true, intent: .defaultIntent)
    }

    /// How close to a middling grey the glass under a card is: 1 at the worst
    /// middle, 0 for anything clearly dark or light.
    func middling(_ m: CGAffineTransform, _ w: Double, _ h: Double) -> Double {
        guard let src = glassPixels else { return 0 }
        let key = [Double(glassGeneration), (Double(m.tx)).rounded(), (Double(m.ty)).rounded(), w.rounded(), h.rounded()]
        if key == middlingKey { return middlingValue }
        var sum = 0.0
        for i in 0..<12 {
            for j in 0..<12 {
                let x = min(width - 1, max(0, Int((Double(m.tx) + ((Double(i) + 0.5) / 12 - 0.5) * w).rounded())))
                let y = min(height - 1, max(0, Int((Double(m.ty) + ((Double(j) + 0.5) / 12 - 0.5) * h).rounded())))
                let o = (y * width + x) * 4
                sum += RGB(Int(src[o + 2]), Int(src[o + 1]), Int(src[o])).luminance
            }
        }
        // 0.18 is where white and black words read equally badly.
        let value = max(0, 1 - abs(sum / 144 - 0.18) / 0.18)
        middlingKey = key
        middlingValue = value
        return value
    }

    func drawCard(_ c: CGContext, _ layer: Layer, _ project: Project, _ t: Double) {
        let p = layer.props
        let tones = coverTones(project.palette)
        // Blur is per 1000 pixels of slide width, so preview and file agree.
        let pixels = (p.blur?.at(t) ?? 12) * W / 1000
        let glass = glassBehind(project, t, pixels, p.grain?.at(t) ?? 0.5)

        placed(c, layer, t) { c, scale, m in
            let w = W * scale
            let ratio = p.ratio?.at(t) ?? 1.2
            let h = w * (ratio == 0 ? 1.2 : ratio)
            guard w >= 2 && h >= 2 else { return }
            let radii = cornerRadii(p, t, w, h, p.radius?.at(t) ?? 0.075)
            let path = roundedRect(-w / 2, -h / 2, w, h, radii)

            // A soft shadow under the pane, drawn on its own so it never
            // darkens the glass itself.
            c.saveGState()
            c.setShadow(offset: CGSize(width: 0, height: -w * 0.025), blur: w * 0.08, color: cgColor(0, 0, 0, 0.35))
            c.addPath(path)
            c.setFillColor(cgColor(tones.deep, 0.3))
            c.fillPath()
            c.restoreGState()

            // The flat middle: the picture behind, straight through, drawn
            // back exactly over the part of the slide it was made from.
            if let glass {
                c.saveGState()
                c.addPath(path)
                c.clip()
                c.concatenate(m.inverted())
                drawImage(c, glass, full)
                c.restoreGState()
            }

            if glassPixels != nil {
                // The rim. Redone only when the card, or what is behind it, moves.
                let lens = lensFor(w, h, radii)
                let drawn = [Double(glassGeneration), Double(m.a), Double(m.b), Double(m.c), Double(m.d),
                             (Double(m.tx) * 4).rounded(), (Double(m.ty) * 4).rounded()]
                if lens.drawn != drawn {
                    paintLens(lens, m)
                    lens.drawn = drawn
                }
                if let image = lens.image {
                    drawImage(c, image, CGRect(x: -w / 2, y: -h / 2, width: Double(lens.W), height: Double(lens.H)))
                }
            }

            // A breath of the cover's colour over the whole pane, deeper over
            // a middling backdrop where neither pale nor dark words would
            // stand out on clear glass, and the faintest lift.
            c.saveGState()
            c.addPath(path)
            c.clip()
            c.setFillColor(cgColor(tones.deep, 0.18 + 0.24 * middling(m, w, h)))
            c.fill(CGRect(x: -w / 2, y: -h / 2, width: w, height: h))
            c.setFillColor(cgColor(255, 255, 255, 0.05))
            c.fill(CGRect(x: -w / 2, y: -h / 2, width: w, height: h))
            if glassPixels == nil {
                c.setLineWidth(max(2, w * 0.008))
                c.setStrokeColor(cgColor(255, 255, 255, 0.5))
                c.addPath(path)
                c.strokePath()
            }
            c.restoreGState()
        }
    }
}
