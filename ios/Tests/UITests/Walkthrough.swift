import XCTest

/// The whole app as a person would use it, pinching, and the App Store
/// screenshots. The walkthrough needs the network (song search); every test
/// needs the simulator's sample photos. See ios/AppStore.md for the screenshots.
final class Walkthrough: XCTestCase {
    let app = XCUIApplication()

    func testWalkthrough() throws {
        continueAfterFailure = false
        app.launch()

        // Home: Instagram's 4:5 shape, then the system photo picker.
        app.buttons["4:5"].tap()
        app.buttons["Choose a Photo"].tap()
        let photo = samplePhoto()
        XCTAssert(photo.waitForExistence(timeout: 60), "No photo in the picker")
        photo.tap()

        // Song: search, pick the first result, continue.
        let search = app.searchFields.firstMatch
        XCTAssert(search.waitForExistence(timeout: 10), "The song screen did not open")
        search.tap()
        search.typeText("Blinding Lights The Weeknd")
        // The original recording, not a remix or a live take.
        let first = app.staticTexts["Blinding Lights"].firstMatch
        XCTAssert(first.waitForExistence(timeout: 30), "No search results")
        app.keyboards.buttons["search"].tapIfPresent()
        first.tap()
        app.buttons["Continue"].tap()

        // Editor, in two templates.
        let export = app.buttons["Export"]
        XCTAssert(export.waitForExistence(timeout: 10), "The editor did not open")
        sleep(2)
        app.buttons["Template, Vinyl"].tap()
        app.buttons["Player"].tap()
        sleep(2)

        // Export: make the video.
        export.tap()
        app.buttons["Make the Slide"].tap()
        XCTAssert(app.buttons["Save to Photos"].waitForExistence(timeout: 120), "The video was not made")
        sleep(2)

        // Back home, where the draft is now listed.
        let choose = app.buttons["Choose a Photo"]
        for _ in 0..<4 where !choose.exists {
            app.navigationBars.buttons.element(boundBy: 0).tap()
            sleep(1)
        }
        XCTAssert(app.staticTexts["Blinding Lights"].waitForExistence(timeout: 10), "The draft is not on Home")
    }

    /// A pinch on a layer resizes it; a pinch on the bare photo zooms the view.
    func testPinch() throws {
        continueAfterFailure = false
        app.launch()
        app.buttons["4:5"].tap()
        app.buttons["Choose a Photo"].tap()
        let photo = samplePhoto()
        XCTAssert(photo.waitForExistence(timeout: 60), "No photo in the picker")
        photo.tap()
        // No search needed: type the song in.
        XCTAssert(app.buttons["Enter the Details Yourself"].waitForExistence(timeout: 10))
        app.buttons["Enter the Details Yourself"].tap()
        let title = app.textFields["Song title"]
        title.tap()
        title.typeText("Test Song")
        app.buttons["Use These Details"].tap()
        if app.buttons["Continue"].waitForExistence(timeout: 5) { app.buttons["Continue"].tap() }

        let preview = app.images["Preview of the slide"]
        XCTAssert(preview.waitForExistence(timeout: 10), "The editor did not open")
        app.buttons["Pause the loop"].tapIfPresent()

        // Vinyl has the cover in the middle: the pinch resizes it, the view stays put.
        preview.pinch(withScale: 1.6, velocity: 1)
        XCTAssert(app.staticTexts["100%"].exists, "Pinching a layer zoomed the view")
        sleep(1)

        // Bookmark leaves the middle of the photo bare: the pinch zooms the view.
        app.buttons["Undo"].tap()
        app.buttons["Template, Vinyl"].tap()
        app.buttons["Bookmark"].tap()
        preview.coordinate(withNormalizedOffset: CGVector(dx: 0.02, dy: 0.02)).tap()
        preview.pinch(withScale: 2, velocity: 2)
        let zoomed = app.staticTexts.matching(NSPredicate(format: "label MATCHES '[0-9]+%' AND label != '100%'")).firstMatch
        XCTAssert(zoomed.waitForExistence(timeout: 3), "Pinching the photo did not zoom the view")
        sleep(1)

        // Zoomed in, a drag on the bare photo moves the view, not a layer.
        preview.coordinate(withNormalizedOffset: CGVector(dx: 0.4, dy: 0.5))
            .press(forDuration: 0.05, thenDragTo: preview.coordinate(withNormalizedOffset: CGVector(dx: 0.6, dy: 0.6)))
        sleep(1)
        XCTAssert(app.staticTexts["Tap something on the slide, or pick it here."].exists, "The drag picked up a layer")
        app.buttons["Zoom out"].tap()
    }

