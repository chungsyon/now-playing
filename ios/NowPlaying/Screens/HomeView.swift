import PhotosUI
import SwiftUI

/*
 HOME
 ----
 Start a slide from a photo, choose its shape, or pick up a draft or a
 saved style.
*/

struct HomeView: View {
    @Environment(AppModel.self) private var model
    @State private var photoItem: PhotosPickerItem?
    @State private var pendingStyle: Style?
    @State private var pickingForStyle = false
    @State private var styleItem: PhotosPickerItem?
    @State private var loading = false
    @State private var showingAbout = false

    private let ratios: [(id: String, label: String)] =
        [("photo", "Original")] + namedAspects.map { ($0.id, $0.id) } + [("custom", "Custom")]

    var body: some View {
        @Bindable var model = model
        List {
            Section {
                VStack(spacing: 14) {
                    Image(systemName: "music.note")
                        .font(.system(size: 30, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 64, height: 64)
                        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.accentColor.gradient))
                        .accessibilityHidden(true)
                    VStack(spacing: 6) {
                        Text("Make a now playing slide")
                            .font(.title3.weight(.semibold))
                        Text("The second slide of a carousel: silent, looping, and it shows a song is on.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    PhotosPicker(selection: $photoItem, matching: .images, photoLibrary: .shared()) {
                        Label(loading ? "Opening…" : "Choose a Photo", systemImage: "photo")
                            .font(.body.weight(.semibold))
                            .frame(maxWidth: .infinity, minHeight: 34)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(loading)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
            }

            Section {
                Picker("Slide shape", selection: $model.aspectPreference) {
                    ForEach(ratios, id: \.id) { Text($0.label).tag($0.id) }
                }
                .pickerStyle(.segmented)
                if model.aspectPreference == "custom" {
                    HStack {
                        Text("Height")
                        Spacer()
                        TextField("1350", value: $model.customHeight, format: .number)
                            .keyboardType(.numberPad)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 80)
                        Text("px").foregroundStyle(.secondary)
                    }
                }
            } header: {
                Text("Slide shape")
            } footer: {
                Text(model.aspectPreference == "photo"
                     ? "The slide takes the shape of your photo, so the two sit together in the carousel."
                     : model.aspectPreference == "custom"
                     ? "The width is always 1080 pixels; the height can be 600 to 1920."
                     : "1080 pixels wide, \(model.aspectPreference).")
            }

            Section {
                if model.drafts.isEmpty {
                    Text("No drafts yet. Your work saves here as you go.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(model.drafts) { draft in
                        DraftRow(draft: draft)
                            .swipeActions {
                                Button("Discard", role: .destructive) {
                                    Task { await model.deleteDraft(draft.id) }
                                }
                            }
                            .contextMenu {
                                Button("Discard", systemImage: "trash", role: .destructive) {
                                    Task { await model.deleteDraft(draft.id) }
                                }
                            }
                    }
                }
            } header: {
                HStack {
                    Text("Drafts")
                    Spacer()
                    if !model.drafts.isEmpty {
                        Text("\(model.drafts.count) \(model.drafts.count == 1 ? "draft" : "drafts")")
                    }
                }
            }

            Section {
                if model.styles.isEmpty {
                    Text("Save a look from the editor and it will wait here.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(model.styles) { style in
                        Button {
                            pendingStyle = style
                            pickingForStyle = true
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(style.name).foregroundStyle(Color.primary)
                                Text("\(style.project.template.label) · \(when(style.updatedAt))")
                                    .font(.footnote)
                                    .foregroundStyle(Color.secondary)
                            }
                        }
                        .swipeActions {
                            Button("Remove", role: .destructive) {
                                Task { await model.deleteStyle(style.id) }
                            }
                        }
                    }
                }
            } header: {
                HStack {
                    Text("Your styles")
                    Spacer()
                    if !model.styles.isEmpty {
                        Text("\(model.styles.count) \(model.styles.count == 1 ? "style" : "styles")")
                    }
                }
            } footer: {
                if !model.styles.isEmpty { Text("Tap a style, then choose a photo to wear it.") }
            }
        }
        .navigationTitle("Now Playing")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showingAbout = true } label: { Image(systemName: "info.circle") }
                    .accessibilityLabel("About Now Playing")
            }
        }
        .sheet(isPresented: $showingAbout) { AboutView() }
        .task { await model.refreshLibrary() }
        .onChange(of: model.path.isEmpty) { _, home in
            if home { Task { await model.refreshLibrary() } }
        }
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            photoItem = nil
            Task { await open(item, style: nil) }
        }
        // A style has no photo, so wearing one starts by choosing a photo.
        .photosPicker(isPresented: $pickingForStyle, selection: $styleItem, matching: .images, photoLibrary: .shared())
        .onChange(of: styleItem) { _, item in
            guard let item, let style = pendingStyle else { return }
            styleItem = nil
            Task { await open(item, style: style) }
        }
    }

    private func open(_ item: PhotosPickerItem, style: Style?) async {
        loading = true
        defer { loading = false }
        guard let data = try? await item.loadTransferable(type: Data.self) else {
            model.toast("That photo didn't come through. Try another one.")
            return
        }
        await model.startWithPhoto(data, style: style)
    }
}

private struct DraftRow: View {
    let draft: DraftRecord
    @Environment(AppModel.self) private var model
    @State private var thumbnail: CGImage?

    var body: some View {
        Button {
            Task { await model.openDraft(draft.id) }
        } label: {
            HStack(spacing: 12) {
                CoverThumb(image: thumbnail, size: 52, radius: 8)
                VStack(alignment: .leading, spacing: 2) {
                    Text(draft.project.song.title.ifEmpty("No song yet"))
                        .foregroundStyle(Color.primary)
                        .lineLimit(1)
                    Text("\(draft.project.song.title.isEmpty ? "Waiting for a song" : draft.project.song.artist.ifEmpty("Unknown artist")) · \(when(draft.updatedAt))")
                        .font(.footnote)
                        .foregroundStyle(Color.secondary)
                        .lineLimit(1)
                }
                Spacer()
                Text("\(Int(draft.project.loopSeconds))s")
                    .font(.footnote.monospacedDigit())
                    .foregroundStyle(Color.secondary)
            }
        }
        .task(id: draft.id) { thumbnail = await model.photoThumbnail(draft.id) }
    }
}

/// "just now", "5 min ago", "yesterday".
func when(_ date: Date) -> String {
    let minutes = Int((Date().timeIntervalSince(date) / 60).rounded())
    if minutes < 1 { return "just now" }
    if minutes < 60 { return "\(minutes) min ago" }
    let hours = Int((Double(minutes) / 60).rounded())
    if hours < 24 { return "\(hours) h ago" }
    let days = Int((Double(hours) / 24).rounded())
    return days == 1 ? "yesterday" : "\(days) days ago"
}
