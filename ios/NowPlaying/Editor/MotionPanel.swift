import SwiftUI

/// Motion: how long the loop is, how the record turns, how the bar moves.
struct MotionPanel: View {
    let engine: EditorEngine
    @Environment(AppModel.self) private var model

    var body: some View {
        if let project = model.project {
            let seconds = project.loopSeconds
            let rate = Double(VideoExport.bitrate(for: seconds)) / 1e6
            let megabytes = Int((Double(VideoExport.bitrate(for: seconds)) * seconds / 8 / 1e6).rounded())
            let frames = Int((seconds * Double(VideoExport.fps)).rounded())

            Section {
                ValueSlider(label: "Length",
                            value: Binding(get: { seconds }, set: { value in
                                model.edit { $0.loopSeconds = value }
                                // A shorter loop must not leave the playhead past its end.
                                model.time = min(model.time, value)
                            }),
                            range: loopMin...loopMax, step: 1, format: { "\(Int($0)) s" })
            } header: {
                Text("Loop")
            } footer: {
                Text(seconds > 60
                     ? "\(frames) frames at \(String(format: "%.1f", rate)) Mbps, about \(megabytes) MB. Longer than a minute is a Reel, not a carousel slide."
                     : "\(frames) frames at \(VideoExport.fps) a second, \(String(format: "%.1f", rate)) Mbps, about \(megabytes) MB.")
            }

            if let disc = project.layers.first(where: { $0.type == .disc }) {
                let rpm = disc.props.rpm ?? 30
                let real = actualRpm(rpm, seconds)
                Section {
                    ValueSlider(label: "Speed",
                                value: Binding(get: { rpm }, set: { value in edit(disc.id) { $0.rpm = value } }),
                                range: 8...90, step: 1, format: { "\(Int($0)) rpm" })
                    Picker("Direction", selection: Binding(get: { (disc.props.direction ?? 1) >= 0 ? 1.0 : -1.0 },
                                                           set: { value in edit(disc.id) { $0.direction = value } })) {
                        Text("Clockwise").tag(1.0)
                        Text("Anticlockwise").tag(-1.0)
                    }
                    .pickerStyle(.segmented)
                } header: {
                    HStack {
                        Text("Record")
                        Spacer()
                        Text("\(Int(real.rounded())) rpm").monospacedDigit()
                    }
                } footer: {
                    Text("Rounded to \(turnsPerLoop(rpm, seconds)) whole turns, which is \(String(format: "%.1f", real)) rpm. Whole turns are what let the loop close without a jump.")
                }
            }

            if let bar = project.layers.first(where: { $0.type == .progressBar }) {
                Section {
                    Picker("Progress speed", selection: Binding(get: { bar.props.speed ?? 1 },
                                                                set: { value in edit(bar.id) { $0.speed = value } })) {
                        Text("Real time").tag(1.0)
                        Text("4×").tag(4.0)
                        Text("12×").tag(12.0)
                    }
                    .pickerStyle(.segmented)
                } header: {
                    Text("Progress bar")
                } footer: {
                    Text("Real time matches the song. Faster makes the movement easy to see in a short loop.")
                }
            }
        }
    }

    private func edit(_ id: String, _ change: (inout LayerProps) -> Void) {
        model.edit { project in
            if let i = project.index(of: id) { change(&project.layers[i].props) }
        }
    }
}

/// Song: which track, and where the Instagram clip starts.
struct SongPanel: View {
    let engine: EditorEngine
    @Environment(AppModel.self) private var model

    var body: some View {
        if let project = model.project {
            let song = project.song
            let total = max(1, Int((song.durationMs / 1000).rounded()))
            Section("Song") {
                Button {
                    model.browsing = song.title.isEmpty
                    model.path.append(.song)
                } label: {
                    HStack(spacing: 12) {
                        CoverThumb(image: model.media.cover, size: 48)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(song.title.isEmpty ? "No song yet" : song.title)
                                .foregroundStyle(Color.primary)
                            Text([song.artist, song.album, song.year].filter { !$0.isEmpty }.joined(separator: " · ")
                                .ifEmpty("Choose one to begin"))
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Spacer()
                        Text(song.title.isEmpty ? "Choose" : "Change").foregroundStyle(.secondary)
                        Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                    }
                }
            }
            if !song.title.isEmpty {
                Section("Clip") {
                    ValueSlider(label: "Starts at",
                                value: Binding(get: { min(song.clipStartSeconds, Double(total - 1)) },
                                               set: { value in model.edit { $0.song.clipStartSeconds = value } }),
                                range: 0...Double(max(1, total - 1)), step: 1,
                                format: { "\(formatTime($0)) of \(formatTime(Double(total)))" })
                }
            }
        }
    }
}

extension String {
    func ifEmpty(_ fallback: String) -> String { isEmpty ? fallback : self }
}

/// A cover, or a quiet note where there is none.
struct CoverThumb: View {
    let image: CGImage?
    var size: CGFloat = 48
    var radius: CGFloat = 8

    var body: some View {
        Group {
            if let image {
                Image(decorative: image, scale: 1).resizable().scaledToFill()
            } else {
                Image(systemName: "music.note")
                    .font(.system(size: size * 0.4))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(.tertiarySystemFill))
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
        .accessibilityHidden(true)
    }
}
