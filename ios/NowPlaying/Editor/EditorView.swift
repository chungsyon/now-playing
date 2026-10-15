import SwiftUI

/*
 EDITOR
 ------
 The preview at the top, a loop bar under it, and a panel of controls at the
 bottom. The preview is drawn smaller than the export by the same render
 function, so what you line up here is what comes out.
*/

struct EditorView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var engine: EditorEngine

    init(model: AppModel) {
        _engine = State(initialValue: EditorEngine(model: model))
    }

    var body: some View {
        Group {
            if model.project != nil {
                content(engine)
            } else {
                Color(.systemGroupedBackground)
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbarRole(.editor)
        .toolbar { toolbar(engine) }
        .onAppear { engine.appear(reduceMotion: reduceMotion) }
        .onDisappear { engine.disappear() }
    }

    private func content(_ engine: EditorEngine) -> some View {
        GeometryReader { geo in
            VStack(spacing: 0) {
                PreviewArea(engine: engine)
                    .frame(maxHeight: .infinity)
                Transport(engine: engine)
                Panel(engine: engine)
                    // The panel takes a fixed share; the slide gets the rest
                    // and is always fully visible above it.
                    .frame(height: max(260, geo.size.height * 0.46))
            }
        }
        .background(Color(.systemGroupedBackground))
    }

    @ToolbarContentBuilder
    private func toolbar(_ engine: EditorEngine) -> some ToolbarContent {
        // Undo and redo sit by the back button, where a thumb already is.
        ToolbarItemGroup(placement: .topBarLeading) {
            Button { model.undo() } label: { Image(systemName: "arrow.uturn.backward") }
                .disabled(!model.canUndo)
                .keyboardShortcut("z", modifiers: .command)
                .accessibilityLabel("Undo")
            Button { model.redo() } label: { Image(systemName: "arrow.uturn.forward") }
                .disabled(!model.canRedo)
                .keyboardShortcut("z", modifiers: [.command, .shift])
                .accessibilityLabel("Redo")
        }
        ToolbarItem(placement: .principal) {
            TemplateMenu(engine: engine)
        }
        ToolbarItem(placement: .topBarTrailing) {
            Button("Export") {
                engine.pause()
                model.path.append(.export)
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.capsule)
        }
    }
}

/// Five names do not fit beside undo, redo and Export, so a pop-up menu.
/// A new template rebuilds the layers; Undo brings the old ones back.
private struct TemplateMenu: View {
    let engine: EditorEngine
    @Environment(AppModel.self) private var model

    var body: some View {
        let current = model.project?.template ?? .vinyl
        Menu {
            Picker("Template", selection: Binding(get: { current }, set: { next in
                // Picking the template already in use is not a request to start over.
                guard next != current else { return }
                model.edit { project in
                    project.applyTemplate(next)
                    fitToSlide(&project)
                }
                model.selectedLayerId = nil
            })) {
                ForEach(TemplateID.allCases) { template in
                    Text(template.label).tag(template)
                }
            }
        } label: {
            HStack(spacing: 4) {
                Text(current.label).font(.headline)
                Image(systemName: "chevron.down").font(.caption.weight(.bold))
            }
            .foregroundStyle(Color.primary)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Capsule().fill(Color(.tertiarySystemFill)))
        }
        .accessibilityLabel("Template, \(current.label)")
    }
}

/// The slide, sized to fit the room left over, and zoomable.
private struct PreviewArea: View {
    let engine: EditorEngine
    @Environment(AppModel.self) private var model
    @Environment(\.displayScale) private var displayScale
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        GeometryReader { geo in
            if let project = model.project {
                let ratio = Double(project.aspect.h) / Double(project.aspect.w)
                let roomW = min(geo.size.width - 32, 560)
                let roomH = max(120, geo.size.height - 24)
                let base = floor(min(roomW, roomH / ratio))
                let size = CGSize(width: base * engine.zoom, height: (base * ratio * engine.zoom).rounded())
                ZStack {
                    PreviewSurface(engine: engine)
                        .frame(width: size.width, height: size.height)
                        .overlay(SelectionOverlay(engine: engine))
                        .shadow(color: .black.opacity(colorScheme == .dark ? 0 : 0.12), radius: 12, y: 4)
                        .offset(engine.pan)
                }
                .frame(width: geo.size.width, height: geo.size.height)
                .clipped()
                .onAppear { engine.setViewSize(size, scale: displayScale) }
                .onChange(of: size) { _, new in engine.setViewSize(new, scale: displayScale) }
                .animation(.spring(response: 0.35, dampingFraction: 1), value: engine.zoom)
            }
        }
        .background(colorScheme == .dark ? Color(white: 0.04) : Color(red: 0.9, green: 0.9, blue: 0.92))
    }
}

