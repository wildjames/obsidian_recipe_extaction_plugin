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
      id: "extract-ingredients-from-attachments",
      name: "Extract ingredients from attachments",
      callback: async () => {
        await this.extractIngredientsFromActiveFile();
      }
    });
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private async extractIngredientsFromActiveFile(): Promise<void> {
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
    const errors: string[] = [];

    for (const match of [...matches].sort((a, b) => b.start - a.start)) {
      try {
        const imageFile = this.resolveImageFile(activeFile, match.linkPath);
        if (!imageFile) {
          errors.push(`Missing attachment: ${match.linkPath}`);
          continue;
        }

        const llmResult = await this.callLlmForImage(imageFile);
        if (!llmResult.trim()) {
          errors.push(`Empty LLM response for: ${imageFile.name}`);
          continue;
        }

        const insertText = `${llmResult.trim()}\n\n`;
        updatedContent =
          updatedContent.slice(0, match.start) +
          insertText +
          updatedContent.slice(match.start);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${match.linkPath}: ${message}`);
      }
    }

    if (updatedContent !== noteContent) {
      await this.app.vault.modify(activeFile, updatedContent);
    }

    if (errors.length > 0) {
      new Notice(`Ingredient extraction completed with ${errors.length} issue(s).`);
      console.error("Ingredient extraction issues", errors);
      return;
    }

    new Notice("Ingredients extracted and inserted above each image.");
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
    const prompt = this.settings.ingredientsPrompt.trim();
    if (!prompt) {
      throw new Error("Ingredients prompt is empty");
    }

    const binary = await this.app.vault.readBinary(imageFile);
    const base64 = Buffer.from(binary).toString("base64");
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

    return await this.callLlm(messages);
  }

  private async callLlm(messages: ChatMessage[]): Promise<string> {
    if (!this.settings.llmEndpoint.trim()) {
      throw new Error("LLM endpoint is empty");
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
        model: this.settings.model,
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
      name: "Model",
      desc: "Model name sent in the request body",
      placeholder: "gpt-4o-mini",
      value: this.plugin.settings.model,
      onChange: (value) => {
        this.plugin.settings.model = value.trim() || "gpt-4o-mini";
      }
    });

    this.addTextAreaSetting(containerEl, {
      name: "Ingredients prompt",
      desc: "Prompt used when extracting ingredients from image attachments.",
      value: this.plugin.settings.ingredientsPrompt,
      onChange: (value) => {
        this.plugin.settings.ingredientsPrompt = value;
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
