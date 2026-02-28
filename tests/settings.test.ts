import {beforeEach, describe, expect, it, vi} from "vitest";
import RecipeParsingPlugin from "../src/main";
import {DEFAULT_SETTINGS, RecipeParsingSettings} from "../src/settings";
import {App} from "obsidian";

type TestPlugin = RecipeParsingPlugin & {
  loadData: () => Promise<unknown>;
  saveData: (data: unknown) => Promise<void>;
};

const createPlugin = (): TestPlugin => {
  const app = new App();
  return new RecipeParsingPlugin(app) as TestPlugin;
};

describe("settings", () => {
  let plugin: TestPlugin;

  beforeEach(() => {
    plugin = createPlugin();
  });

  it("loads defaults when no saved data exists", async () => {
    vi.spyOn(plugin, "loadData").mockResolvedValue(null);

    await plugin.loadSettings();

    expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
  });

  it("merges saved settings over defaults", async () => {
    const saved: RecipeParsingSettings = {
      llmEndpoint: "https://example.com",
      apiKey: "key",
      imageModel: "image-model",
      textModel: "text-model",
      bookExtractionPrompt: "book prompt",
      shoppingListPrompt: "shopping prompt"
    };

    vi.spyOn(plugin, "loadData").mockResolvedValue(saved);

    await plugin.loadSettings();

    expect(plugin.settings).toEqual(saved);
  });

  it("applies legacy model when image/text models are missing", async () => {
    vi.spyOn(plugin, "loadData").mockResolvedValue({
      model: "legacy-model",
      apiKey: "abc"
    });

    await plugin.loadSettings();

    expect(plugin.settings.imageModel).toBe("legacy-model");
    expect(plugin.settings.textModel).toBe("legacy-model");
    expect(plugin.settings.apiKey).toBe("abc");
  });

  it("does not apply legacy model when image or text model is present", async () => {
    vi.spyOn(plugin, "loadData").mockResolvedValue({
      model: "legacy-model",
      imageModel: "image-only"
    });

    await plugin.loadSettings();

    expect(plugin.settings.imageModel).toBe("image-only");
    expect(plugin.settings.textModel).toBe(DEFAULT_SETTINGS.textModel);
  });

  it("persists current settings via saveData", async () => {
    const saveSpy = vi.spyOn(plugin, "saveData").mockResolvedValue();
    plugin.settings = {
      ...DEFAULT_SETTINGS,
      llmEndpoint: "https://persisted.example.com"
    };

    await plugin.saveSettings();

    expect(saveSpy).toHaveBeenCalledWith(plugin.settings);
  });
});
