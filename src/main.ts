import {App, Notice, Plugin, PluginSettingTab, Setting, TFile, requestUrl} from "obsidian";
import {DEFAULT_SETTINGS, RecipeParsingSettings} from "./settings";

type ImageTextPart = {type: "text"; text: string};
type ImageUrlPart = {type: "image_url"; image_url: {url: string}};

type ChatMessage = {
  role: "system" | "user";
  content: string | Array<ImageTextPart | ImageUrlPart>;
};

type ImageLinkMatch = {
  linkPath: string;
  start: number;
};

export default class RecipeParsingPlugin extends Plugin {
  settings!: RecipeParsingSettings;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addSettingTab(new RecipeParsingSettingTab(this.app, this));

    this.addCommand({
      id: "parse-recipe-book-attachments",
      name: "Parse recipe images",
      callback: async () => {
        await this.extractRecipeInformationFromActiveFile();
      }
    });

    this.addCommand({
      id: "build-shopping-list-from-meal-plan",
      name: "Build shopping list from meal plan",
      callback: async () => {
        await this.buildShoppingListFromMealPlan();
      }
    });
  }

  async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) as
      | (RecipeParsingSettings & {model?: string})
      | null;

    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved ?? {});

    const legacyModel = saved?.model?.trim();
    if (legacyModel && !saved?.imageModel && !saved?.textModel) {
      this.settings.imageModel = legacyModel;
      this.settings.textModel = legacyModel;
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private async extractRecipeInformationFromActiveFile(): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile || activeFile.extension !== "md") {
      new Notice("Open a markdown file to extract ingredients.");
      return;
    }

    const noteContent = await this.app.vault.read(activeFile);
    const matches = this.findImageLinks(noteContent);

    if (matches.length === 0) {
      new Notice("No image attachments found in this file.");
      return;
    }

    let updatedContent = noteContent;

    try {
      const resolvedImages: Array<{file: TFile; label: string}> = [];
      for (const match of matches) {
        const imageFile = this.resolveImageFile(activeFile, match.linkPath);
        if (!imageFile) {
          throw new Error(`Attachment not found: ${match.linkPath}`);
        }
        resolvedImages.push({file: imageFile, label: match.linkPath});
      }

      const llmResult = await this.callLlmForImages(resolvedImages);
      if (!llmResult.trim()) {
        throw new Error("LLM returned empty response for images");
      }

      const insertText = `${llmResult.trim()}\n\n`;
      const firstMatch = [...matches].sort((a, b) => a.start - b.start)[0];
      updatedContent =
        updatedContent.slice(0, firstMatch.start) +
        insertText +
        updatedContent.slice(firstMatch.start);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(message);
      return;
    }

    if (updatedContent !== noteContent) {
      await this.app.vault.modify(activeFile, updatedContent);
    }

    new Notice("Recipe information extracted and inserted for detected images.");
  }

  private async buildShoppingListFromMealPlan(): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile || activeFile.extension !== "md") {
      new Notice("Open a meal plan markdown file to build a shopping list.");
      return;
    }

    const planContent = await this.app.vault.read(activeFile);
    const headerMatch = /^(#{1,6})\s*Need to buy\b[^\n]*$/gim.exec(planContent);
    if (!headerMatch || headerMatch.index === undefined) {
      new Notice("No '# Need to buy' section found in the active file.");
      return;
    }

    const sectionStart = headerMatch.index;
    const sectionLevel = headerMatch[1].length;
    const afterHeaderIndex = sectionStart + headerMatch[0].length;
    let sectionEnd = planContent.length;

    for (const match of planContent.matchAll(/^(#{1,6})\s+/gm)) {
      if (match.index === undefined || match.index <= afterHeaderIndex) {
        continue;
      }
      const level = match[1].length;
      if (level <= sectionLevel) {
        sectionEnd = match.index;
        break;
      }
    }

    const recipeFiles = this.findLinkedRecipeFiles(activeFile, planContent);
    if (recipeFiles.length === 0) {
      new Notice("No linked recipe files found in the meal plan.");
      return;
    }

    const recipeContents: string[] = [];
    for (const file of recipeFiles) {
      const raw = await this.app.vault.read(file);
      const cleaned = this.stripImageEmbeds(raw);
      recipeContents.push(`---\nFile: ${file.path}\n${cleaned}`);
    }

    const prompt = this.settings.shoppingListPrompt.trim();
    if (!prompt) {
      new Notice("Shopping list prompt is empty.");
      return;
    }

    const templateSection = planContent.slice(sectionStart, sectionEnd).trim();
    const llmResult = await this.callLlm([
      // Single prompt for better speed - this task is simple and doesn't require much reasoning.
      {
        role: "user",
        content:
          `Meal plan:\n${planContent.trim()}\n\n` +
          `Recipes (omit any images already removed):\n${recipeContents.join("\n\n")}` +
          `Meal plan shopping list template:\n${templateSection}\n\n`
      },
      {role: "system", content: prompt}
    ], this.settings.textModel);

    const updatedSection = llmResult.trim();
    if (!/^#\s*Need to buy/i.test(updatedSection)) {
      new Notice("LLM response did not include a '# Need to buy' section.");
      return;
    }

    const trailingContent = planContent.slice(sectionEnd);
    const separator =
      trailingContent === "" ? "\n" : trailingContent.startsWith("\n") ? "" : "\n";
    const updatedContent =
      planContent.slice(0, sectionStart) + updatedSection + separator + trailingContent;

    await this.app.vault.modify(activeFile, updatedContent);
    new Notice("Shopping list updated from linked recipes.");
  }

  private findImageLinks(content: string): ImageLinkMatch[] {
    const matches: ImageLinkMatch[] = [];
    const wikiImageRegex = /!\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]+)?\]\]/g;
    const markdownImageRegex = /!\[[^\]]*\]\(([^\)\s]+)(?:\s+"[^"]*")?\)/g;

    for (const match of content.matchAll(wikiImageRegex)) {
      if (match.index === undefined) {
        continue;
      }
      matches.push({linkPath: match[1], start: match.index});
    }

    for (const match of content.matchAll(markdownImageRegex)) {
      if (match.index === undefined) {
        continue;
      }
      matches.push({linkPath: match[1], start: match.index});
    }

    return matches;
  }

  private findLinkedRecipeFiles(sourceFile: TFile, content: string): TFile[] {
    const linkPaths = new Set<string>();
    const wikiLinkRegex = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]+)?\]\]/g;

    for (const match of content.matchAll(wikiLinkRegex)) {
      if (match.index === undefined) {
        continue;
      }
      const preceding = match.index > 0 ? content[match.index - 1] : "";
      if (preceding === "!") {
        continue;
      }
      linkPaths.add(match[1]);
    }

    const files: TFile[] = [];
    for (const linkPath of linkPaths) {
      const destination = this.app.metadataCache.getFirstLinkpathDest(
        linkPath,
        sourceFile.path
      );
      if (destination instanceof TFile && destination.extension === "md") {
        files.push(destination);
      }
    }

    return files;
  }

  private stripImageEmbeds(content: string): string {
    const withoutWikiImages = content.replace(
      /!\[\[[^\]]+\]\]/g,
      ""
    );
    const withoutMarkdownImages = withoutWikiImages.replace(
      /!\[[^\]]*\]\([^\)]+\)/g,
      ""
    );
    const withoutHtmlImages = withoutMarkdownImages.replace(
      /<img[^>]*>/gi,
      ""
    );

    return withoutHtmlImages;
  }

  private resolveImageFile(sourceFile: TFile, linkPath: string): TFile | null {
    const trimmed = linkPath.trim();
    if (!trimmed || /^https?:\/\//i.test(trimmed) || trimmed.startsWith("data:")) {
      return null;
    }

    const cleaned = trimmed.split("|")[0].split("#")[0];
    const destination = this.app.metadataCache.getFirstLinkpathDest(
      cleaned,
      sourceFile.path
    );

    return destination instanceof TFile ? destination : null;
  }

  private async callLlmForImages(
    images: Array<{file: TFile; label: string}>
  ): Promise<string> {
    const prompt = this.settings.bookExtractionPrompt.trim();
    if (!prompt) {
      throw new Error("Ingredients prompt is empty");
    }

    const contentParts: Array<ImageTextPart | ImageUrlPart> = [
      {
        type: "text",
        text:
          "Extract information from all images. Return a combined response."
      }
    ];

    for (const [index, image] of images.entries()) {
      const binary = await this.app.vault.readBinary(image.file);
      const base64 = this.toBase64(binary);
      const mime = this.getMimeType(image.file.extension);
      const dataUrl = `data:${mime};base64,${base64}`;
      const label = image.label || image.file.name;

      contentParts.push({
        type: "text",
        text: `Image ${index + 1}: ${label}`
      });
      contentParts.push({type: "image_url", image_url: {url: dataUrl}});
    }

    const messages: ChatMessage[] = [
      {
        role: "user",
        content: contentParts
      },
      {role: "system", content: prompt}
    ];

    return await this.callLlm(messages, this.settings.imageModel);
  }

  private async callLlm(messages: ChatMessage[], model: string): Promise<string> {
    if (!this.settings.llmEndpoint.trim()) {
      throw new Error("LLM endpoint is empty");
    }

    const trimmedModel = model.trim();
    if (!trimmedModel) {
      throw new Error("Model is empty");
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };

    if (this.settings.apiKey.trim()) {
      headers.Authorization = `Bearer ${this.settings.apiKey.trim()}`;
    }

    const response = await requestUrl({
      method: "POST",
      url: this.settings.llmEndpoint,
      headers,
      body: JSON.stringify({
        model: trimmedModel,
        messages,
        temperature: 0.2
      })
    });

    if (response.status !== 200) {
      throw new Error(`LLM request failed (${response.status})`);
    }

    const content = response.json?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("Unexpected LLM response shape");
    }

    return content;
  }

  private getMimeType(extension: string): string {
    switch (extension.toLowerCase()) {
      case "jpg":
      case "jpeg":
        return "image/jpeg";
      case "png":
        return "image/png";
      case "webp":
        return "image/webp";
      case "gif":
        return "image/gif";
      case "bmp":
        return "image/bmp";
      default:
        return "application/octet-stream";
    }
  }

  private toBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 0x8000;

    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }

    return btoa(binary);
  }
}

