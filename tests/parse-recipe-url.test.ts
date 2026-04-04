import {beforeEach, describe, expect, it, vi} from "vitest";
import RecipeParsingPlugin from "../src/main";
import {DEFAULT_SETTINGS} from "../src/settings";
import * as Obsidian from "obsidian";

type TestPlugin = RecipeParsingPlugin & {
  settings: typeof DEFAULT_SETTINGS;
  findUrlLinks: (content: string) => Array<{url: string; fullMatch: string; start: number}>;
};

const createPlugin = (): TestPlugin => {
  const app = new Obsidian.App();
  const plugin = new RecipeParsingPlugin(app) as TestPlugin;
  plugin.settings = {...DEFAULT_SETTINGS};
  return plugin;
};

describe("findUrlLinks", () => {
  let plugin: TestPlugin;

  beforeEach(() => {
    plugin = createPlugin();
  });

  it("matches markdown links", () => {
    const content = "Check out [this recipe](https://example.com/recipe)";
    const matches = plugin.findUrlLinks(content);

    expect(matches).toHaveLength(1);
    expect(matches[0].url).toBe("https://example.com/recipe");
  });

  it("matches bare URLs", () => {
    const content = "Found at https://example.com/recipe here";
    const matches = plugin.findUrlLinks(content);

    expect(matches).toHaveLength(1);
    expect(matches[0].url).toBe("https://example.com/recipe");
  });

  it("does not duplicate URLs in markdown links", () => {
    const content = "[recipe](https://example.com/recipe)";
    const matches = plugin.findUrlLinks(content);

    expect(matches).toHaveLength(1);
    expect(matches[0].url).toBe("https://example.com/recipe");
  });

  it("skips image URLs", () => {
    const content = "https://example.com/photo.png and https://example.com/recipe";
    const matches = plugin.findUrlLinks(content);

    expect(matches).toHaveLength(1);
    expect(matches[0].url).toBe("https://example.com/recipe");
  });

  it("skips image embed markdown links", () => {
    const content = "![alt](https://example.com/photo.png)";
    const matches = plugin.findUrlLinks(content);

    expect(matches).toHaveLength(0);
  });

  it("returns empty array when no URLs present", () => {
    const content = "Just some plain text without any links.";
    const matches = plugin.findUrlLinks(content);

    expect(matches).toHaveLength(0);
  });

  it("matches multiple URLs", () => {
    const content = "https://a.com/one\n[recipe](https://b.com/two)";
    const matches = plugin.findUrlLinks(content);

    expect(matches).toHaveLength(2);
    expect(matches.map((m) => m.url)).toEqual(
      expect.arrayContaining(["https://a.com/one", "https://b.com/two"])
    );
  });
});

describe("parse recipe from URL command", () => {
  let plugin: TestPlugin;
  let notices: string[];

  beforeEach(() => {
    vi.restoreAllMocks();
    notices = [];
    vi.spyOn(Obsidian, "Notice").mockImplementation(function (message: string) {
      notices.push(message);
      return {} as Obsidian.Notice;
    } as unknown as typeof Obsidian.Notice);

    plugin = createPlugin();
  });

  const runExtractUrl = async () => {
    await (
      plugin as unknown as {extractRecipeFromUrlInActiveFile: () => Promise<void>}
    ).extractRecipeFromUrlInActiveFile();
  };

  it("shows notice when no active file", async () => {
    plugin.app.workspace.getActiveFile = vi.fn().mockReturnValue(null);

    await runExtractUrl();

    expect(notices).toEqual(["Open a markdown file to extract a recipe from a URL."]);
  });

  it("shows notice when active file is not markdown", async () => {
    plugin.app.workspace.getActiveFile = vi.fn().mockReturnValue(new Obsidian.TFile("notes.txt"));

    await runExtractUrl();

    expect(notices).toEqual(["Open a markdown file to extract a recipe from a URL."]);
  });

  it("shows notice when file has no URLs", async () => {
    const activeFile = new Obsidian.TFile("notes.md");
    plugin.app.workspace.getActiveFile = vi.fn().mockReturnValue(activeFile);
    plugin.app.vault.read = vi.fn().mockResolvedValue("No URLs here.");
    plugin.app.vault.modify = vi.fn().mockResolvedValue(undefined);

    await runExtractUrl();

    expect(notices).toEqual(["No URLs found in this file."]);
    expect(plugin.app.vault.modify).not.toHaveBeenCalled();
  });

  it("fetches URL, calls LLM, and inserts result before the URL", async () => {
    const activeFile = new Obsidian.TFile("recipes.md");
    const content = "Start\nhttps://example.com/recipe\nEnd";

    plugin.app.workspace.getActiveFile = vi.fn().mockReturnValue(activeFile);
    plugin.app.vault.read = vi.fn().mockResolvedValue(content);
    plugin.app.vault.modify = vi.fn().mockResolvedValue(undefined);

    const fetchSpy = vi
      .spyOn(
        plugin as unknown as {fetchUrlContent: (url: string) => Promise<string>},
        "fetchUrlContent"
      )
      .mockResolvedValue("Fetched page content");

    const llmSpy = vi
      .spyOn(
        plugin as unknown as {
          callLlmForUrl: (url: string, pageContent: string) => Promise<string>;
        },
        "callLlmForUrl"
      )
      .mockResolvedValue("# Extracted Recipe");

    await runExtractUrl();

    expect(fetchSpy).toHaveBeenCalledWith("https://example.com/recipe");
    expect(llmSpy).toHaveBeenCalledWith("https://example.com/recipe", "Fetched page content");

    const expected = "Start\n# Extracted Recipe\n\nhttps://example.com/recipe\nEnd";
    expect(plugin.app.vault.modify).toHaveBeenCalledWith(activeFile, expected);
  });
});
