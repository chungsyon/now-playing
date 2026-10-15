import XCTest

/// The whole app once, as a person would use it: photo, song, editor, export.
/// It also takes the App Store screenshots. Run with:
///
///   TEST_RUNNER_SHOTS=$PWD/Screenshots xcodebuild test -scheme Screenshots \
///     -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max'
///
/// It needs the network (song search) and a photo in the simulator's library.
final class Walkthrough: XCTestCase {
    let app = XCUIApplication()

    func testWalkthrough() throws {
        continueAfterFailure = false
        app.launch()

        // Home → the system photo picker → the first photo.
        app.buttons["Choose a Photo"].tap()
        let photo = app.scrollViews.images.firstMatch
        XCTAssert(photo.waitForExistence(timeout: 10), "No photo in the picker")
        photo.tap()

        // Song: search, pick the first result, continue.
        let search = app.searchFields.firstMatch
        XCTAssert(search.waitForExistence(timeout: 10), "The song screen did not open")
        search.tap()
        search.typeText("Blinding Lights The Weeknd")
        let first = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Blinding Lights'")).firstMatch
        XCTAssert(first.waitForExistence(timeout: 20), "No search results")
        app.keyboards.buttons["search"].tapIfPresent()
        shot("2-Song")
        first.tap()
        app.buttons["Continue"].tap()

        // Editor, in two templates.
        let export = app.buttons["Export"]
        XCTAssert(export.waitForExistence(timeout: 10), "The editor did not open")
        sleep(2)
        shot("3-Vinyl")
        app.buttons["Template, Vinyl"].tap()
        app.buttons["Player"].tap()
        sleep(2)
        shot("4-Player")

        // Export: make the video.
        export.tap()
        app.buttons["Make the Slide"].tap()
        XCTAssert(app.buttons["Save to Photos"].waitForExistence(timeout: 120), "The video was not made")
        sleep(2)
        shot("5-Export")

        // Back home, where the draft is now listed.
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssert(app.staticTexts["Blinding Lights"].waitForExistence(timeout: 10), "The draft is not on Home")
        shot("1-Home")
    }

    private func shot(_ name: String) {
        let png = XCUIScreen.main.screenshot().pngRepresentation
        let attachment = XCTAttachment(data: png, uniformTypeIdentifier: "public.png")
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = ProcessInfo.processInfo.environment["SHOTS"] {
            try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
            try? png.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
        }
    }
}

private extension XCUIElement {
    func tapIfPresent() { if exists { tap() } }
}
