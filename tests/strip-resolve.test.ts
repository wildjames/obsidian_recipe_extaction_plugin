import {describe, expect, it, vi} from "vitest";
import RecipeParsingPlugin from "../src/main";
import * as Obsidian from "obsidian";

type TestPlugin = RecipeParsingPlugin & {
  stripImageEmbeds: (content: string) => string;
  resolveImageFile: (sourceFile: Obsidian.TFile, linkPath: string) => Obsidian.TFile | null;
};

const createPlugin = (): TestPlugin => {
  const app = new Obsidian.App();
  return new RecipeParsingPlugin(app) as TestPlugin;
};

describe("stripImageEmbeds", () => {
  it("removes wiki image embeds", () => {
    const plugin = createPlugin();
    const content = "Start ![[image.png]] end";

    expect(plugin.stripImageEmbeds(content)).toBe("Start  end");
  });

  it("removes markdown image embeds", () => {
    const plugin = createPlugin();
    const content = "Intro ![alt](path.png) outro";

    expect(plugin.stripImageEmbeds(content)).toBe("Intro  outro");
  });

  it("removes HTML img tags (case-insensitive)", () => {
    const plugin = createPlugin();
    const content = "Text <IMG src=\"x\"> done";

    expect(plugin.stripImageEmbeds(content)).toBe("Text  done");
  });

  it("leaves non-image content untouched", () => {
    const plugin = createPlugin();
    const content = "Keep [[note]] and [link](file.md) <div>ok</div>";

    expect(plugin.stripImageEmbeds(content)).toBe(content);
  });

  it("handles multiple images in a single file", () => {
    const plugin = createPlugin();
    const content = "A ![[one.png]] B ![alt](two.jpg) C <img src='x'> D";

    expect(plugin.stripImageEmbeds(content)).toBe("A  B  C  D");
  });
});

describe("resolveImageFile", () => {
  it("trims whitespace and ignores empty paths", () => {
    const plugin = createPlugin();
    const sourceFile = new Obsidian.TFile("notes.md");
    plugin.app.metadataCache.getFirstLinkpathDest = vi.fn();

    const result = plugin.resolveImageFile(sourceFile, "   ");

    expect(result).toBeNull();
    expect(plugin.app.metadataCache.getFirstLinkpathDest).not.toHaveBeenCalled();
  });

  it("rejects http/https URLs", () => {
    const plugin = createPlugin();
    const sourceFile = new Obsidian.TFile("notes.md");
    plugin.app.metadataCache.getFirstLinkpathDest = vi.fn();

    expect(plugin.resolveImageFile(sourceFile, "https://example.com/image.png")).toBeNull();
    expect(plugin.resolveImageFile(sourceFile, "http://example.com/image.png")).toBeNull();
    expect(plugin.app.metadataCache.getFirstLinkpathDest).not.toHaveBeenCalled();
  });

  it("rejects data URLs", () => {
    const plugin = createPlugin();
    const sourceFile = new Obsidian.TFile("notes.md");
    plugin.app.metadataCache.getFirstLinkpathDest = vi.fn();

    expect(plugin.resolveImageFile(sourceFile, "data:image/png;base64,abc")).toBeNull();
    expect(plugin.app.metadataCache.getFirstLinkpathDest).not.toHaveBeenCalled();
  });

  it("strips alias and heading portions", () => {
    const plugin = createPlugin();
    const sourceFile = new Obsidian.TFile("notes.md");
    const resolvedFile = new Obsidian.TFile("assets/photo.png");

    plugin.app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(resolvedFile);

    const result = plugin.resolveImageFile(sourceFile, "photo.png#Section|alias");

    expect(plugin.app.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith(
      "photo.png",
      sourceFile.path
    );
    expect(result).toBe(resolvedFile);
  });

  it("resolves to a TFile when metadata cache returns a file", () => {
    const plugin = createPlugin();
    const sourceFile = new Obsidian.TFile("notes.md");
    const resolvedFile = new Obsidian.TFile("assets/shot.png");

    plugin.app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(resolvedFile);

    expect(plugin.resolveImageFile(sourceFile, "shot.png")).toBe(resolvedFile);
  });

  it("returns null when no destination is found", () => {
    const plugin = createPlugin();
    const sourceFile = new Obsidian.TFile("notes.md");
    plugin.app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(null);

    expect(plugin.resolveImageFile(sourceFile, "missing.png")).toBeNull();
  });
});
