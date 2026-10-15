import Foundation

/*
 THE EFFECT REGISTRY
 -------------------
 One entry per effect. The Effects section builds its sliders from `params`,
 and the renderer applies each effect in order (blur always first, because
 grain belongs on top of a blurred photo, not underneath where blur wipes it).

 Blur's radius is per 1000 pixels of slide width, not in pixels, so the small
 preview and the 1080px file look the same.
*/

struct EffectParam: Hashable {
    var key: String
    var label: String
    var min: Double
    var max: Double
    var step: Double
    var defaultValue: Double
}

enum EffectType: String, Codable, Hashable, CaseIterable, Identifiable {
    case blur, grain, vignette

    var id: String { rawValue }

    var label: String {
        switch self {
        case .blur: return "Blur"
        case .grain: return "Film grain"
        case .vignette: return "Vignette"
        }
    }

    var params: [EffectParam] {
        switch self {
        case .blur:
            return [EffectParam(key: "radius", label: "Radius", min: 0, max: 60, step: 1, defaultValue: 12)]
        case .grain:
            return [
                EffectParam(key: "amount", label: "Amount", min: 0, max: 0.5, step: 0.01, defaultValue: 0.09),
                EffectParam(key: "size", label: "Size", min: 1, max: 6, step: 0.5, defaultValue: 1.5),
            ]
        case .vignette:
            return [
                EffectParam(key: "amount", label: "Amount", min: 0, max: 1, step: 0.02, defaultValue: 0.45),
                EffectParam(key: "softness", label: "Softness", min: 0.1, max: 1, step: 0.02, defaultValue: 0.8),
            ]
        }
    }
}

struct Effect: Codable, Hashable {
    var type: EffectType
    var params: [String: Prop]

    init(type: EffectType, params: [String: Prop]? = nil) {
        self.type = type
        self.params = params ?? Dictionary(uniqueKeysWithValues: type.params.map { ($0.key, Prop.value($0.defaultValue)) })
    }

    /// A slider's value at a moment, falling back to its default when a saved
    /// file is missing it.
    func value(_ key: String, at t: Double) -> Double {
        if let prop = params[key] { return prop.at(t) }
        return type.params.first { $0.key == key }?.defaultValue ?? 0
    }

    var isKeyed: Bool { params.values.contains { $0.isKeyed } }
}
