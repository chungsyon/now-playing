import SwiftUI

/*
 Layer: everything about the one thing selected, in the order it is usually
 wanted: what it is, then how it moves, then its effects.
*/

struct LayerPanel: View {
    let engine: EditorEngine
    @Environment(AppModel.self) private var model

    var body: some View {
        if let project = model.project, let layer = model.selectedLayer, !layer.locked, layer.type != .photo {
            Section {
                HStack {
                    Button {
                        engine.pick(nil)
                    } label: {
                        Label("All Layers", systemImage: "chevron.left")
                    }
                    .buttonStyle(.borderless)
                    Spacer()
                    Text(layer.name).font(.headline)
                }
            }

            if layer.type == .text { TextSection(engine: engine, layer: layer) }
            if layer.type.isPane { PaneSections(engine: engine, layer: layer) }
            AnimateSection(engine: engine, layer: layer, project: project)
            EffectsSection(engine: engine, layer: layer)
        } else {
            Section {
                Text("Tap something on the slide, or pick it here.")
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
            }
            LayerList(engine: engine)
        }
    }
}

/// The words: which face, how heavy, and for a line of its own, what it says.
private struct TextSection: View {
    let engine: EditorEngine
    let layer: Layer
    @Environment(AppModel.self) private var model

    var body: some View {
        let p = layer.props
        Section("Text") {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(FontChoice.allCases) { face in
                        let on = (p.font ?? .sans) == face
                        Button {
                            edit { $0.font = face }
                        } label: {
                            // Each name is set in its own face.
                            Text(face.label)
                                .font(Font(SlideFonts.font(face, weight: 500, size: 16)))
                                .padding(.horizontal, 14)
                                .frame(height: 36)
                                .background(Capsule().fill(on ? Color.accentColor.opacity(0.15) : Color(.tertiarySystemFill)))
                                .overlay(Capsule().strokeBorder(on ? Color.accentColor : .clear, lineWidth: 1.5))
                                .foregroundStyle(on ? Color.accentColor : Color.primary)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(face.label) font")
                        .accessibilityAddTraits(on ? .isSelected : [])
                    }
                }
                .padding(.vertical, 2)
            }

            if p.bind == nil {
                TextField("Text", text: Binding(get: { p.text ?? "" }, set: { value in edit { $0.text = value } }))
            }
            ValueSlider(label: "Weight",
                        value: Binding(get: { p.weight ?? (p.bind == .artist ? 600 : 400) }, set: { value in edit { $0.weight = value } }),
                        range: 300...800, step: 100, format: { String(Int($0)) })
            Toggle("Capitals", isOn: Binding(get: { p.uppercase == true }, set: { on in edit { $0.uppercase = on } }))
        }
    }

    private func edit(_ change: @escaping (inout LayerProps) -> Void) {
        model.edit { project in
            if let i = project.index(of: layer.id) { change(&project.layers[i].props) }
        }
    }
}

/// A pane's size and shape, and for glass its blur and grain.
private struct PaneSections: View {
    let engine: EditorEngine
    let layer: Layer
    @Environment(AppModel.self) private var model

