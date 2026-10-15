import SwiftUI
import UIKit

/*
 The slide on screen. A plain UIView, because it needs every finger on its own
 from the moment it lands (a pinch, a twist and a drag at once), and because a
 new frame thirty times a second is cheapest as a layer's contents.

 The selection box and the alignment guides are drawn on top by SwiftUI, on
 their own, so nothing about the selection ever reaches the file.
*/

final class PreviewSurfaceView: UIView {
    weak var engine: EditorEngine?
    private let imageLayer = CALayer()
    /// Never acts; it only exists so that swiping back waits for it, below.
    private let holder = UIPanGestureRecognizer()

    override init(frame: CGRect) {
        super.init(frame: frame)
        isMultipleTouchEnabled = true
        isOpaque = true
        imageLayer.contentsGravity = .resize
        imageLayer.magnificationFilter = .linear
        imageLayer.minificationFilter = .trilinear
        layer.addSublayer(imageLayer)
        holder.cancelsTouchesInView = false
        holder.delaysTouchesBegan = false
        holder.delaysTouchesEnded = false
        addGestureRecognizer(holder)
        isAccessibilityElement = true
        accessibilityLabel = "Preview of the slide"
        accessibilityTraits = .image
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    /// Since iOS 26 a swipe right anywhere goes back a screen, which took any
    /// rightward drag on the slide away from it. A drag that starts on the
    /// slide belongs to the slide; everywhere else still swipes back.
    override func didMoveToWindow() {
        super.didMoveToWindow()
        var responder: UIResponder? = self
        while let next = responder?.next, !(next is UINavigationController) { responder = next }
        guard let navigation = responder?.next as? UINavigationController else { return }
        navigation.interactivePopGestureRecognizer?.require(toFail: holder)
        if #available(iOS 26, *) { navigation.interactiveContentPopGestureRecognizer?.require(toFail: holder) }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        imageLayer.frame = bounds
        CATransaction.commit()
    }

    func show(_ image: CGImage) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        imageLayer.contents = image
        CATransaction.commit()
    }

    private func points(_ touches: Set<UITouch>) -> [(ObjectIdentifier, CGPoint, CGPoint)] {
        guard let engine, bounds.width > 0 else { return [] }
        let sx = engine.stage.width / bounds.width
        let sy = engine.stage.height / bounds.height
        return touches.map { touch in
            let p = touch.location(in: self)
            return (ObjectIdentifier(touch), CGPoint(x: p.x * sx, y: p.y * sy), touch.location(in: nil))
        }
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        engine?.touchesBegan(points(touches))
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        engine?.touchesMoved(points(touches))
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        engine?.touchesEnded(touches.map { ObjectIdentifier($0) })
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        engine?.touchesEnded(touches.map { ObjectIdentifier($0) })
    }
}

struct PreviewSurface: UIViewRepresentable {
    let engine: EditorEngine

    func makeUIView(context: Context) -> PreviewSurfaceView {
        let view = PreviewSurfaceView()
        view.engine = engine
        engine.surface = view
        engine.redraw()
        return view
    }

    func updateUIView(_ view: PreviewSurfaceView, context: Context) {
        view.engine = engine
        engine.surface = view
    }
}

/// The selection box, its corner dots and the guides a gesture snapped to.
struct SelectionOverlay: View {
    let engine: EditorEngine
    @Environment(AppModel.self) private var model

    var body: some View {
        Canvas { ctx, size in
            guard let project = model.project, let layer = model.selectedLayer,
                  !layer.locked, layer.visible, engine.stage.width > 0 else { return }
            let t = model.time
            let k = size.width / engine.stage.width
            let stage = engine.stage

            // Alignment guides in yellow, like Keynote's.
            let snapped = engine.snapped
            if snapped.x || snapped.y {
                var guides = Path()
                if snapped.x {
                    let x = layer.props.x.at(t) * size.width
                    guides.move(to: CGPoint(x: x, y: 0)); guides.addLine(to: CGPoint(x: x, y: size.height))
                }
                if snapped.y {
                    let y = layer.props.y.at(t) * size.height
                    guides.move(to: CGPoint(x: 0, y: y)); guides.addLine(to: CGPoint(x: size.width, y: y))
                }
                ctx.stroke(guides, with: .color(Color(red: 1, green: 0.84, blue: 0.04)), lineWidth: 1)
            }

            // White with a soft shadow, the way Photos draws a crop box: it
            // reads on a light photo and a dark one alike.
            let b = selectionBounds(layer, project, stage, t)
            var box = ctx
            box.translateBy(x: b.cx * k, y: b.cy * k)
            box.rotate(by: .degrees(b.rotation))
            box.addFilter(.shadow(color: .black.opacity(0.45), radius: 2))
            let w = b.w * k, h = b.h * k
            box.stroke(Path(CGRect(x: -w / 2, y: -h / 2, width: w, height: h)), with: .color(.white), lineWidth: 1.5)
            let r = handleRadius(stage) * k
            for (hx, hy) in [(-1.0, -1.0), (1, -1), (1, 1), (-1, 1)] {
                let c = CGPoint(x: hx * w / 2, y: hy * h / 2)
                box.fill(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)), with: .color(.white))
            }

            // The angle it landed on, in a small dark capsule like iOS's own
            // readouts.
            if snapped.rotation {
                let label = Text("\(Int(layer.props.rotation.at(t).rounded()))°")
                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                let resolved = ctx.resolve(label)
                let text = resolved.measure(in: size)
                let pill = CGRect(x: layer.props.x.at(t) * size.width - (text.width + 20) / 2,
                                  y: layer.props.y.at(t) * size.height - 13, width: text.width + 20, height: 26)
                ctx.fill(Path(roundedRect: pill, cornerRadius: 13), with: .color(Color(white: 0.11).opacity(0.82)))
                ctx.draw(resolved, at: CGPoint(x: pill.midX, y: pill.midY))
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
