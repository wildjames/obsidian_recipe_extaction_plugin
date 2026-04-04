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

type UrlLinkMatch = {
  url: string;
  fullMatch: string;
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

    this.addCommand({
      id: "parse-recipe-from-url",
      name: "Parse recipe from URL",
      callback: async () => {
        await this.extractRecipeFromUrlInActiveFile();
      }
    });

    this.addCommand({
      id: "reset-prompts-to-defaults",
      name: "Reset prompts to defaults",
      callback: async () => {
        this.settings.bookExtractionPrompt = DEFAULT_SETTINGS.bookExtractionPrompt;
        this.settings.urlExtractionPrompt = DEFAULT_SETTINGS.urlExtractionPrompt;
        this.settings.shoppingListPrompt = DEFAULT_SETTINGS.shoppingListPrompt;
        await this.saveSettings();
        new Notice("Prompts reset to defaults.");
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

      if (this.settings.deleteImagesAfterProcessing) {
        for (const image of resolvedImages) {
          await this.app.vault.delete(image.file);
        }
      }
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

    const mealPlanWithoutShoppingList = planContent.slice(0, sectionStart).trim();
    const shoppingListTemplate = this.buildShoppingListTemplate(
      planContent.slice(sectionStart, sectionEnd).trim(),
      sectionLevel
    );
    new Notice("Generating shopping list from linked recipes... This may take a moment.");
    const llmResult = await this.callLlm(
      [
        // Single prompt for better speed - this task is simple and doesn't require much reasoning.
        {
          role: "user",
          content:
            `Meal plan:\n${mealPlanWithoutShoppingList}\n\n` +
            `Recipes (omit any images already removed):\n${recipeContents.join("\n\n")}\n\n` +
            `Meal plan shopping list headers:\n${shoppingListTemplate}\n\n`
        },
        {role: "system", content: prompt}
      ],
      this.settings.textModel
    );

    const updatedSection = llmResult.trim();
    if (!/^#\s*Need to buy/i.test(updatedSection)) {
      new Notice("LLM response did not include a '# Need to buy' section.\nYou might want to try again or adjust the shopping list prompt.");
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

  private async extractRecipeFromUrlInActiveFile(): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile || activeFile.extension !== "md") {
      new Notice("Open a markdown file to extract a recipe from a URL.");
      return;
    }

    const noteContent = await this.app.vault.read(activeFile);
    const urlMatches = this.findUrlLinks(noteContent);

    if (urlMatches.length === 0) {
      new Notice("No URLs found in this file.");
      return;
    }

    let updatedContent = noteContent;
    let offset = 0;

    try {
      const sorted = [...urlMatches].sort((a, b) => a.start - b.start);

      for (const match of sorted) {
        new Notice(`Fetching recipe from ${match.url}...`);
        const pageContent = await this.fetchUrlContent(match.url);
        const llmResult = await this.callLlmForUrl(match.url, pageContent);

        if (!llmResult.trim()) {
          new Notice(`LLM returned empty response for ${match.url}`);
          continue;
        }

        const insertText = `${llmResult.trim()}\n\n`;
        const insertPos = match.start + offset;
        updatedContent =
          updatedContent.slice(0, insertPos) +
          insertText +
          updatedContent.slice(insertPos);
        offset += insertText.length;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(message);
      return;
    }

    if (updatedContent !== noteContent) {
      await this.app.vault.modify(activeFile, updatedContent);
    }

    new Notice("Recipe information extracted from URLs.");
  }

  findUrlLinks(content: string): UrlLinkMatch[] {
    const matches: UrlLinkMatch[] = [];

    // Markdown links: [text](https://...)
    const markdownLinkRegex = /(?<!!)\[[^\]]*\]\((https?:\/\/[^\)\s]+)\)/g;
    for (const match of content.matchAll(markdownLinkRegex)) {
      if (match.index === undefined) continue;
      matches.push({url: match[1], fullMatch: match[0], start: match.index});
    }

    // Bare URLs not already captured inside markdown link syntax: https://...
    const bareUrlRegex = /(?<!\]\()(?<!\()\bhttps?:\/\/[^\s)>\]]+/g;
    for (const match of content.matchAll(bareUrlRegex)) {
      if (match.index === undefined) continue;
      // Skip if this URL is already part of a markdown link
      const alreadyCaptured = matches.some(
        (m) => match.index! >= m.start && match.index! < m.start + m.fullMatch.length
      );
      if (alreadyCaptured) continue;
      // Skip image URLs (common image extensions)
      if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(match[0])) continue;
      matches.push({url: match[0], fullMatch: match[0], start: match.index});
    }

    return matches;
  }

  private async fetchUrlContent(url: string): Promise<string> {
    const response = await requestUrl({url, method: "GET"});
    if (response.status !== 200) {
      throw new Error(`Failed to fetch URL (${response.status}): ${url}`);
    }
    const html = response.text;
    return this.stripHtmlToText(html);
  }

  private stripHtmlToText(html: string): string {
    // Remove script and style blocks
    let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
    // Replace block-level tags with newlines
    text = text.replace(/<\/(p|div|br|h[1-6]|li|tr|section|article)\s*>/gi, "\n");
    text = text.replace(/<br\s*\/?>/gi, "\n");
    // Remove remaining HTML tags
    text = text.replace(/<[^>]+>/g, "");
    // Decode common HTML entities
    text = text.replace(/&amp;/g, "&");
    text = text.replace(/&lt;/g, "<");
    text = text.replace(/&gt;/g, ">");
    text = text.replace(/&quot;/g, "\"");
    text = text.replace(/&#39;/g, "'");
    text = text.replace(/&nbsp;/g, " ");
    // Collapse whitespace
    text = text.replace(/[ \t]+/g, " ");
    text = text.replace(/\n{3,}/g, "\n\n");
    return text.trim();
  }

  private async callLlmForUrl(url: string, pageContent: string): Promise<string> {
    const prompt = this.settings.urlExtractionPrompt.trim();
    if (!prompt) {
      throw new Error("URL extraction prompt is empty");
    }

    const messages: ChatMessage[] = [
      {
        role: "user",
        content: `Extract the recipe from the following webpage.\n\nURL: ${url}\n\nWebpage content:\n${pageContent}`
      },
      {role: "system", content: prompt}
    ];

    return await this.callLlm(messages, this.settings.textModel);
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

  private buildShoppingListTemplate(sectionContent: string, sectionLevel: number): string {
    const lines = sectionContent.split(/\r?\n/);
    const output: string[] = [];
    let hasSubheaders = false;

    for (const line of lines) {
      const headerMatch = /^(#{1,6})\s+/.exec(line);
      if (headerMatch) {
        const level = headerMatch[1].length;
        if (level === sectionLevel && output.length === 0) {
          output.push(line.trimEnd());
          continue;
        }

        if (level > sectionLevel) {
          hasSubheaders = true;
          if (output.length > 0 && output[output.length - 1] !== "") {
            output.push("");
          }
          output.push(line.trimEnd());
          output.push("- [ ] ");
        }
      }
    }

    if (!hasSubheaders) {
      if (output.length > 0 && output[output.length - 1] !== "") {
        output.push("");
      }
      output.push("- [ ] ");
    }

    return output.join("\n").trimEnd();
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
      name: "URL extraction prompt",
      desc: "Prompt used when extracting a recipe from a URL.",
      value: this.plugin.settings.urlExtractionPrompt,
      onChange: (value) => {
        this.plugin.settings.urlExtractionPrompt = value;
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

    new Setting(containerEl)
      .setName("Delete images after processing")
      .setDesc("Delete recipe image attachments from the vault after they have been processed.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.deleteImagesAfterProcessing)
          .onChange(async (value) => {
            this.plugin.settings.deleteImagesAfterProcessing = value;
            await this.plugin.saveSettings();
          })
      );
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