class RecipeParsingSettingTab extends PluginSettingTab {
  plugin: RecipeParsingPlugin;

  constructor(app: App, plugin: RecipeParsingPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const {containerEl} = this;
    containerEl.empty();

    this.addTextSetting(containerEl, {
      name: "LLM endpoint",
      desc: "OpenAI-compatible chat completions endpoint",
      placeholder: "https://api.openai.com/v1/chat/completions",
      value: this.plugin.settings.llmEndpoint,
      onChange: (value) => {
        this.plugin.settings.llmEndpoint = value.trim();
      }
    });

    this.addTextSetting(containerEl, {
      name: "API key",
      desc: "Authorization key for your LLM provider",
      placeholder: "sk-...",
      value: this.plugin.settings.apiKey,
      onChange: (value) => {
        this.plugin.settings.apiKey = value.trim();
      }
    });

    this.addTextSetting(containerEl, {
      name: "Image model",
      desc: "Model name used for parsing images",
      placeholder: "gpt-5.2",
      value: this.plugin.settings.imageModel,
      onChange: (value) => {
        this.plugin.settings.imageModel = value.trim() || "gpt-5.2";
      }
    });

    this.addTextSetting(containerEl, {
      name: "Text model",
      desc: "Model name used for Text generation",
      placeholder: "gpt-5.2",
      value: this.plugin.settings.textModel,
      onChange: (value) => {
        this.plugin.settings.textModel = value.trim() || "gpt-5.2";
      }
    });

    this.addTextAreaSetting(containerEl, {
      name: "Ingredients prompt",
      desc: "Prompt used when extracting ingredients from image attachments.",
      value: this.plugin.settings.bookExtractionPrompt,
      onChange: (value) => {
        this.plugin.settings.bookExtractionPrompt = value;
      }
    });

    this.addTextAreaSetting(containerEl, {
      name: "Shopping list prompt",
      desc: "Prompt used when building a shopping list from linked recipes.",
      value: this.plugin.settings.shoppingListPrompt,
      onChange: (value) => {
        this.plugin.settings.shoppingListPrompt = value;
      }
    });
  }

  private addTextSetting(
    containerEl: HTMLElement,
    options: {
      name: string;
      desc: string;
      placeholder: string;
      value: string;
      onChange: (value: string) => void;
    }
  ): void {
    new Setting(containerEl)
      .setName(options.name)
      .setDesc(options.desc)
      .addText((text) =>
        text
          .setPlaceholder(options.placeholder)
          .setValue(options.value)
          .onChange(async (value) => {
            options.onChange(value);
            await this.plugin.saveSettings();
          })
      );
  }

  private addTextAreaSetting(
    containerEl: HTMLElement,
    options: {
      name: string;
      desc: string;
      value: string;
      onChange: (value: string) => void;
    }
  ): void {
    new Setting(containerEl)
      .setName(options.name)
      .setDesc(options.desc)
      .addTextArea((text) =>
        text.setValue(options.value).onChange(async (value) => {
          options.onChange(value);
          await this.plugin.saveSettings();
        })
      );
  }
}
