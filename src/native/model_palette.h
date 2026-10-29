// derived: rea/native/windows/src/authority.hpp
#pragma once
#include <string>
#include <vector>
#include <string_view>

namespace LensDesk::Native {

inline constexpr std::string_view DEFAULT_MODEL = "gemini-3.8-flash";

struct ModelEntry {
    std::string id;
    std::string name;
    std::string provider;
};

class ModelPalette {
public:
    static const std::vector<ModelEntry>& GetParityModels() {
        static const std::vector<ModelEntry> s_models = {
            { "gemini-3.8-flash", "Gemini 3.8 Flash (Fast)", "gemini" },
            { "gemini-3.5-flash", "Gemini 3.5 Flash", "gemini" },
            { "gemini-3.1-pro-preview", "Gemini 3.1 Pro Preview", "gemini" },
            { "claude-haiku-4-5", "Claude Haiku 4.5", "anthropic" },
            { "claude-sonnet-5", "Claude Sonnet 5", "anthropic" },
            { "claude-opus-5-5", "Claude Opus 5.5", "anthropic" },
            { "deepseek-flash", "DeepSeek Flash", "deepseek" },
            { "openai/gpt-oss-120b", "OpenAI GPT OSS 120B", "openai" },
        };
        return s_models;
    }

    static const std::vector<std::string>& GetLegacyModels() {
        static const std::vector<std::string> s_legacy = {
            "gpt-4o-mini",
            "gpt-4o",
            "gemini-3.5-flash-lite",
            "claude-3-5-haiku-20241022",
            "deepseek-chat",
            "llama-3.3-70b-versatile",
            "llama3.2"
        };
        return s_legacy;
    }

    static bool IsLegacyModel(std::string_view id) {
        for (const auto& m : GetLegacyModels()) {
            if (m == id) return true;
        }
        return false;
    }

    static bool IsParityModel(std::string_view id) {
        for (const auto& m : GetParityModels()) {
            if (m.id == id) return true;
        }
        return false;
    }

    static std::string ResolveModel(std::string_view savedId) {
        if (savedId.empty()) {
            return std::string(DEFAULT_MODEL);
        }
        if (IsParityModel(savedId) || IsLegacyModel(savedId)) {
            return std::string(savedId);
        }
        // Unknown saved ID falls back to DEFAULT_MODEL instead of rendering empty
        return std::string(DEFAULT_MODEL);
    }
};

} // namespace LensDesk::Native
