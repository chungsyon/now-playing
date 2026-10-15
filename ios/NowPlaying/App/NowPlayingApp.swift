import AVFoundation
import SwiftUI
import UIKit

@main
struct NowPlayingApp: App {
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        // The app never makes a sound. Ambient means the finished slide can
        // play in the Export screen without stopping music you have on.
        try? AVAudioSession.sharedInstance().setCategory(.ambient, options: [.mixWithOthers])
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
        }
        .onChange(of: scenePhase) { _, phase in
            // Do not lose work if the app is closed mid-edit.
            if phase != .active { model.flush() }
        }
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        @Bindable var model = model
        NavigationStack(path: $model.path) {
            HomeView()
                .navigationDestination(for: Route.self) { route in
                    switch route {
                    case .song: SongView()
                    case .editor: EditorView(model: model)
                    case .export: ExportView()
                    }
                }
        }
        .overlay(alignment: .top) {
            if let toast = model.toast {
                ToastView(message: toast.message)
                    .id(toast.id)
                    .transition(reduceMotion ? .opacity : .move(edge: .top).combined(with: .opacity))
                    .task(id: toast.id) {
                        try? await Task.sleep(for: .seconds(2.6))
                        if model.toast?.id == toast.id { model.toast = nil }
                    }
            }
        }
        .animation(reduceMotion ? .easeOut(duration: 0.2) : .spring(response: 0.4, dampingFraction: 1), value: model.toast)
    }
}

/// A short note from the top: it comes in from the top and leaves the same way.
private struct ToastView: View {
    let message: String

    var body: some View {
        Text(message)
            .font(.subheadline.weight(.medium))
            .multilineTextAlignment(.center)
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .background(.regularMaterial, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.primary.opacity(0.08), lineWidth: 0.5))
            .shadow(color: .black.opacity(0.15), radius: 16, y: 6)
            .padding(.horizontal, 24)
            .padding(.top, 8)
            .accessibilityAddTraits(.isStaticText)
            .onAppear { UIAccessibility.post(notification: .announcement, argument: message) }
    }
}