/// Play and pause, the loop as a scrubber, the size, and the zoom.
private struct Transport: View {
    let engine: EditorEngine
    @Environment(AppModel.self) private var model

    var body: some View {
        HStack(spacing: 10) {
            Button {
                engine.togglePlay()
            } label: {
                Image(systemName: engine.playing ? "pause.fill" : "play.fill")
                    .font(.title3)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(engine.playing ? "Pause the loop" : "Play the loop")

            Text(String(format: "%.1f", model.time))
                .font(.footnote.monospacedDigit())
                .foregroundStyle(.secondary)
                .frame(width: 34, alignment: .trailing)

            Scrubber(engine: engine)

            Text(String(format: "%.1f", engine.loop))
                .font(.footnote.monospacedDigit())
                .foregroundStyle(.secondary)
                .frame(width: 34, alignment: .leading)

            if let aspect = model.project?.aspect {
                Text("\(aspect.w)×\(aspect.h)")
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
                    .fixedSize()
            }

            HStack(spacing: 0) {
                Button { engine.zoom(by: -1) } label: { Image(systemName: "minus").frame(width: 30, height: 32) }
                    .disabled(engine.zoom == 1)
                    .accessibilityLabel("Zoom out")
                Text("\(Int(engine.zoom * 100))%")
                    .font(.caption.monospacedDigit())
                    .frame(minWidth: 38)
                Button { engine.zoom(by: 1) } label: { Image(systemName: "plus").frame(width: 30, height: 32) }
                    .disabled(engine.zoom == EditorEngine.zooms.last)
                    .accessibilityLabel("Zoom in")
            }
            .buttonStyle(.borderless)
            .background(Capsule().fill(Color(.tertiarySystemFill)))
        }
        .padding(.horizontal, 12)
        .frame(height: 52)
    }
}

/// The loop position, like a player's scrubber. The finger is followed from
/// the moment it lands, and keeps being followed if it slides off.
private struct Scrubber: View {
    let engine: EditorEngine
    @Environment(AppModel.self) private var model
    @GestureState private var held = false

    var body: some View {
        GeometryReader { geo in
            let fraction = min(1, max(0, model.time / max(0.1, engine.loop)))
            ZStack(alignment: .leading) {
                Capsule().fill(Color(.systemFill))
                Capsule().fill(Color.accentColor)
                    .frame(width: max(held ? 8 : 6, geo.size.width * fraction))
            }
            .frame(height: held ? 8 : 6)
            .frame(maxHeight: .infinity)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .updating($held) { _, state, _ in state = true }
                    .onChanged { value in
                        engine.seek(min(1, max(0, value.location.x / max(1, geo.size.width))) * engine.loop)
                    }
            )
            .animation(.spring(response: 0.25, dampingFraction: 1), value: held)
        }
        .frame(height: 44)
        .accessibilityElement()
        .accessibilityLabel("Loop position")
        .accessibilityValue(String(format: "%.1f of %.1f seconds", model.time, engine.loop))
        .accessibilityAdjustableAction { direction in
            let step = engine.loop / 20
            engine.seek(model.time + (direction == .increment ? step : -step))
        }
    }
}

/// The panel: a segmented switch over a grouped list.
private struct Panel: View {
    let engine: EditorEngine

    var body: some View {
        @Bindable var engine = engine
        VStack(spacing: 0) {
            Picker("Controls", selection: $engine.tab) {
                ForEach(EditorEngine.Tab.allCases) { Text($0.label).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)

            List {
                switch engine.tab {
                case .slide: SlidePanel(engine: engine)
                case .layer: LayerPanel(engine: engine)
                case .motion: MotionPanel(engine: engine)
                case .song: SongPanel(engine: engine)
                }
            }
            .listStyle(.insetGrouped)
            .listSectionSpacing(.compact)
            .scrollDismissesKeyboard(.interactively)
            .contentMargins(.top, 4, for: .scrollContent)
        }
        .background(Color(.systemGroupedBackground))
        .overlay(alignment: .top) { Divider() }
    }
}
