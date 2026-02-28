import {beforeEach, describe, expect, it, vi} from "vitest";
import RecipeParsingPlugin from "../src/main";
import {DEFAULT_SETTINGS} from "../src/settings";
import * as Obsidian from "obsidian";

type TestPlugin = RecipeParsingPlugin & {
  settings: typeof DEFAULT_SETTINGS;
  loadData: () => Promise<unknown>;
  saveSettings: () => Promise<void>;
  addSettingTab: (tab: Obsidian.PluginSettingTab) => void;
};

type TextChange = (value: string) => void | Promise<void>;

const createPlugin = (): TestPlugin => {
  const app = new Obsidian.App();
  const plugin = new RecipeParsingPlugin(app) as TestPlugin;
  plugin.settings = {...DEFAULT_SETTINGS};
  return plugin;
};

describe("RecipeParsingSettingTab", () => {
  let plugin: TestPlugin;
  let tab: Obsidian.PluginSettingTab | null;
  let textChanges: TextChange[];
  let textAreaChanges: TextChange[];

  beforeEach(async () => {
    vi.restoreAllMocks();
    plugin = createPlugin();
    tab = null;
    textChanges = [];
    textAreaChanges = [];

    vi.spyOn(plugin, "loadData").mockResolvedValue(null);
    vi.spyOn(plugin, "saveSettings").mockResolvedValue();
    vi.spyOn(plugin, "addSettingTab").mockImplementation((settingTab) => {
      tab = settingTab;
    });

    vi.spyOn(Obsidian.Setting.prototype, "addText").mockImplementation(function (callback) {
      const control = {
        setPlaceholder: vi.fn().mockReturnThis(),
        setValue: vi.fn().mockReturnThis(),
        onChange: (cb: TextChange) => {
          textChanges.push(cb);
          return control;
        }
      };
      callback(control as unknown as {setPlaceholder: () => void; setValue: () => void; onChange: () => void});
      return this;
    });

    vi.spyOn(Obsidian.Setting.prototype, "addTextArea").mockImplementation(function (callback) {
      const control = {
        setValue: vi.fn().mockReturnThis(),
        onChange: (cb: TextChange) => {
          textAreaChanges.push(cb);
          return control;
        }
      };
      callback(control as unknown as {setValue: () => void; onChange: () => void});
      return this;
    });

    await plugin.onload();

    if (!tab) {
      throw new Error("Settings tab not captured");
    }

    tab.display();
  });

  it("trims text inputs and falls back to defaults when empty", async () => {
    expect(textChanges).toHaveLength(4);

    await textChanges[0]("  https://example.com  ");
    await textChanges[1]("  key  ");
    await textChanges[2]("   ");
    await textChanges[3]("   ");

    expect(plugin.settings.llmEndpoint).toBe("https://example.com");
    expect(plugin.settings.apiKey).toBe("key");
    expect(plugin.settings.imageModel).toBe("gpt-5.2");
    expect(plugin.settings.textModel).toBe("gpt-5.2");
    expect(plugin.saveSettings).toHaveBeenCalledTimes(4);
  });

  it("persists raw values for text areas and saves after each change", async () => {
    expect(textAreaChanges).toHaveLength(2);

    await textAreaChanges[0]("  keep spaces  ");
    await textAreaChanges[1]("  another prompt  ");

    expect(plugin.settings.bookExtractionPrompt).toBe("  keep spaces  ");
    expect(plugin.settings.shoppingListPrompt).toBe("  another prompt  ");
    expect(plugin.saveSettings).toHaveBeenCalledTimes(2);
  });
});
