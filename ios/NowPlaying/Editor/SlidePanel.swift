import SwiftUI

/*
 Slide: what the whole picture is. The background, which pieces are on it,
 and the list of layers. Anything belonging to one layer lives on Layer.
*/

struct SlidePanel: View {
    let engine: EditorEngine
    @Environment(AppModel.self) private var model

    private enum Background: String, CaseIterable, Identifiable {
        case photo, blur, solid
        var id: String { rawValue }
        var label: String {
            switch self {
            case .photo: return "Photo"
            case .blur: return "Blurred"
            case .solid: return "Colour"
            }
        }
    }

    var body: some View {
        if let project = model.project, let photoIndex = project.photoIndex {
            let photo = project.layers[photoIndex]
            let background: Background = photo.props.mode == .solid ? .solid
                : photo.effects.contains { $0.type == .blur } ? .blur : .photo

            Section("Background") {
                Picker("Background", selection: Binding(get: { background }, set: { set($0, photoID: photo.id) })) {
                    ForEach(Background.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                .listRowSeparator(.hidden)

                if background == .blur, let index = photo.effects.firstIndex(where: { $0.type == .blur }) {
                    let spec = EffectType.blur.params[0]
                    KeyedSlider(engine: engine, label: "Blur amount", paths: [.effect(photo.id, index, "radius")],
                                range: spec.min...spec.max, step: spec.step, fallback: spec.defaultValue,
                                format: { String(Int($0)) })
                }
                if background == .solid {
                    swatches(project, photo)
                } else {
                    KeyedSlider(engine: engine, label: "Black and white", paths: [.layer(photo.id, .mono)],
                                range: 0...1, step: 0.01, fallback: 0, format: percent)
                }
            }

            let card = project.layers.first { $0.type == .card }
            let colourWindow = project.layers.first { $0.type == .window }
            Section {
                Toggle("Cover", isOn: model.binding(\.showCover, true))
                Toggle("Glass card", isOn: Binding(get: { card != nil }, set: { on in model.edit { setCard(&$0, on: on) } }))
                if let card {
                    Button("Edit Glass Card") { engine.pick(card.id) }
                }
                if let colourWindow {
                    Button("Edit Colour Window") { engine.pick(colourWindow.id) }
                }
                Toggle("Move together", isOn: model.binding(\.grouped, true))
            } header: {
                Text("On the slide")
            } footer: {
                Text("With Move together on, everything on the photo moves and resizes as one.")
            }

            LayerList(engine: engine)

            Section {
                Button {
                    Task { await model.saveStyle() }
                } label: {
                    Label("Save Look as Style", systemImage: "swatchpalette")
                }
            } footer: {
                Text("A style keeps the look without the photo or the song, ready for your next slide.")
            }
        }
    }

    private func set(_ value: Background, photoID: String) {
        model.edit { project in
            guard let i = project.index(of: photoID) else { return }
            project.layers[i].props.mode = value == .solid ? .solid : .photo
            project.layers[i].effects.removeAll { $0.type == .blur }
            if value == .blur { project.layers[i].effects.insert(Effect(type: .blur, params: ["radius": 34]), at: 0) }
            if value == .solid && project.layers[i].props.solidColor == nil {
                project.layers[i].props.solidColor = asRoomColour(project.palette.first ?? "#2A2724")
            }
        }
    }

    /// Colours pulled from the cover and the photo, dimmed to sit behind
    /// things. Dimmed first, then merged: pulling colours down to the same
    /// darkness is what makes near-copies out of colours that started apart.
    private func swatches(_ project: Project, _ photo: Layer) -> some View {
        let source = project.palette.isEmpty ? ["#2A2724"] : project.palette
        let colours = dedupeHex(source.map { asRoomColour($0) }, minDistance: 14)
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(colours, id: \.self) { hex in
                    let on = photo.props.solidColor == hex
                    Button {
                        model.edit { project in
                            if let i = project.index(of: photo.id) { project.layers[i].props.solidColor = hex }
                        }
                    } label: {
                        Circle()
                            .fill(Color(cgColor: cgColor(hex)))
                            .frame(width: 36, height: 36)
                            .overlay(Circle().strokeBorder(Color.primary.opacity(0.15), lineWidth: 1))
                            .padding(3)
                            .overlay(Circle().strokeBorder(on ? Color.accentColor : .clear, lineWidth: 2.5))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Background colour \(hex)")
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
            .padding(.vertical, 4)
        }
    }
}

/// The layers, topmost first, each with its eye and lock.
struct LayerList: View {
    let engine: EditorEngine
    @Environment(AppModel.self) private var model

    var body: some View {
        if let project = model.project {
            Section {
                ForEach(project.layers.reversed()) { layer in
                    row(layer)
                }
            } header: {
                HStack {
                    Text("Layers")
                    Spacer()
                    Text("\(project.layers.count)").monospacedDigit()
                }
            }
        }
    }

    private func row(_ layer: Layer) -> some View {
        let selected = layer.id == model.selectedLayerId
        let sub = [layer.type.label != layer.name ? layer.type.label : nil,
                   layer.effects.isEmpty ? nil : "\(layer.effects.count) effect\(layer.effects.count > 1 ? "s" : "")"]
            .compactMap { $0 }.joined(separator: " · ")
        return HStack(spacing: 4) {
            Button {
                engine.pick(layer.locked ? nil : layer.id)
            } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text(layer.name)
                        .fontWeight(selected ? .semibold : .regular)
                        .foregroundStyle(selected ? Color.accentColor : Color.primary)
                    if !sub.isEmpty {
                        Text(sub).font(.footnote).foregroundStyle(.secondary)
                    }
                }
                .opacity(layer.visible ? 1 : 0.45)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Button {
                model.edit { project in
                    if let i = project.index(of: layer.id) { project.layers[i].visible.toggle() }
                }
            } label: {
                Image(systemName: layer.visible ? "eye" : "eye.slash")
                    .frame(width: 40, height: 40)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(layer.visible ? "Hide \(layer.name)" : "Show \(layer.name)")

            Button {
                if !layer.locked && model.selectedLayerId == layer.id { model.selectedLayerId = nil }
                model.edit { project in
                    if let i = project.index(of: layer.id) { project.layers[i].locked.toggle() }
                }
            } label: {
                Image(systemName: layer.locked ? "lock.fill" : "lock.open")
                    .frame(width: 40, height: 40)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(layer.locked ? "Unlock \(layer.name)" : "Lock \(layer.name)")
        }
        .listRowBackground(selected ? Color.accentColor.opacity(0.12) : nil)
    }
}
