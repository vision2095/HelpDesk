// derived: rea/native/windows/src/authority.hpp
#include "../src/native/model_palette.h"
#include "test_common.h"
#include <iostream>

using namespace LensDesk::Native;

int run_test_model_palette() {
    LensDesk::Test::ResetAssertionCounter();

    // 1. DEFAULT_MODEL constant points to gemini-3.8-flash
    CHECK(DEFAULT_MODEL == "gemini-3.8-flash");

    // 2. Parity models count and exact order of 8 models
    const auto& models = ModelPalette::GetParityModels();
    CHECK(models.size() == 8);

    CHECK(models[0].id == "gemini-3.8-flash");
    CHECK(models[1].id == "gemini-3.5-flash");
    CHECK(models[2].id == "gemini-3.1-pro-preview");
    CHECK(models[3].id == "claude-haiku-4-5");
    CHECK(models[4].id == "claude-sonnet-5");
    CHECK(models[5].id == "claude-opus-5-5");
    CHECK(models[6].id == "deepseek-flash");
    CHECK(models[7].id == "openai/gpt-oss-120b");

    // 3. DEFAULT_MODEL resolves cleanly
    CHECK(ModelPalette::ResolveModel("") == "gemini-3.8-flash");
    CHECK(ModelPalette::ResolveModel("gemini-3.8-flash") == "gemini-3.8-flash");
    CHECK(ModelPalette::ResolveModel("claude-sonnet-5") == "claude-sonnet-5");

    // 4. Legacy models resolve cleanly (do not fall back)
    CHECK(ModelPalette::IsLegacyModel("gpt-4o-mini"));
    CHECK(ModelPalette::ResolveModel("gpt-4o-mini") == "gpt-4o-mini");
    CHECK(ModelPalette::ResolveModel("claude-3-5-haiku-20241022") == "claude-3-5-haiku-20241022");

    // 5. Unknown saved ID falls back to DEFAULT_MODEL instead of returning empty
    std::string unknownId = "unknown-nonexistent-model-xyz";
    CHECK(!ModelPalette::IsParityModel(unknownId));
    CHECK(!ModelPalette::IsLegacyModel(unknownId));
    std::string fallback = ModelPalette::ResolveModel(unknownId);
    CHECK(!fallback.empty());
    CHECK(fallback == DEFAULT_MODEL);
    CHECK(fallback == "gemini-3.8-flash");

    std::cout << "[PASS] test_model_palette: " << LensDesk::Test::GetAssertionCount() << " asserts verified.\n";
    return 0;
}

#ifndef RUN_ALL_TESTS
int main() {
    return run_test_model_palette();
}
#endif
