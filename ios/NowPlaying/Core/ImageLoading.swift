import CoreGraphics
import Foundation
import ImageIO

/*
 PICTURES IN
 -----------
 A photo straight off an iPhone can be 48 megapixels. The slide is 1080
 pixels wide, so the photo is decoded at a size that stays sharp in the file
 and no bigger, turned the right way up as it goes. The original bytes are
 kept as they are; this app never re-saves your photo.
*/

enum ImageLoading {
    /// Decoded no larger than this on its long side.
    static let maxPixels = 2560

    static func decode(_ data: Data?, maxPixels: Int = maxPixels) -> CGImage? {
        guard let data, let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixels,
            kCGImageSourceShouldCacheImmediately: true,
        ]
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    }

    /// The image as JPEG bytes, for a cover a user picked themselves.
    static func jpeg(_ image: CGImage, quality: Double = 0.9) -> Data? {
        let data = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(data, "public.jpeg" as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        return CGImageDestinationFinalize(dest) ? data as Data : nil
    }

    static func png(_ image: CGImage) -> Data? {
        let data = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(data, "public.png" as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, image, nil)
        return CGImageDestinationFinalize(dest) ? data as Data : nil
    }
}