    var body: some View {
        let glass = layer.type == .card
        let art = layer.type == .artPanel
        // The colour window measures roundness against its shorter side; the
        // card and the art panel against their width.
        let widthBased = glass || art
        let id = layer.id

        Section("Shape") {
            HStack(spacing: 10) {
                ForEach(CornerShape.allCases) { shape in
                    let on = (layer.props.corners ?? .round) == shape
                    Button {
                        model.edit { project in
                            if let i = project.index(of: id) { project.layers[i].props.corners = shape }
                        }
                    } label: {
                        let c = shape.corners.map { CGFloat($0 * 7) }
                        UnevenRoundedRectangle(topLeadingRadius: c[0], bottomLeadingRadius: c[3],
                                               bottomTrailingRadius: c[2], topTrailingRadius: c[1])
                            .fill(on ? Color.accentColor : Color.secondary.opacity(0.5))
                            .frame(width: 26, height: 34)
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .background(RoundedRectangle(cornerRadius: 10).fill(Color(.tertiarySystemFill)))
                            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(on ? Color.accentColor : .clear, lineWidth: 2))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(shape.label)
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
            KeyedSlider(engine: engine, label: "Width", paths: [.layer(id, .scale)], range: 0.15...1.2, step: 0.005,
                        fallback: glass ? 0.72 : art ? 0.86 : 0.46, format: percent)
            KeyedSlider(engine: engine, label: "Height", paths: [.layer(id, .ratio)], range: 0.2...2.5, step: 0.01,
                        fallback: glass ? 1.2 : art ? 0.5 : 1.45, format: { "\(Int(($0 * 100).rounded()))% of width" })
            // Past a quarter of the width the curve eats into what is on a card.
            if widthBased {
                KeyedSlider(engine: engine, label: "Roundness", paths: [.layer(id, .radius)], range: 0...0.25, step: 0.0025,
                            fallback: art ? 0.09 : 0.075, format: { "\(Int(($0 * 400).rounded()))%" })
            } else {
                KeyedSlider(engine: engine, label: "Roundness", paths: [.layer(id, .radius)], range: 0...0.5, step: 0.005,
                            fallback: 0.06, format: { "\(Int(($0 * 200).rounded()))%" })
            }
        }
        if glass {
            Section("Glass") {
                KeyedSlider(engine: engine, label: "Blur", paths: [.layer(id, .blur)], range: 0...80, step: 1,
                            fallback: 12, format: { String(Int($0)) })
                KeyedSlider(engine: engine, label: "Frost grain", paths: [.layer(id, .grain)], range: 0...1, step: 0.01,
                            fallback: 0.5, format: percent)
            }
        }
        if art {
            Section("Cover") {
                KeyedSlider(engine: engine, label: "Darken", paths: [.layer(id, .dim)], range: 0...0.8, step: 0.01,
                            fallback: 0.35, format: percent)
            }
        }
    }
}

/// Keyframes for where the layer is, its size, angle and opacity, across
/// everything that moves with it. The selected layer leads.
private struct AnimateSection: View {
    let engine: EditorEngine
    let layer: Layer
    let project: Project

    var body: some View {
        let members = [layer] + project.movesWith(layer).filter { $0.id != layer.id }
        let paths = { (keys: [NumKey]) in members.flatMap { m in keys.map { PropPath.layer(m.id, $0) } } }
        Section {
            KeyTrackRow(engine: engine, label: "Position", paths: paths([.x, .y]))
            KeyTrackRow(engine: engine, label: "Size", paths: paths([.scale]))
            KeyTrackRow(engine: engine, label: "Rotation", paths: paths([.rotation]))
            KeyedSlider(engine: engine, label: "Opacity", paths: paths([.opacity]), range: 0...1, step: 0.01,
                        fallback: 1, format: percent)
        } header: {
            HStack {
                Text("Animate")
                Spacer()
                if members.count > 1 { Text("with the group") }
            }
        } footer: {
            Text("Tap ◆ or a strip to add a keyframe at the playhead, then move the layer. Tap a keyframe to pick it; the bin removes it.")
        }
    }
}

/// Effects run top down. Each one's sliders come from the effect registry.
private struct EffectsSection: View {
    let engine: EditorEngine
    let layer: Layer
    @Environment(AppModel.self) private var model

    var body: some View {
        ForEach(Array(layer.effects.enumerated()), id: \.offset) { index, effect in
            Section {
                ForEach(effect.type.params, id: \.key) { spec in
                    KeyedSlider(engine: engine, label: spec.label, paths: [.effect(layer.id, index, spec.key)],
                                range: spec.min...spec.max, step: spec.step, fallback: spec.defaultValue,
                                format: { spec.step < 1 ? String(format: "%.2f", $0) : String(Int($0)) })
                }
            } header: {
                HStack(spacing: 4) {
                    Text(index == 0 ? "Effects · \(effect.type.label)" : effect.type.label)
                    Spacer()
                    if index > 0 {
                        iconButton("chevron.up", "Move \(effect.type.label) earlier") { move(index, -1) }
                    }
                    if index < layer.effects.count - 1 {
                        iconButton("chevron.down", "Move \(effect.type.label) later") { move(index, 1) }
                    }
                    iconButton("xmark", "Remove \(effect.type.label)") {
                        model.edit { project in
                            if let i = project.index(of: layer.id) { project.layers[i].effects.remove(at: index) }
                        }
                    }
                }
            }
        }
        Section {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(EffectType.allCases) { type in
                        Button {
                            model.edit { project in
                                if let i = project.index(of: layer.id) { project.layers[i].effects.append(Effect(type: type)) }
                            }
                        } label: {
                            Label(type.label, systemImage: "plus")
                                .padding(.horizontal, 14)
                                .frame(height: 36)
                                .background(Capsule().fill(Color(.tertiarySystemFill)))
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(Color.accentColor)
                    }
                }
            }
        } header: {
            Text(layer.effects.isEmpty ? "Effects" : "Add an effect")
        }
    }

    private func iconButton(_ symbol: String, _ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).frame(width: 32, height: 28)
        }
        .buttonStyle(.borderless)
        .accessibilityLabel(label)
    }

    private func move(_ index: Int, _ direction: Int) {
        model.edit { project in
            guard let i = project.index(of: layer.id) else { return }
            let target = index + direction
            guard project.layers[i].effects.indices.contains(target) else { return }
            project.layers[i].effects.swapAt(index, target)
        }
    }
}
