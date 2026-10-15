import Foundation

/*
 LOCAL SAVING
 ------------
 Everything lives on this device, in the app's own Application Support
 folder. Nothing is uploaded and there is no account.

   Drafts/<id>/draft.json   the project, and when it was last touched
   Drafts/<id>/photo        your photo, exactly as it came out of Photos
   Drafts/<id>/cover        the cover
   Styles/<id>.json         a project with the photo and song taken out
*/

struct DraftRecord: Codable, Identifiable {
    var id: String
    var updatedAt: Date
    var project: Project
}

actor DraftStore {
    static let shared = DraftStore()

    private let root: URL
    private let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .millisecondsSince1970
        return e
    }()
    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .millisecondsSince1970
        return d
    }()

    init(root: URL? = nil) {
        let base = root ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("NowPlaying", isDirectory: true)
        self.root = base
        for folder in ["Drafts", "Styles"] {
            try? FileManager.default.createDirectory(at: base.appendingPathComponent(folder), withIntermediateDirectories: true)
        }
    }

    private func folder(_ id: String) -> URL {
        root.appendingPathComponent("Drafts", isDirectory: true).appendingPathComponent(id, isDirectory: true)
    }

    // MARK: Drafts

    func saveProject(_ id: String, _ project: Project) throws {
        let dir = folder(id)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let record = DraftRecord(id: id, updatedAt: Date(), project: project)
        try encoder.encode(record).write(to: dir.appendingPathComponent("draft.json"), options: .atomic)
    }

    /// Written only when they change: a photo is megabytes, a project is not.
    func saveMedia(_ id: String, photo: Data?, cover: Data?) throws {
        let dir = folder(id)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        for (name, data) in [("photo", photo), ("cover", cover)] {
            let url = dir.appendingPathComponent(name)
            if let data {
                try data.write(to: url, options: .atomic)
            } else {
                try? FileManager.default.removeItem(at: url)
            }
        }
    }

    func saveCover(_ id: String, _ cover: Data?) throws {
        let url = folder(id).appendingPathComponent("cover")
        if let cover { try cover.write(to: url, options: .atomic) } else { try? FileManager.default.removeItem(at: url) }
    }

    func draft(_ id: String) -> (record: DraftRecord, photo: Data?, cover: Data?)? {
        let dir = folder(id)
        guard let data = try? Data(contentsOf: dir.appendingPathComponent("draft.json")),
              let record = try? decoder.decode(DraftRecord.self, from: data) else { return nil }
        return (record, try? Data(contentsOf: dir.appendingPathComponent("photo")),
                try? Data(contentsOf: dir.appendingPathComponent("cover")))
    }

    /// Newest first.
    func drafts() -> [DraftRecord] {
        let dir = root.appendingPathComponent("Drafts", isDirectory: true)
        let ids = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
        return ids.compactMap { id in
            guard let data = try? Data(contentsOf: folder(id).appendingPathComponent("draft.json")) else { return nil }
            return try? decoder.decode(DraftRecord.self, from: data)
        }
        .sorted { $0.updatedAt > $1.updatedAt }
    }

    func photoData(_ id: String) -> Data? {
        try? Data(contentsOf: folder(id).appendingPathComponent("photo"))
    }

    func deleteDraft(_ id: String) {
        try? FileManager.default.removeItem(at: folder(id))
    }

    // MARK: Styles

    private func styleURL(_ id: String) -> URL {
        root.appendingPathComponent("Styles", isDirectory: true).appendingPathComponent(id + ".json")
    }

    func saveStyle(_ style: Style) throws {
        var stamped = style
        stamped.updatedAt = Date()
        try encoder.encode(stamped).write(to: styleURL(style.id), options: .atomic)
    }

    func styles() -> [Style] {
        let dir = root.appendingPathComponent("Styles", isDirectory: true)
        let names = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
        return names.filter { $0.hasSuffix(".json") }.compactMap { name in
            guard let data = try? Data(contentsOf: dir.appendingPathComponent(name)) else { return nil }
            return try? decoder.decode(Style.self, from: data)
        }
        .sorted { $0.updatedAt > $1.updatedAt }
    }

    func deleteStyle(_ id: String) {
        try? FileManager.default.removeItem(at: styleURL(id))
    }
}
