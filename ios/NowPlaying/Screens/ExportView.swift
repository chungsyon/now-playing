import AVFoundation
import Photos
import SwiftUI
import UIKit

/*
 EXPORT
 ------
 Both slides side by side, what the file is, and the taps that get it into
 Photos. Making the file and saving it are separate steps, so a long render
 never surprises you with a permission prompt halfway.
*/

struct ExportView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var still: CGImage?
    @State private var photo: CGImage?
    @State private var progress: Double?
    @State private var result: VideoExport.Result?
    @State private var status = ""
    @State private var saved = false
    @State private var renderTask: Task<Void, Never>?
    @State private var finished = 0

    var body: some View {
        if let project = model.project {
            List {
                Section {
                    HStack(alignment: .top, spacing: 12) {
                        slideCard(caption: "Slide 1 · Your photo", aspect: project.aspect) {
                            if let photo {
                                Image(decorative: photo, scale: 1).resizable().scaledToFill()
                            } else {
                                Color(.tertiarySystemFill)
                            }
                        }
                        .accessibilityLabel("Slide 1, your photo, which stays untouched")
                        slideCard(caption: "Slide 2 · This slide", aspect: project.aspect) {
                            if let result {
                                LoopingVideo(url: result.url)
                                    .transition(reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.96)))
                            } else if let still {
                                Image(decorative: still, scale: 1).resizable().scaledToFill()
                            } else {
                                Color(.tertiarySystemFill)
                            }
                        }
                        .accessibilityLabel(result == nil ? "Slide 2, the slide this app will make" : "Slide 2, playing")
                    }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                }

                Section {
                    if let progress {
                        VStack(alignment: .leading, spacing: 8) {
                            ProgressView(value: progress)
                            Text("Developing… \(Int((progress * 100).rounded()))%")
                                .font(.footnote.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 6)
                        Button("Stop", role: .cancel) { renderTask?.cancel() }
                    } else if let result {
                        Button {
                            Task { await saveToPhotos(result.url) }
                        } label: {
                            Label(saved ? "Saved to Photos" : "Save to Photos",
                                  systemImage: saved ? "checkmark.circle.fill" : "square.and.arrow.down")
                                .font(.body.weight(.semibold))
                                .frame(maxWidth: .infinity, minHeight: 34)
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                        .disabled(saved)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())

                        ShareLink(item: result.url) {
                            Label("Share…", systemImage: "square.and.arrow.up")
                        }
                        Button("Make Again") { make(project) }
                    } else {
                        Button {
                            make(project)
                        } label: {
                            Text("Make the Slide")
                                .font(.body.weight(.semibold))
                                .frame(maxWidth: .infinity, minHeight: 34)
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                    }
                } footer: {
                    if !status.isEmpty { Text(status) }
                }

                Section("In Instagram") {
                    step(1, Text("Add your photo first, as slide 1."))
                    step(2, Text("Add this video second, as slide 2."))
                    if project.song.title.isEmpty {
                        step(3, Text("Add the song in Music."))
                    } else {
                        step(3, Text("In Music, add **\(project.song.title)** by **\(project.song.artist)**."))
                    }
                    step(4, Text("Start the clip at **\(formatTime(project.song.clipStartSeconds))**."))
                }

                Section("The file") {
                    fact("Format", "MP4, H.264")
                    fact("Size", "\(project.aspect.w) × \(project.aspect.h)")
                    fact("Loop", "\(String(format: "%.1f", project.loopSeconds))s at \(VideoExport.fps) fps")
                    fact("Frames", "\(Int((project.loopSeconds * Double(VideoExport.fps)).rounded()))")
                    fact("Rate", "\(String(format: "%.1f", Double(VideoExport.bitrate(for: project.loopSeconds)) / 1e6)) Mbps")
                    fact("Audio", "None")
                    if let result { fact("File", String(format: "%.1f MB", Double(result.bytes) / 1_048_576)) }
                }
            }
            .navigationTitle("Export")
            .sensoryFeedback(.success, trigger: finished)
            .task {
                async let s = PreviewRenderer.still(project, media: model.media, width: 540)
                photo = model.media.photo
                still = await s
            }
            .onDisappear {
                renderTask?.cancel()
                if let result { try? FileManager.default.removeItem(at: result.url) }
            }
        }
    }

    private func slideCard<Content: View>(caption: String, aspect: Aspect, @ViewBuilder content: () -> Content) -> some View {
        VStack(spacing: 8) {
            Color.clear
                .aspectRatio(CGFloat(aspect.w) / CGFloat(aspect.h), contentMode: .fit)
                .overlay { content() }
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .shadow(color: .black.opacity(0.15), radius: 10, y: 4)
            Text(caption)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    private func step(_ n: Int, _ text: Text) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text("\(n)")
                .font(.footnote.weight(.bold).monospacedDigit())
                .foregroundStyle(.white)
                .frame(width: 22, height: 22)
                .background(Circle().fill(Color.accentColor))
            text
        }
    }

    private func fact(_ term: String, _ value: String) -> some View {
        LabeledContent(term, value: value)
    }

    private func make(_ project: Project) {
        if let old = result { try? FileManager.default.removeItem(at: old.url) }
        withAnimation(.smooth) { result = nil }
        saved = false
        progress = 0
        status = ""
        let media = model.media
        let name = slug(project.song.title)
        // Keep the screen awake and, if you switch away for a moment, keep
        // going long enough to finish.
        UIApplication.shared.isIdleTimerDisabled = true
        let background = UIApplication.shared.beginBackgroundTask(withName: "Render the slide")
        renderTask = Task {
            defer {
                UIApplication.shared.isIdleTimerDisabled = false
                UIApplication.shared.endBackgroundTask(background)
            }
            do {
                let made = try await VideoExport.render(project, media: media, name: name) { fraction in
                    Task { @MainActor in if progress != nil { progress = fraction } }
                }
                progress = nil
                withAnimation(reduceMotion ? .easeOut(duration: 0.2) : .spring(response: 0.5, dampingFraction: 1)) {
                    result = made
                }
                finished += 1
                status = String(format: "Your slide is ready. %.1f MB, made in %.1fs.", Double(made.bytes) / 1_048_576, made.seconds)
            } catch is CancellationError {
                progress = nil
                status = "Stopped."
            } catch {
                progress = nil
                status = "Something didn't come through. Try once more."
            }
        }
    }

    private func slug(_ title: String) -> String {
        let s = title.lowercased()
            .replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        return s.isEmpty ? "now-playing" : s
    }

    private func saveToPhotos(_ url: URL) async {
        let access = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
        guard access == .authorized || access == .limited else {
            status = "Photos access is off for Now Playing. Turn on Add Photos Only in Settings, or use Share."
            return
        }
        do {
            try await PHPhotoLibrary.shared().performChanges {
                PHAssetCreationRequest.forAsset().addResource(with: .video, fileURL: url, options: nil)
            }
            saved = true
            finished += 1
            status = "In your Photos, next to your picture. Add both to one Instagram post."
        } catch {
            status = "Saving didn't come through. Try once more, or use Share."
        }
    }
}

/// The finished slide, playing on a loop, silently, like it will in the post.
private struct LoopingVideo: UIViewRepresentable {
    let url: URL

    final class PlayerView: UIView {
        override class var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
        var looper: AVPlayerLooper?
    }

    func makeUIView(context: Context) -> PlayerView {
        let view = PlayerView()
        let player = AVQueuePlayer()
        player.isMuted = true
        // Never interrupts music that is already playing.
        player.preventsDisplaySleepDuringVideoPlayback = false
        view.looper = AVPlayerLooper(player: player, templateItem: AVPlayerItem(url: url))
        view.playerLayer.player = player
        view.playerLayer.videoGravity = .resizeAspectFill
        player.play()
        return view
    }

    func updateUIView(_ view: PlayerView, context: Context) {}

    static func dismantleUIView(_ view: PlayerView, coordinator: ()) {
        view.playerLayer.player?.pause()
        view.looper = nil
    }
}