    /// The store screenshots, with a made-up song and a cover made for them,
    /// so no one else's artwork is in the listing. Before running, add the
    /// cover to the simulator: xcrun simctl addmedia booted cover.jpg
    func testScreenshots() throws {
        continueAfterFailure = false
        app.launch()
        app.buttons["4:5"].tap()
        app.buttons["Choose a Photo"].tap()
        let photo = samplePhoto()
        XCTAssert(photo.waitForExistence(timeout: 60), "No photo in the picker")
        photo.tap()

        XCTAssert(app.buttons["Enter the Details Yourself"].waitForExistence(timeout: 10))
        app.buttons["Enter the Details Yourself"].tap()
        for (field, text) in [("Song title", "Late Summer Light"), ("Artist", "Nora Field")] {
            app.textFields[field].tap()
            app.textFields[field].typeText(text)
        }
        let length = app.otherElements["Length, minutes and seconds"].textFields
        for (i, text) in ["3", "24"].enumerated() {
            length.element(boundBy: i).tap()
            length.element(boundBy: i).typeText(text)
        }
        app.buttons["Add Your Own Cover"].tap()
        // The cover is the one picture from this year, whose label has no year.
        let cover = app.images.matching(NSPredicate(format: "label BEGINSWITH 'Photo, ' AND NOT (label MATCHES %@)", Self.dated)).firstMatch
        XCTAssert(cover.waitForExistence(timeout: 30), "No cover in the picker")
        cover.tap()
        sleep(2)
        app.buttons["Use These Details"].tap()
        if app.buttons["Continue"].waitForExistence(timeout: 5) { app.buttons["Continue"].tap() }

        let export = app.buttons["Export"]
        XCTAssert(export.waitForExistence(timeout: 10), "The editor did not open")
        sleep(2)
        shot("2-Vinyl")
        for (from, to, name) in [("Vinyl", "Player", "3-Player"), ("Player", "Media", "4-Media")] {
            app.buttons["Template, \(from)"].tap()
            app.buttons[to].tap()
            sleep(2)
            shot(name)
        }

        export.tap()
        app.buttons["Make the Slide"].tap()
        XCTAssert(app.buttons["Save to Photos"].waitForExistence(timeout: 120), "The video was not made")
        sleep(2)
        shot("5-Export")

        let choose = app.buttons["Choose a Photo"]
        for _ in 0..<4 where !choose.exists {
            app.navigationBars.buttons.element(boundBy: 0).tap()
            sleep(1)
        }
        XCTAssert(app.staticTexts["Late Summer Light"].waitForExistence(timeout: 10), "The draft is not on Home")
        shot("1-Home")
    }

    /// "Photo, August 09, 2012, 4:55 AM". This year's pictures leave the year out.
    private static let dated = ".*, [0-9]{4}, .*"

    /// The waterfall from the simulator's own sample photos. The picker's
    /// cells are images labelled "Photo, <date>", newest first.
    private func samplePhoto() -> XCUIElement {
        app.images.matching(NSPredicate(format: "label BEGINSWITH 'Photo, ' AND label MATCHES %@", Self.dated)).element(boundBy: 1)
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
