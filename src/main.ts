import {App, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, TFile, requestUrl} from "obsidian";
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

type UrlMatch = {
  url: string;
  start: number;
  end: number;
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
      id: "extract-recipe-from-webpage",
      name: "Extract recipe from webpage",
      callback: async () => {
        await this.extractRecipeFromWebpage();
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

    for (const match of [...matches].sort((a, b) => b.start - a.start)) {
      try {
        const imageFile = this.resolveImageFile(activeFile, match.linkPath);
        if (!imageFile) {
          throw new Error(`Attachment not found: ${match.linkPath}`);
        }

        const llmResult = await this.callLlmForImage(imageFile);
        if (!llmResult.trim()) {
          throw new Error(`LLM returned empty response for: ${imageFile.name}`);
        }

        const insertText = `${llmResult.trim()}\n\n`;
        updatedContent =
          updatedContent.slice(0, match.start) +
          insertText +
          updatedContent.slice(match.start);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        new Notice(`${match.linkPath}: ${message}`);
        return;
      }
    }

    if (updatedContent !== noteContent) {
      await this.app.vault.modify(activeFile, updatedContent);
    }

    new Notice("Recipe information extracted and inserted detected images.");
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
      {role: "system", content: prompt},
      {
        role: "user",
        content:
          `Meal plan shopping list template:\n${templateSection}\n\n` +
          `Recipes (omit any images already removed):\n${recipeContents.join("\n\n")}`
      }
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

  private async extractRecipeFromWebpage(): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile || activeFile.extension !== "md") {
      new Notice("Open a markdown file with a recipe link to extract.");
      return;
    }

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const selection = view?.editor?.getSelection()?.trim() ?? "";
    const selectedUrl = this.extractUrlFromSelection(selection);

    const noteContent = await this.app.vault.read(activeFile);
    const urlMatch = this.findHttpLink(noteContent, selectedUrl ?? undefined);
    if (!urlMatch) {
      new Notice("No recipe link found in the active file.");
      return;
    }

    const prompt = this.settings.webRecipePrompt.trim();
    if (!prompt) {
      new Notice("Web recipe prompt is empty.");
      return;
    }

    let responseText = "";
    try {
      const response = await requestUrl({
        method: "GET",
        url: urlMatch.url
      });

      if (response.status < 200 || response.status >= 300) {
        throw new Error(`Fetch failed (${response.status})`);
      }

      if (typeof response.text === "string") {
        responseText = response.text;
      } else if (response.arrayBuffer) {
        responseText = new TextDecoder("utf-8").decode(response.arrayBuffer);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Failed to fetch webpage: ${message}`);
      return;
    }

    if (!responseText.trim()) {
      new Notice("Fetched webpage content was empty.");
      return;
    }

    const cleanedHtml = this.sanitizeHtmlForLlm(responseText);
    const {text: truncatedHtml, truncated} = this.truncateForLlm(cleanedHtml, 120000);
    const truncationNote = truncated ? "(HTML truncated for size)\n" : "";

    let llmResult = "";
    try {
      llmResult = await this.callLlm([
        {role: "system", content: prompt},
        {
          role: "user",
          content:
            `URL: ${urlMatch.url}\n` +
            `${truncationNote}\n` +
            `HTML:\n${truncatedHtml}`
        }
      ], this.settings.textModel);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`LLM request failed: ${message}`);
      return;
    }

    const recipeMarkdown = llmResult.trim();
    if (!recipeMarkdown) {
      new Notice("LLM returned an empty recipe.");
      return;
    }

    const insertAt = this.findLineEndIndex(noteContent, urlMatch.end);
    const insertText = `\n${recipeMarkdown}\n`;
    const updatedContent =
      noteContent.slice(0, insertAt) + insertText + noteContent.slice(insertAt);

    await this.app.vault.modify(activeFile, updatedContent);
    new Notice("Recipe extracted and inserted below the link.");
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

  private extractUrlFromSelection(selection: string): string | null {
    if (!selection) {
      return null;
    }

    const markdownLinkMatch = selection.match(/\[[^\]]*\]\((https?:\/\/[^\s)]+)(?:\s+"[^"]*")?\)/i);
    if (markdownLinkMatch?.[1]) {
      return markdownLinkMatch[1];
    }

    const urlMatch = selection.match(/https?:\/\/[^\s)]+/i);
    return urlMatch?.[0] ?? null;
  }

  private findHttpLink(content: string, preferredUrl?: string): UrlMatch | null {
    const matches: UrlMatch[] = [];
    const markdownLinkRegex = /\[[^\]]*\]\((https?:\/\/[^\s)]+)(?:\s+"[^"]*")?\)/g;
    const bareUrlRegex = /https?:\/\/[^\s)]+/g;

    for (const match of content.matchAll(markdownLinkRegex)) {
      if (match.index === undefined) {
        continue;
      }
      const url = match[1];
      matches.push({url, start: match.index, end: match.index + match[0].length});
    }

    for (const match of content.matchAll(bareUrlRegex)) {
      if (match.index === undefined) {
        continue;
      }
      const url = match[0];
      matches.push({url, start: match.index, end: match.index + match[0].length});
    }

    if (matches.length === 0) {
      return null;
    }

    if (preferredUrl) {
      const preferred = matches.find((match) => match.url === preferredUrl);
      if (preferred) {
        return preferred;
      }
    }

    return matches[0];
  }

  private findLineEndIndex(content: string, startIndex: number): number {
    const lineEnd = content.indexOf("\n", startIndex);
    return lineEnd === -1 ? content.length : lineEnd + 1;
  }

  private sanitizeHtmlForLlm(html: string): string {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
      .replace(/<svg[\s\S]*?<\/svg>/gi, "");
  }

  private truncateForLlm(content: string, maxChars: number): {text: string; truncated: boolean} {
    if (content.length <= maxChars) {
      return {text: content, truncated: false};
    }

    return {text: content.slice(0, maxChars), truncated: true};
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

  private async callLlmForImage(imageFile: TFile): Promise<string> {
    const prompt = this.settings.bookExtractionPrompt.trim();
    if (!prompt) {
      throw new Error("Ingredients prompt is empty");
    }

    const binary = await this.app.vault.readBinary(imageFile);
    const base64 = this.toBase64(binary);
    const mime = this.getMimeType(imageFile.extension);
    const dataUrl = `data:${mime};base64,${base64}`;

    const messages: ChatMessage[] = [
      {role: "system", content: prompt},
      {
        role: "user",
        content: [
          {type: "text", text: "Recipe image for ingredient extraction."},
          {type: "image_url", image_url: {url: dataUrl}}
        ]
      }
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
      name: "Web recipe prompt",
      desc: "Prompt used when extracting recipes from web pages.",
      value: this.plugin.settings.webRecipePrompt,
      onChange: (value) => {
        this.plugin.settings.webRecipePrompt = value;
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
