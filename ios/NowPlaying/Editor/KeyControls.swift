import SwiftUI

/*
 KEYFRAMES ON THE PANEL
 A track is one or more values keyframed together: a blur radius alone, or x
 and y for a position, across every layer moving with the selection. The
 diamond adds a keyframe at the playhead or takes away the one there. The
 strip shows the keyframes along the loop: tap empty space to add one, tap
 one to go to it and pick it, drag one to move it in time.
*/

/// A labelled slider with its value read out on the right.
struct ValueSlider<Trailing: View>: View {
    let label: String
    @Binding var value: Double
    let range: ClosedRange<Double>
    let step: Double
    let format: (Double) -> String
    var onEditing: (Bool) -> Void = { _ in }
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Text(label)
                Spacer(minLength: 8)
                Text(format(value))
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
                trailing()
            }
            Slider(value: $value, in: range, step: step, onEditingChanged: onEditing)
                .accessibilityLabel(label)
                .accessibilityValue(format(value))
        }
        .padding(.vertical, 2)
    }
}

extension ValueSlider where Trailing == EmptyView {
    init(label: String, value: Binding<Double>, range: ClosedRange<Double>, step: Double,
         format: @escaping (Double) -> String, onEditing: @escaping (Bool) -> Void = { _ in }) {
        self.init(label: label, value: value, range: range, step: step, format: format, onEditing: onEditing) { EmptyView() }
    }
}

func percent(_ v: Double) -> String { "\(Int((v * 100).rounded()))%" }

/// The diamond beside a value: filled when there is a keyframe right here.
struct KeyDiamond: View {
    let engine: EditorEngine
    let label: String
    let paths: [PropPath]
    var fallback: Double = 0
    @Environment(AppModel.self) private var model
    @State private var taps = 0

    var body: some View {
        let on = paths.first.map { keyIndex(model.project?[$0], at: model.time) != nil } ?? false
        Button {
            engine.toggleKeys(paths, fallback: fallback)
            taps += 1
        } label: {
            Image(systemName: on ? "diamond.fill" : "diamond")
                .font(.body)
                .frame(width: 36, height: 36)
                .contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
        // On the tap only: the playhead passing a keyframe is not a reason to buzz.
        .sensoryFeedback(.impact(weight: .light), trigger: taps)
        .accessibilityLabel(on ? "Remove the \(label) keyframe here" : "Add a \(label) keyframe here")
    }
}

/// A slider whose value can be keyframed: one value, or several moved
/// together, such as the opacity of a whole group.
struct KeyedSlider: View {
    let engine: EditorEngine
    let label: String
    let paths: [PropPath]
    let range: ClosedRange<Double>
    let step: Double
    let fallback: Double
    let format: (Double) -> String
    @Environment(AppModel.self) private var model

    var body: some View {
        let value = Binding<Double>(
            get: { paths.first.flatMap { model.project?[$0]?.at(model.time) } ?? fallback },
            set: { engine.setValues($0, paths) }
        )
        VStack(alignment: .leading, spacing: 6) {
            ValueSlider(label: label, value: value, range: range, step: step, format: format) {
                KeyDiamond(engine: engine, label: label, paths: paths, fallback: fallback)
            }
            KeyStrip(engine: engine, label: label, paths: paths, fallback: fallback)
        }
    }
}

/// A row with no slider: a name, its diamond, and its strip.
struct KeyTrackRow: View {
    let engine: EditorEngine
    let label: String
    let paths: [PropPath]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(label)
                Spacer()
                KeyDiamond(engine: engine, label: label, paths: paths)
            }
            KeyStrip(engine: engine, label: label, paths: paths, fallback: 0)
        }
    }
}

/// The keyframes of a track along the loop. Hidden until there are any.
struct KeyStrip: View {
    let engine: EditorEngine
    let label: String
    let paths: [PropPath]
    let fallback: Double
    @Environment(AppModel.self) private var model
    @State private var drag: (at: Double, carried: [PickedKey])?
    @State private var space = UUID()

    private var lead: Prop? { paths.first.flatMap { model.project?[$0] } }

