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

describe("build shopping list command", () => {
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

  const runBuild = async () => {
    await (plugin as unknown as {buildShoppingListFromMealPlan: () => Promise<void>})
      .buildShoppingListFromMealPlan();
  };

  it("shows notice when no active file", async () => {
    plugin.app.workspace.getActiveFile = vi.fn().mockReturnValue(null);

    await runBuild();

    expect(notices).toEqual(["Open a meal plan markdown file to build a shopping list."]);
  });

  it("shows notice when active file is not markdown", async () => {
    plugin.app.workspace.getActiveFile = vi.fn().mockReturnValue(new Obsidian.TFile("plan.txt"));

    await runBuild();

    expect(notices).toEqual(["Open a meal plan markdown file to build a shopping list."]);
  });

  it("shows notice when '# Need to buy' section is missing", async () => {
    const activeFile = new Obsidian.TFile("plan.md");
    plugin.app.workspace.getActiveFile = vi.fn().mockReturnValue(activeFile);
    plugin.app.vault.read = vi.fn().mockResolvedValue("# Meal plan\n\nNo shopping list here.");

    await runBuild();

    expect(notices).toEqual(["No '# Need to buy' section found in the active file."]);
  });

  it("shows notice when no linked recipe files are found", async () => {
    const activeFile = new Obsidian.TFile("plan.md");
    plugin.app.workspace.getActiveFile = vi.fn().mockReturnValue(activeFile);
    plugin.app.vault.read = vi.fn().mockResolvedValue("# Need to buy\n- [ ] item");
    plugin.app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(null);

    await runBuild();

    expect(notices).toEqual(["No linked recipe files found in the meal plan."]);
  });

  it("shows notice when shopping list prompt is empty", async () => {
    const activeFile = new Obsidian.TFile("plan.md");
    const recipeFile = new Obsidian.TFile("recipes/alpha.md");
    const planContent = "# Need to buy\n- [ ] item\n\n[[alpha]]";

    plugin.settings.shoppingListPrompt = "   ";
    plugin.app.workspace.getActiveFile = vi.fn().mockReturnValue(activeFile);
    plugin.app.vault.read = vi.fn(async (file: Obsidian.TFile) => {
      if (file.path === activeFile.path) {
        return planContent;
      }
      return "# Recipe\n";
    });
    plugin.app.vault.modify = vi.fn().mockResolvedValue();
    plugin.app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(recipeFile);

    const callSpy = vi.spyOn(
      plugin as unknown as {callLlm: () => Promise<string>},
      "callLlm"
    );

    await runBuild();

    expect(callSpy).not.toHaveBeenCalled();
    expect(plugin.app.vault.modify).not.toHaveBeenCalled();
    expect(notices).toEqual(["Shopping list prompt is empty."]);
  });

  it("strips image embeds and builds prompt with template and cleaned recipes", async () => {
    const activeFile = new Obsidian.TFile("plan.md");
    const recipeFile = new Obsidian.TFile("recipes/alpha.md");
    const planContent = "# Meal plan\n\n[[alpha]]\n\n# Need to buy\n- [ ] produce\n- [ ] pantry\n";
    const recipeContent =
      "# Recipe\n![[photo.png]]\n![alt](photo.jpg)\n<img src=\"x\">\nKeep this.";

    plugin.app.workspace.getActiveFile = vi.fn().mockReturnValue(activeFile);
    plugin.app.vault.read = vi.fn(async (file: Obsidian.TFile) => {
      if (file.path === activeFile.path) {
        return planContent;
      }
      return recipeContent;
    });
    plugin.app.vault.modify = vi.fn().mockResolvedValue();
    plugin.app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(recipeFile);

    let capturedMessages: unknown = null;
    vi.spyOn(plugin as unknown as {callLlm: (messages: unknown) => Promise<string>}, "callLlm")
      .mockImplementation(async (messages) => {
        capturedMessages = messages;
        return "# Need to buy\n- [ ] apples";
      });

    await runBuild();

    const templateSection = planContent.match(/(^#\s*Need to buy[\s\S]*)$/im)?.[0].trim();

    expect(Array.isArray(capturedMessages)).toBe(true);
    const messages = capturedMessages as Array<{role: string; content: string}>;
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({
      role: "system",
      content: plugin.settings.shoppingListPrompt.trim()
    });
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toContain("Meal plan shopping list template:");
    expect(messages[1].content).toContain(templateSection ?? "");
    expect(messages[1].content).toContain("Recipes (omit any images already removed):");
    expect(messages[1].content).toContain(`---\nFile: ${recipeFile.path}`);
    expect(messages[1].content).toContain("Keep this.");
    expect(messages[1].content).not.toMatch(/!\[\[/);
    expect(messages[1].content).not.toMatch(/!\[[^\]]*\]\([^\)]*\)/);
    expect(messages[1].content).not.toMatch(/<img[^>]*>/i);
  });

  it("requires LLM response to include '# Need to buy' header", async () => {
    const activeFile = new Obsidian.TFile("plan.md");
    const recipeFile = new Obsidian.TFile("recipes/alpha.md");
    const planContent = "# Need to buy\n- [ ] item\n\n[[alpha]]";

    plugin.app.workspace.getActiveFile = vi.fn().mockReturnValue(activeFile);
    plugin.app.vault.read = vi.fn(async (file: Obsidian.TFile) => {
      if (file.path === activeFile.path) {
        return planContent;
      }
      return "# Recipe";
    });
    plugin.app.vault.modify = vi.fn().mockResolvedValue();
    plugin.app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(recipeFile);

    vi.spyOn(plugin as unknown as {callLlm: () => Promise<string>}, "callLlm")
      .mockResolvedValue("No header here");

    await runBuild();

    expect(plugin.app.vault.modify).not.toHaveBeenCalled();
    expect(notices).toEqual(["LLM response did not include a '# Need to buy' section."]);
  });

  it("replaces only the Need to buy section and keeps the rest intact", async () => {
    const activeFile = new Obsidian.TFile("plan.md");
    const recipeFile = new Obsidian.TFile("recipes/alpha.md");
    const planContent =
      "# Meal plan\nIntro text.\n\n[[alpha]]\n\n# Need to buy\n- [ ] item\n\n# Notes\nKeep this.\n";
    const updatedSection = "# Need to buy\n- [ ] apples";

    plugin.app.workspace.getActiveFile = vi.fn().mockReturnValue(activeFile);
    plugin.app.vault.read = vi.fn(async (file: Obsidian.TFile) => {
      if (file.path === activeFile.path) {
        return planContent;
      }
      return "# Recipe";
    });
    plugin.app.vault.modify = vi.fn().mockResolvedValue();
    plugin.app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(recipeFile);

    vi.spyOn(plugin as unknown as {callLlm: () => Promise<string>}, "callLlm")
      .mockResolvedValue(updatedSection);

    await runBuild();

    const expectedPrefix = "# Meal plan\nIntro text.\n\n[[alpha]]\n\n";
    const expectedSuffix = "\n# Notes\nKeep this.\n";
    const modifyCalls = (plugin.app.vault.modify as unknown as {mock: {calls: Array<[Obsidian.TFile, string]>}})
      .mock.calls;

    expect(modifyCalls).toHaveLength(1);
    const [, updatedContent] = modifyCalls[0];
    expect(updatedContent.startsWith(expectedPrefix)).toBe(true);
    expect(updatedContent).toContain(updatedSection);
    expect(updatedContent.endsWith(expectedSuffix)).toBe(true);
  });

  it("shows success notice after updating content", async () => {
    const activeFile = new Obsidian.TFile("plan.md");
    const recipeFile = new Obsidian.TFile("recipes/alpha.md");
    const planContent = "# Need to buy\n- [ ] item\n\n[[alpha]]";

    plugin.app.workspace.getActiveFile = vi.fn().mockReturnValue(activeFile);
    plugin.app.vault.read = vi.fn(async (file: Obsidian.TFile) => {
      if (file.path === activeFile.path) {
        return planContent;
      }
      return "# Recipe";
    });
    plugin.app.vault.modify = vi.fn().mockResolvedValue();
    plugin.app.metadataCache.getFirstLinkpathDest = vi.fn().mockReturnValue(recipeFile);

    vi.spyOn(plugin as unknown as {callLlm: () => Promise<string>}, "callLlm")
      .mockResolvedValue("# Need to buy\n- [ ] apples");

    await runBuild();

    expect(notices).toContain("Shopping list updated from linked recipes.");
  });
});
