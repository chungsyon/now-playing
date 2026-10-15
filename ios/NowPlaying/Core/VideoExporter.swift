import AVFoundation
import CoreGraphics
import CoreVideo
import Foundation

/*
 MAKING THE FILE
 ---------------
 Draws the project one frame at a time and encodes those frames into a silent
 H.264 MP4. Nothing here is a screen recording: frame 41 is drawn by asking
 the renderer for time 41/30, so the same project always makes the same file.

 Only a video track is ever added, so the file cannot contain audio. The song
 is added later, in Instagram.
*/

enum VideoExport {
    static let fps = 30

    /// What a short loop gets: the best the picture needs.
    static let best = 12_000_000
    static let least = 2_500_000
    /// Long loops aim at a file of about twenty megabytes. Almost nothing
    /// moves, so the rate can come down a long way without showing.
    static let targetBytes = 20e6

    static func bitrate(for seconds: Double) -> Int {
        let fits = targetBytes * 8 / max(1, seconds)
        return Int(min(Double(best), max(Double(least), fits)).rounded())
    }

    struct Result {
        var url: URL
        var bytes: Int64
        var width: Int
        var height: Int
        var frames: Int
        var seconds: Double
    }

    enum Failure: LocalizedError {
        case writer(String)
        var errorDescription: String? {
            switch self { case .writer(let why): return why }
        }
    }

    /// Render the whole loop to an MP4 in the temporary folder.
    static func render(_ project: Project, media: Media, name: String,
                       progress: @escaping (Double) -> Void) async throws -> Result {
        let started = Date()
        let w = project.aspect.w, h = project.aspect.h
        let frames = Int((project.loopSeconds * Double(fps)).rounded())
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(name).appendingPathExtension("mp4")
        try? FileManager.default.removeItem(at: url)

        let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
        // The index goes at the front of the file, where Photos and Instagram
        // expect to find it.
        writer.shouldOptimizeForNetworkUse = true
        let settings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: w,
            AVVideoHeightKey: h,
            AVVideoColorPropertiesKey: [
                AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
                AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
                AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
            ],
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: bitrate(for: project.loopSeconds),
                AVVideoMaxKeyFrameIntervalKey: fps * 2,
                AVVideoExpectedSourceFrameRateKey: fps,
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
            ],
        ]
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
        input.expectsMediaDataInRealTime = false
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: w,
            kCVPixelBufferHeightKey as String: h,
            kCVPixelBufferIOSurfacePropertiesKey as String: [String: Any](),
        ])
        guard writer.canAdd(input) else { throw Failure.writer("The encoder would not take this size.") }
        writer.add(input)
        guard writer.startWriting() else {
            throw Failure.writer(writer.error?.localizedDescription ?? "The encoder would not start.")
        }
        writer.startSession(atSourceTime: .zero)

        let stage = Stage(width: w, height: h, media: media)
        do {
            for frame in 0..<frames {
                try Task.checkCancellation()
                while !input.isReadyForMoreMediaData {
                    try await Task.sleep(nanoseconds: 2_000_000)
                }
                renderSlide(stage, project, Double(frame) / Double(fps))
                guard let pool = adaptor.pixelBufferPool else { throw Failure.writer("The encoder ran out of frames.") }
                var made: CVPixelBuffer?
                CVPixelBufferPoolCreatePixelBuffer(nil, pool, &made)
                guard let buffer = made else { throw Failure.writer("The encoder ran out of frames.") }
                copy(stage.ctx, into: buffer)
                if !adaptor.append(buffer, withPresentationTime: CMTime(value: CMTimeValue(frame), timescale: CMTimeScale(fps))) {
                    throw Failure.writer(writer.error?.localizedDescription ?? "A frame did not go in.")
                }
                progress(Double(frame + 1) / Double(frames))
                if frame % 4 == 0 { await Task.yield() }
            }
        } catch {
            writer.cancelWriting()
            try? FileManager.default.removeItem(at: url)
            throw error
        }

        input.markAsFinished()
        await writer.finishWriting()
        guard writer.status == .completed else {
            throw Failure.writer(writer.error?.localizedDescription ?? "The file could not be finished.")
        }
        let bytes = Int64((try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
        return Result(url: url, bytes: bytes, width: w, height: h, frames: frames,
                      seconds: Date().timeIntervalSince(started))
    }

    /// The stage's rows go straight across: both are top row first, BGRA.
    private static func copy(_ ctx: CGContext, into buffer: CVPixelBuffer) {
        CVPixelBufferLockBaseAddress(buffer, [])
        defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
        guard let src = ctx.data, let dst = CVPixelBufferGetBaseAddress(buffer) else { return }
        let srcRow = ctx.bytesPerRow
        let dstRow = CVPixelBufferGetBytesPerRow(buffer)
        let rowBytes = min(srcRow, dstRow, ctx.width * 4)
        for y in 0..<min(ctx.height, CVPixelBufferGetHeight(buffer)) {
            memcpy(dst + y * dstRow, src + y * srcRow, rowBytes)
        }
    }
}
