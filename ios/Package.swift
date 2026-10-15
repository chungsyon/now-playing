// swift-tools-version: 6.0
//
// The app's core (model, renderer, export, search, saving) as a package, so it
// can be built and tested on a Mac with `swift test`, no simulator needed.
// The app itself is NowPlaying.xcodeproj, which compiles the same files.
import PackageDescription

let package = Package(
    name: "NowPlayingCore",
    platforms: [.macOS(.v14), .iOS(.v17)],
    targets: [
        .target(
            name: "NowPlaying",
            path: "NowPlaying/Core",
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .testTarget(
            name: "CoreTests",
            dependencies: ["NowPlaying"],
            path: "Tests/CoreTests",
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
    ]
)
