import {describe, expect, it} from "vitest";
import RecipeParsingPlugin from "../src/main";
import * as Obsidian from "obsidian";

type TestPlugin = RecipeParsingPlugin & {
  findImageLinks: (content: string) => Array<{linkPath: string; start: number}>;
  findLinkedRecipeFiles: (sourceFile: Obsidian.TFile, content: string) => Obsidian.TFile[];
};

const createPlugin = (): TestPlugin => {
  const app = new Obsidian.App();
  return new RecipeParsingPlugin(app) as TestPlugin;
};

describe("findImageLinks", () => {
  it("matches wiki embeds", () => {
    const plugin = createPlugin();
    const content = "Intro ![[image.png]] outro";
    const matches = plugin.findImageLinks(content);

    expect(matches).toHaveLength(1);
    expect(matches[0]).toEqual({
      linkPath: "image.png",
      start: content.indexOf("![[image.png]]")
    });
  });

  it("matches wiki embeds with alias and heading", () => {
    const plugin = createPlugin();
    const content = "![[image.png|alias]] and ![[photo.jpg#Section]]";
    const matches = plugin.findImageLinks(content);
    const sorted = [...matches].sort((a, b) => a.start - b.start);

    expect(sorted).toEqual([
      {linkPath: "image.png", start: content.indexOf("![[image.png|alias]]")},
      {linkPath: "photo.jpg", start: content.indexOf("![[photo.jpg#Section]]")}
    ]);
  });

  it("matches markdown images with optional title", () => {
    const plugin = createPlugin();
    const content = "![alt](path.png) and ![alt](photo.jpg \"title\")";
    const matches = plugin.findImageLinks(content);
    const sorted = [...matches].sort((a, b) => a.start - b.start);

    expect(sorted).toEqual([
      {linkPath: "path.png", start: content.indexOf("![alt](path.png)")},
      {linkPath: "photo.jpg", start: content.indexOf("![alt](photo.jpg \"title\")")}
    ]);
  });

  it("returns correct start indices for mixed matches", () => {
    const plugin = createPlugin();
    const content = "A ![[one.png]] B ![alt](two.jpg) C ![[three.webp|x]]";
    const matches = plugin.findImageLinks(content);
    const sorted = [...matches].sort((a, b) => a.start - b.start);

    expect(sorted).toEqual([
      {linkPath: "one.png", start: content.indexOf("![[one.png]]")},
      {linkPath: "two.jpg", start: content.indexOf("![alt](two.jpg)")},
      {linkPath: "three.webp", start: content.indexOf("![[three.webp|x]]")}
    ]);
  });

  it("does not include non-image links", () => {
    const plugin = createPlugin();
    const content = "[[note]] [text](file.png) ![img](real.png)";
    const matches = plugin.findImageLinks(content);

    expect(matches).toHaveLength(1);
    expect(matches[0].linkPath).toBe("real.png");
  });
});

describe("findLinkedRecipeFiles", () => {
  it("collects unique wiki links and resolves markdown files", () => {
    const plugin = createPlugin();
    const sourceFile = new Obsidian.TFile("plan.md");
    const content =
      "[[alpha]] and [[alpha|Alias]] plus [[beta#Section]] and [[note.txt]] and [[missing]]";

    plugin.app.metadataCache.getFirstLinkpathDest = (linkPath: string) => {
      if (linkPath === "alpha") {
        return new Obsidian.TFile("recipes/alpha.md");
      }
      if (linkPath === "beta") {
        return new Obsidian.TFile("beta.md");
      }
      if (linkPath === "note.txt") {
        return new Obsidian.TFile("note.txt");
      }
      return null;
    };

    const results = plugin.findLinkedRecipeFiles(sourceFile, content);

    expect(results.map((file) => file.path)).toEqual([
      "recipes/alpha.md",
      "beta.md"
    ]);
  });

  it("ignores image embeds and non-markdown files", () => {
    const plugin = createPlugin();
    const sourceFile = new Obsidian.TFile("plan.md");
    const content = "![[image.png]] and [[recipe]] and ![[photo.jpg|x]]";

    plugin.app.metadataCache.getFirstLinkpathDest = (linkPath: string) => {
      if (linkPath === "recipe") {
        return new Obsidian.TFile("recipe.md");
      }
      if (linkPath === "image.png") {
        return new Obsidian.TFile("image.png");
      }
      return null;
    };

    const results = plugin.findLinkedRecipeFiles(sourceFile, content);

    expect(results.map((file) => file.path)).toEqual(["recipe.md"]);
  });
});