    var body: some View {
        if let lead, lead.isKeyed {
            let loop = engine.loop
            let pickedHere = engine.picked.contains { key in paths.contains(key.path) }
            HStack(spacing: 8) {
                GeometryReader { geo in
                    let width = geo.size.width
                    ZStack(alignment: .leading) {
                        Capsule()
                            .fill(Color(.tertiarySystemFill))
                            .contentShape(Rectangle())
                            .gesture(SpatialTapGesture().onEnded { add(at: $0.location.x / width) })
                        // The playhead.
                        Rectangle()
                            .fill(Color.accentColor.opacity(0.6))
                            .frame(width: 2)
                            .offset(x: min(width - 2, max(0, model.time / loop * width - 1)))
                            .allowsHitTesting(false)
                        ForEach(Array(lead.frames.enumerated()), id: \.offset) { _, frame in
                            mark(frame, width: width, loop: loop)
                        }
                    }
                    .coordinateSpace(.named(space))
                }
                .frame(height: 30)
                if pickedHere {
                    Button(role: .destructive) {
                        engine.deletePicked()
                    } label: {
                        Image(systemName: "trash")
                            .frame(width: 36, height: 30)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Delete the picked \(label) keyframe")
                }
            }
            .transition(.opacity)
        }
    }

    private func framesAt(_ t: Double) -> [PickedKey] {
        paths.compactMap { path in
            guard let i = keyIndex(model.project?[path], at: t), let frame = model.project?[path]?.frames[i] else { return nil }
            return PickedKey(path: path, t: frame.t)
        }
    }

    /// A tap where there is no keyframe makes one there, holding the value
    /// as it is at that moment, and picks it.
    private func add(at fraction: Double) {
        let t = (min(1, max(0, fraction)) * engine.loop * 10).rounded() / 10
        engine.pause()
        model.edit { project in
            for path in paths where keyIndex(project[path], at: t) == nil {
                var prop = project[path]
                toggleKey(&prop, at: t, fallback: fallback)
                project[path] = prop
            }
        }
        engine.seek(t)
        engine.picked = framesAt(t)
    }

    private func mark(_ frame: Keyframe, width: Double, loop: Double) -> some View {
        let picked = engine.picked.contains { $0.t == frame.t && $0.path == paths.first }
        return Image(systemName: "diamond.fill")
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(picked ? Color.accentColor : Color.primary.opacity(0.75))
            .scaleEffect(picked ? 1.25 : 1)
            .frame(width: 30, height: 30)
            .contentShape(Rectangle())
            .offset(x: min(width, max(0, frame.t / loop * width)) - 15)
            .gesture(
                DragGesture(minimumDistance: 0, coordinateSpace: .named(space))
                    .onChanged { value in
                        // It follows the finger once it moves; a touch that
                        // never moves is a tap.
                        if drag == nil {
                            engine.pause()
                            drag = (frame.t, framesAt(frame.t))
                        }
                        guard abs(value.translation.width) >= 4, let current = drag else { return }
                        let to = (min(1, max(0, value.location.x / width)) * loop * 10).rounded() / 10
                        guard to != current.at else { return }
                        move(current.carried, to: to)
                        drag = (to, current.carried.map { PickedKey(path: $0.path, t: to) })
                        engine.seek(to)
                    }
                    .onEnded { value in
                        guard let current = drag else { return }
                        drag = nil
                        if abs(value.translation.width) < 4 {
                            // A tap picks it and goes to it.
                            engine.seek(current.at)
                            engine.picked = current.carried
                        } else {
                            // Dropped onto another keyframe: the one carried
                            // there replaces it.
                            settle(current.carried)
                            engine.picked = current.carried
                        }
                    }
            )
            .accessibilityLabel("\(label) keyframe at \(String(format: "%.1f", frame.t)) seconds")
            .accessibilityHint("Tap to pick, drag to move")
    }

    private func move(_ carried: [PickedKey], to: Double) {
        model.edit { project in
            for key in carried {
                guard case .keyframes(var frames)? = project[key.path],
                      let i = frames.firstIndex(where: { $0.t == key.t }) else { continue }
                frames[i].t = to
                frames.sort { $0.t < $1.t }
                project[key.path] = .keyframes(frames)
            }
        }
    }

    private func settle(_ carried: [PickedKey]) {
        model.edit { project in
            for key in carried {
                guard case .keyframes(let frames)? = project[key.path],
                      let mine = frames.firstIndex(where: { $0.t == key.t }) else { continue }
                let kept = frames.enumerated().filter { $0.offset == mine || abs($0.element.t - key.t) >= sameMoment }
                project[key.path] = .keyframes(kept.map(\.element))
            }
        }
    }
}
