import {beforeEach, describe, expect, it, vi} from "vitest";
import RecipeParsingPlugin from "../src/main";
import {DEFAULT_SETTINGS} from "../src/settings";
import * as Obsidian from "obsidian";

type TestPlugin = RecipeParsingPlugin & {
  settings: typeof DEFAULT_SETTINGS;
};

const createPlugin = (): TestPlugin => {
  const app = new Obsidian.App();
  const plugin = new RecipeParsingPlugin(app) as TestPlugin;
  plugin.settings = {...DEFAULT_SETTINGS};
  return plugin;
};

describe("parse recipe images command", () => {
  let plugin: TestPlugin;
  let notices: string[];

  beforeEach(() => {
    vi.restoreAllMocks();
    notices = [];
    vi.spyOn(Obsidian, "Notice").mockImplementation((message: string) => {
      notices.push(message);
      return {} as Obsidian.Notice;
    });

    plugin = createPlugin();
  });

  const runExtract = async () => {
    await (plugin as unknown as {extractRecipeInformationFromActiveFile: () => Promise<void>})
      .extractRecipeInformationFromActiveFile();
  };

  it("shows notice when no active file", async () => {
    plugin.app.workspace.getActiveFile = vi.fn().mockReturnValue(null);

    await runExtract();

    expect(notices).toEqual(["Open a markdown file to extract ingredients."]);
  });

  it("shows notice when active file is not markdown", async () => {
    plugin.app.workspace.getActiveFile = vi.fn().mockReturnValue(new Obsidian.TFile("notes.txt"));

    await runExtract();

    expect(notices).toEqual(["Open a markdown file to extract ingredients."]);
  });

  it("shows notice when file has no image links", async () => {
    const activeFile = new Obsidian.TFile("notes.md");
    plugin.app.workspace.getActiveFile = vi.fn().mockReturnValue(activeFile);
    plugin.app.vault.read = vi.fn().mockResolvedValue("No images here.");
    plugin.app.vault.modify = vi.fn().mockResolvedValue();

    await runExtract();

    expect(notices).toEqual(["No image attachments found in this file."]);
    expect(plugin.app.vault.modify).not.toHaveBeenCalled();
  });

  it("inserts extracted text before each image link in reverse order", async () => {
    const activeFile = new Obsidian.TFile("recipes.md");
    const content = "Start\n![[one.png]]\nMiddle\n![two](two.jpg)\nEnd";
    const expected =
      "Start\nTextOne\n\n![[one.png]]\nMiddle\nTextTwo\n\n![two](two.jpg)\nEnd";

    plugin.app.workspace.getActiveFile = vi.fn().mockReturnValue(activeFile);
    plugin.app.vault.read = vi.fn().mockResolvedValue(content);
    plugin.app.vault.modify = vi.fn().mockResolvedValue();
    plugin.app.metadataCache.getFirstLinkpathDest = vi.fn((linkPath: string) => {
      if (linkPath === "one.png") {
        return new Obsidian.TFile("one.png");
      }
      if (linkPath === "two.jpg") {
        return new Obsidian.TFile("two.jpg");
      }
      return null;
    });

    vi.spyOn(plugin as unknown as {callLlmForImage: (file: Obsidian.TFile) => Promise<string>}, "callLlmForImage")
      .mockImplementation(async (file) => {
        if (file.name === "one.png") {
          return "TextOne";
        }
        if (file.name === "two.jpg") {
          return "TextTwo";
        }
        return "";
      });

    await runExtract();

    expect(plugin.app.vault.modify).toHaveBeenCalledWith(activeFile, expected);
    expect(notices).toContain("Recipe information extracted and inserted detected images.");
  });

  it("does not modify file when LLM response is empty", async () => {
    const activeFile = new Obsidian.TFile("recipes.md");
    const content = "Intro\n![[image.png]]";

    plugin.app.workspace.getActiveFile = vi.fn().mockReturnValue(activeFile);
    plugin.app.vault.read = vi.fn().mockResolvedValue(content);
    plugin.app.vault.modify = vi.fn().mockResolvedValue();
    plugin.app.metadataCache.getFirstLinkpathDest = vi.fn(() => new Obsidian.TFile("image.png"));

    vi.spyOn(plugin as unknown as {callLlmForImage: (file: Obsidian.TFile) => Promise<string>}, "callLlmForImage")
      .mockResolvedValue("   ");

    await runExtract();

    expect(plugin.app.vault.modify).not.toHaveBeenCalled();
    expect(notices).toEqual([
      "image.png: LLM returned empty response for: image.png"
    ]);
  });

  it("uses resolveImageFile and errors when attachment not found", async () => {
    const activeFile = new Obsidian.TFile("recipes.md");
    const content = "Intro\n![[missing.png]]";

    plugin.app.workspace.getActiveFile = vi.fn().mockReturnValue(activeFile);
    plugin.app.vault.read = vi.fn().mockResolvedValue(content);
    plugin.app.vault.modify = vi.fn().mockResolvedValue();

    const resolveSpy = vi
      .spyOn(plugin as unknown as {resolveImageFile: (file: Obsidian.TFile, path: string) => Obsidian.TFile | null}, "resolveImageFile")
      .mockReturnValue(null);

    await runExtract();

    expect(resolveSpy).toHaveBeenCalledWith(activeFile, "missing.png");
    expect(plugin.app.vault.modify).not.toHaveBeenCalled();
    expect(notices).toEqual([
      "missing.png: Attachment not found: missing.png"
    ]);
  });

  it("does not modify file when an error occurs mid-loop", async () => {
    const activeFile = new Obsidian.TFile("recipes.md");
    const content = "Start\n![[one.png]]\nMiddle\n![two](two.jpg)\nEnd";

    plugin.app.workspace.getActiveFile = vi.fn().mockReturnValue(activeFile);
    plugin.app.vault.read = vi.fn().mockResolvedValue(content);
    plugin.app.vault.modify = vi.fn().mockResolvedValue();
    plugin.app.metadataCache.getFirstLinkpathDest = vi.fn((linkPath: string) => {
      if (linkPath === "one.png") {
        return new Obsidian.TFile("one.png");
      }
      if (linkPath === "two.jpg") {
        return new Obsidian.TFile("two.jpg");
      }
      return null;
    });

    vi.spyOn(plugin as unknown as {callLlmForImage: (file: Obsidian.TFile) => Promise<string>}, "callLlmForImage")
      .mockImplementation(async (file) => {
        if (file.name === "two.jpg") {
          return "TextTwo";
        }
        throw new Error("boom");
      });

    await runExtract();

    expect(plugin.app.vault.modify).not.toHaveBeenCalled();
    expect(notices).toEqual(["one.png: boom"]);
  });
});
