import CoreGraphics
import Foundation

/*
 Draws the preview off the main thread, so a busy frame never holds up a
 finger. Asks that arrive while a frame is being drawn are folded into one:
 only the newest is drawn next. A finger reports up to 120 times a second;
 drawing every report would put the picture behind the thumb.
*/

final class PreviewRenderer: @unchecked Sendable {
    struct Job {
        var project: Project
        var media: Media
        var t: Double
        var width: Int
        var height: Int
    }

    private let queue = DispatchQueue(label: "now-playing.preview", qos: .userInteractive)
    /// Only touched on `queue`.
    private var stage: Stage?
    /// Only touched on the main thread.
    private var busy = false
    private var pending: Job?

    /// Called on the main thread with each finished frame.
    var onFrame: ((CGImage) -> Void)?

    @MainActor
    func request(_ job: Job) {
        if busy {
            pending = job
            return
        }
        run(job)
    }

    @MainActor
    private func run(_ job: Job) {
        busy = true
        queue.async { [self] in
            if stage == nil || stage!.width != job.width || stage!.height != job.height {
                stage = Stage(width: job.width, height: job.height, media: job.media)
            }
            let stage = stage!
            stage.media = job.media
            renderSlide(stage, job.project, job.t)
            let image = stage.image()
            DispatchQueue.main.async { [self] in
                MainActor.assumeIsolated {
                    busy = false
                    if let image { onFrame?(image) }
                    if let next = pending {
                        pending = nil
                        run(next)
                    }
                }
            }
        }
    }

    /// One still frame, for the Export screen's thumbnail.
    static func still(_ project: Project, media: Media, width: Int) async -> CGImage? {
        await Task.detached(priority: .userInitiated) {
            let w = min(width, project.aspect.w)
            let h = Int((Double(w) * Double(project.aspect.h) / Double(project.aspect.w)).rounded())
            let stage = Stage(width: w, height: h, media: media)
            renderSlide(stage, project, 0)
            return stage.image()
        }.value
    }
}
