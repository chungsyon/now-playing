import CoreGraphics
import Foundation
import Observation
import SwiftUI

/*
 THE APP
 -------
 Holds the project you are working on, moves between the four screens, and
 saves to the device. Every change to the project goes through `edit`, which
 is what makes saving, undo and redrawing happen without each screen having
 to remember to.
*/

enum Route: Hashable {
    case song, editor, export
}

struct Toast: Equatable, Identifiable {
    let id = UUID()
    var message: String
}

@MainActor
@Observable
final class AppModel {
    var path: [Route] = []

    /// The open project. Change it through `edit` so it saves and can be undone.
    private(set) var project: Project?
    var draftId: String?
    var media = Media()
    @ObservationIgnored var photoData: Data?
    @ObservationIgnored var coverData: Data?

    var selectedLayerId: String?
    /// The moment the editor is showing, in seconds.
    var time: Double = 0

    // Home
    var aspectPreference = "photo"
    var customHeight = 1350

    // Song
    var lastQuery = ""
    /// Looking through results rather than looking at the chosen song.
    var browsing: Bool?

    var toast: Toast?
    var drafts: [DraftRecord] = []
    var styles: [Style] = []

    /// Told about every change, so the editor can redraw.
    @ObservationIgnored var onProjectChange: (() -> Void)?

    @ObservationIgnored private var photoPalette: [String] = []
    @ObservationIgnored private let store = DraftStore.shared
    @ObservationIgnored private var saveTask: Task<Void, Never>?
    @ObservationIgnored private var checkpointTask: Task<Void, Never>?

    // MARK: - Editing

    func edit(_ change: (inout Project) -> Void) {
        guard var next = project else { return }
        change(&next)
        guard next != project else { return }
        project = next
        changed()
    }

    private func changed() {
        scheduleSave()
        scheduleCheckpoint()
        onProjectChange?()
    }

    /// A two-way handle on one part of the project, for a control.
    func binding<T: Equatable>(_ path: WritableKeyPath<Project, T>, _ fallback: T) -> Binding<T> {
        Binding(
            get: { self.project?[keyPath: path] ?? fallback },
            set: { value in self.edit { $0[keyPath: path] = value } }
        )
    }

    var selectedLayer: Layer? { project?.layer(selectedLayerId) }

    func toast(_ message: String) {
        toast = Toast(message: message)
    }

    // MARK: - Undo and redo
    // The project is a value, so a step in the history is just a copy of it.
    // A copy is taken once things have been still for a moment, which makes
    // one drag or one slider pull a single step.

    @ObservationIgnored private var past: [Project] = []
    @ObservationIgnored private var future: [Project] = []
    var canUndo = false
    var canRedo = false

    private func resetHistory() {
        checkpointTask?.cancel()
        checkpointTask = nil
        past = project.map { [$0] } ?? []
        future = []
        syncHistory()
    }

    private func syncHistory() {
        canUndo = past.count >= 2
        canRedo = !future.isEmpty
    }

    private func scheduleCheckpoint() {
        checkpointTask?.cancel()
        checkpointTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            self?.checkpoint()
        }
    }

    private func checkpoint() {
        checkpointTask = nil
        guard let project, project != past.last else { return }
        past.append(project)
        if past.count > 100 { past.removeFirst() }
        future = []
        syncHistory()
    }

    private func flushCheckpoint() {
        guard let pending = checkpointTask else { return }
        pending.cancel()
        checkpoint()
    }

    func undo() {
        flushCheckpoint()
        guard past.count >= 2 else { return }
        future.append(past.removeLast())
        restore(past.last!)
    }

    func redo() {
        flushCheckpoint()
        guard let next = future.popLast() else { return }
        past.append(next)
        restore(next)
    }

    private func restore(_ snapshot: Project) {
        project = snapshot
        if snapshot.layer(selectedLayerId) == nil { selectedLayerId = nil }
        time = min(time, snapshot.loopSeconds)
        syncHistory()
        scheduleSave()
        onProjectChange?()
    }

    // MARK: - Saving

    private func scheduleSave() {
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(700))
            guard !Task.isCancelled else { return }
            await self?.saveNow()
        }
    }

    func saveNow() async {
        saveTask?.cancel()
        guard let project, let draftId else { return }
        do {
            try await store.saveProject(draftId, project)
        } catch {
            print("Could not save this draft:", error)
        }
    }

    /// Before the app goes into the background, nothing is left unsaved.
    func flush() {
        flushCheckpoint()
        Task { await saveNow() }
    }

    func refreshLibrary() async {
        drafts = await store.drafts()
        styles = await store.styles()
    }

    // MARK: - Starting and loading work

    /// H.264 needs both sides to be even numbers.
    private func even(_ n: Double) -> Int { Int((n / 2).rounded()) * 2 }

    private func aspectFor(_ image: CGImage) -> Aspect {
        if aspectPreference == "custom" {
            return Aspect(id: "custom", w: 1080, h: even(min(1920, max(600, Double(customHeight)))))
        }
        if let named = namedAspects.first(where: { $0.id == aspectPreference }) { return named }
        let height = even(min(1920, max(600, 1080 * Double(image.height) / Double(image.width))))
        return Aspect(id: "photo", w: 1080, h: height)
    }

    /// A new slide from a photo, optionally wearing a saved style.
    func startWithPhoto(_ data: Data, style: Style? = nil) async {
        guard let image = await Task.detached(priority: .userInitiated, operation: { ImageLoading.decode(data) }).value else {
            toast("That photo didn't come through. Try another one.")
            return
        }
        draftId = newId("d")
        photoData = data
        coverData = nil
        media = Media(photo: image, cover: nil)
        selectedLayerId = nil
        time = 0
        photoPalette = extractPalette(image)

        var next = Project(aspect: aspectFor(image))
        fitToSlide(&next)
        next.palette = photoPalette
        if let style {
            // A style has no photo, so this is starting fresh with the look
            // already in place. It may have been made on another shape.
            var styled = style.project
            styled.song = next.song
            styled.aspect = next.aspect
            styled.palette = next.palette
            fitToSlide(&styled, madeFor: style.project.layoutAspect ?? LayoutSize(w: style.project.aspect.w, h: style.project.aspect.h))
            next = styled
        }
        project = next
        resetHistory()
        browsing = nil
        lastQuery = ""
        do {
            try await store.saveMedia(draftId!, photo: data, cover: nil)
        } catch {
            print("Could not save the photo:", error)
        }
        await saveNow()
        path = [.song]
    }

    func openDraft(_ id: String) async {
        guard let found = await store.draft(id) else {
            toast("That draft is no longer here.")
            await refreshLibrary()
            return
        }
        let (photo, cover) = await Task.detached(priority: .userInitiated) {
            (ImageLoading.decode(found.photo), ImageLoading.decode(found.cover, maxPixels: 1600))
        }.value
        draftId = found.record.id
        project = found.record.project
        photoData = found.photo
        coverData = found.cover
        media = Media(photo: photo, cover: cover)
        selectedLayerId = nil
        time = 0
        photoPalette = photo.map { extractPalette($0) } ?? []
        refreshPalette()
        resetHistory()
        browsing = nil
        lastQuery = ""
        path = [.editor]
    }

    /// The colours offered for the record label and the flat background. The
    /// cover leads; the photo's colours follow, so a black-and-white sleeve
    /// still leaves a choice.
    private func refreshPalette() {
        guard project != nil else { return }
        let fromCover = media.cover.map { extractPalette($0) } ?? []
        project?.palette = dedupeHex(fromCover + photoPalette)
    }

    func setCover(_ data: Data?) async {
        let image = await Task.detached(priority: .userInitiated) { ImageLoading.decode(data, maxPixels: 1600) }.value
        coverData = image == nil ? nil : data
        media.cover = image
        refreshPalette()
        if let draftId {
            try? await store.saveCover(draftId, coverData)
        }
        await saveNow()
        // The cover is not part of the history, so a step from before it
        // changed would bring back the old song with the new cover. A new
        // cover starts the history again instead.
        resetHistory()
        onProjectChange?()
    }

    func pickSong(_ hit: SongHit) async {
        browsing = false
        edit { $0.song = hit.asSong }
        lastQuery = [hit.title, hit.artist].filter { !$0.isEmpty }.joined(separator: " ")
        if let data = await fetchCover(hit.asSong) {
            await setCover(data)
        } else {
            await setCover(nil)
            toast("The cover didn't come through. The rest still works.")
        }
    }

    func useManualSong(title: String, artist: String, album: String, seconds: Int) {
        edit {
            $0.song.id = "manual"
            $0.song.source = nil
            $0.song.title = title
            $0.song.artist = artist
            $0.song.album = album
            $0.song.year = ""
            $0.song.version = ""
            $0.song.artworkUrl100 = ""
            $0.song.coverUrls = []
            $0.song.durationMs = Double(seconds) * 1000
            $0.song.clipStartSeconds = 0
        }
        browsing = false
        toast("Saved to this slide.")
    }

    func saveStyle() async {
        guard let project else { return }
        let date = Date().formatted(date: .abbreviated, time: .omitted)
        do {
            try await store.saveStyle(Style(project: project, name: "\(project.template.label) \(date)"))
            toast("Look saved to your styles.")
        } catch {
            toast("That look didn't save. Try once more.")
        }
    }

    func deleteDraft(_ id: String) async {
        await store.deleteDraft(id)
        if draftId == id { draftId = nil }
        toast("Discarded.")
        await refreshLibrary()
    }

    func deleteStyle(_ id: String) async {
        await store.deleteStyle(id)
        await refreshLibrary()
    }

    func photoThumbnail(_ id: String) async -> CGImage? {
        guard let data = await store.photoData(id) else { return nil }
        return await Task.detached(priority: .utility) { ImageLoading.decode(data, maxPixels: 160) }.value
    }
}
