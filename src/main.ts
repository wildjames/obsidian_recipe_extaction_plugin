import {
  App,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  normalizePath,
  requestUrl
} from "obsidian";
import {DailyNotesDigestSettings, DEFAULT_SETTINGS} from "./settings";

type ChatMessage = {
  role: "system" | "user";
  content: string;
};

export default class DailyNotesDigestPlugin extends Plugin {
  settings!: DailyNotesDigestSettings;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addSettingTab(new DailyNotesDigestSettingTab(this.app, this));

    this.addCommand({
      id: "generate-today-digest-now",
      name: "Generate today's digest now",
      callback: async () => {
        await this.processToday(true);
      }
    });

    this.addCommand({
      id: "generate-yesterday-digest-now",
      name: "Generate yesterday's digest now",
      callback: async () => {
        await this.processYesterdayIfNeeded(true);
      }
    });

    this.addCommand({
      id: "sort-daily-notes-and-summaries-now",
      name: "Sort daily notes and summaries into folders now",
      callback: async () => {
        const {today, yesterday} = this.getTodayAndYesterdayStamps();

        await this.sortDailyNotesAndSummaries(today, yesterday);
        new Notice("Daily notes and summaries sorted");
      }
    });

    await this.processYesterdayIfNeeded(false);
    this.scheduleDailyCheck();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  // Heartbeat
  private scheduleDailyCheck(): void {
    const everyMinutes = this.settings.checkIntervalMinutes || 60;
    const intervalId = window.setInterval(async () => {
      await this.processYesterdayIfNeeded(false);
    }, everyMinutes * 60 * 1000);

    this.registerInterval(intervalId);
  }

  private async processToday(force: boolean): Promise<void> {
    const today = this.getTodayStamp();
    await this.processDateIfNeeded(today, force);
  }

  private async processYesterdayIfNeeded(force: boolean): Promise<void> {
    const {today, yesterday} = this.getTodayAndYesterdayStamps();

    if (this.settings.sortDailyNotesAndSummaries) {
      await this.sortDailyNotesAndSummaries(today, yesterday);
    }

    if (this.settings.sortDailyNotesAndSummaries) {
      await this.sortDailyNotesAndSummaries(today, yesterday);
    }

    // Have we done yesterday's notes?
    await this.processDateIfNeeded(yesterday, force);
  }

  private async processDateIfNeeded(dateStamp: string, force: boolean): Promise<void> {
    const outputPath = this.getSummaryPath(dateStamp);
    if (!force) {
      const summaryExists = await this.app.vault.adapter.exists(outputPath);
      if (summaryExists) {
        return;
      }
    }

    try {
      const dailyNotePath = this.getDailyNotePath(dateStamp);
      const exists = await this.app.vault.adapter.exists(dailyNotePath);

      if (!exists) {
        if (force) {
          new Notice(`Daily note not found: ${dailyNotePath}`);
        }
        return;
      }

      const noteContents = (await this.app.vault.adapter.read(dailyNotePath)).trim();
      if (!noteContents || noteContents.length < 20) {
        if (force) {
          new Notice(`Daily note is empty or nearly empty: ${dailyNotePath}`);
        }
        return;
      }
      const messages = this.buildMessages(dateStamp, noteContents);
      const summary = await this.callLlm(messages);

      if (!summary) {
        new Notice("LLM returned an empty summary");
        return;
      }

      // Append the summary with a backlink to the original note
      const backlink = `\n\n---\n\n[Original note](${dateStamp})`;
      const finalContent = summary.trim() + backlink;

      // Need to check that the directories exist before writing
      await this.ensureParentFolderExists(outputPath);
      await this.app.vault.adapter.write(outputPath, finalContent.trim() + "\n");

      this.settings.lastProcessedDate = dateStamp;
      await this.saveSettings();

      new Notice(`Daily summary saved: ${outputPath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Failed to generate daily summary", error);
      new Notice(`Daily summary failed: ${message}`);
    }
  }

  private getDailyNotePath(dateStamp: string): string {
    const today = this.getTodayStamp();
    if (this.settings.sortDailyNotesAndSummaries && dateStamp !== today) {
      return this.buildDatedPath(
        this.settings.dailyNotesFolder,
        dateStamp,
        ".md",
        true
      );
    }

    return this.buildDatedPath(
      this.settings.dailyNotesFolder,
      dateStamp,
      ".md",
      false
    );
  }

  private getSummaryPath(dateStamp: string): string {
    if (this.settings.sortDailyNotesAndSummaries) {
      const yesterday = this.getYesterdayStamp();
      if (this.isDateStampBefore(dateStamp, yesterday)) {
        return this.buildDatedPath(
          this.settings.outputFolder,
          dateStamp,
          "_summary.md",
          true
        );
      }
    }

    return this.buildDatedPath(
      this.settings.outputFolder,
      dateStamp,
      "_summary.md",
      false
    );
  }

  private buildMessages(dateStamp: string, note: string): ChatMessage[] {
    const instructionContent = this.settings.promptTemplate
      .replaceAll("{{date}}", dateStamp);

    return [
      {role: "system", content: instructionContent},
      {
        role: "user",
        content: `Daily note for ${dateStamp}:\n\n${note}`
      }
    ];
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

  private async ensureFolderExists(folderPath: string): Promise<void> {
    const normalized = normalizePath(folderPath);
    if (!normalized || normalized === ".") {
      return;
    }

    const exists = await this.app.vault.adapter.exists(normalized);
    if (exists) {
      return;
    }

    // If the path doesnt exist, create it segment by segment
    const parts = normalized.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const segmentExists = await this.app.vault.adapter.exists(current);
      if (!segmentExists) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  private async ensureParentFolderExists(filePath: string): Promise<void> {
    const parentPath = normalizePath(filePath.split("/").slice(0, -1).join("/"));
    if (!parentPath || parentPath === ".") {
      return;
    }

    await this.ensureFolderExists(parentPath);
  }

  private getLocalDateStamp(date: Date): string {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  private getYesterdayStamp(): string {
    return this.getRelativeDateStamp(-1);
  }

  private getTodayStamp(): string {
    return this.getLocalDateStamp(new Date());
  }

  private getRelativeDateStamp(offsetDays: number): string {
    const date = new Date();
    date.setDate(date.getDate() + offsetDays);
    return this.getLocalDateStamp(date);
  }

  private getTodayAndYesterdayStamps(): {today: string; yesterday: string} {
    const now = new Date();
    const today = this.getLocalDateStamp(now);
    const yesterdayDate = new Date(now);
    yesterdayDate.setDate(now.getDate() - 1);
    const yesterday = this.getLocalDateStamp(yesterdayDate);
    return {today, yesterday};
  }

  private getDateParts(dateStamp: string): {year: string; month: string} {
    const [year, month] = dateStamp.split("-");
    return {year, month};
  }

  private buildDatedPath(
    baseFolder: string,
    dateStamp: string,
    suffix: string,
    nestByMonth: boolean
  ): string {
    if (nestByMonth) {
      const {year, month} = this.getDateParts(dateStamp);
      return normalizePath(`${baseFolder}/${year}/${month}/${dateStamp}${suffix}`);
    }

    return normalizePath(`${baseFolder}/${dateStamp}${suffix}`);
  }

  private isDateStampBefore(a: string, b: string): boolean {
    return a < b;
  }

  private async sortDailyNotesAndSummaries(
    todayStamp: string,
    yesterdayStamp: string
  ): Promise<void> {
    await this.sortDailyNotes(todayStamp);
    await this.sortSummaries(yesterdayStamp);
  }

  private async sortDailyNotes(todayStamp: string): Promise<void> {
    await this.sortDatedFiles({
      baseFolder: this.settings.dailyNotesFolder,
      extractDateStamp: (filename) => this.getDailyNoteDateStamp(filename),
      shouldMove: (dateStamp) => dateStamp !== todayStamp,
      buildTargetPath: (dateStamp, baseFolder) =>
        this.buildDatedPath(baseFolder, dateStamp, ".md", true)
    });
  }

  private async sortSummaries(yesterdayStamp: string): Promise<void> {
    await this.sortDatedFiles({
      baseFolder: this.settings.outputFolder,
      extractDateStamp: (filename) => this.getSummaryDateStamp(filename),
      shouldMove: (dateStamp) => this.isDateStampBefore(dateStamp, yesterdayStamp),
      buildTargetPath: (dateStamp, baseFolder) =>
        this.buildDatedPath(baseFolder, dateStamp, "_summary.md", true)
    });
  }

  private async sortDatedFiles(options: {
    baseFolder: string;
    extractDateStamp: (filename: string) => string | null;
    shouldMove: (dateStamp: string) => boolean;
    buildTargetPath: (dateStamp: string, baseFolder: string) => string;
  }): Promise<void> {
    const baseFolder = normalizePath(options.baseFolder);
    if (!baseFolder || baseFolder === ".") {
      return;
    }

    const baseExists = await this.app.vault.adapter.exists(baseFolder);
    if (!baseExists) {
      return;
    }

    const listing = await this.app.vault.adapter.list(baseFolder);
    for (const filePath of listing.files) {
      const name = filePath.split("/").pop() ?? "";
      const dateStamp = options.extractDateStamp(name);
      if (!dateStamp || !options.shouldMove(dateStamp)) {
        continue;
      }

      const targetPath = options.buildTargetPath(dateStamp, baseFolder);
      if (filePath === targetPath) {
        continue;
      }

      const targetDir = targetPath.split("/").slice(0, -1).join("/");
      await this.ensureFolderExists(targetDir);
      await this.renameOrRemoveIfTargetExists(filePath, targetPath);
    }
  }

  private async renameOrRemoveIfTargetExists(
    sourcePath: string,
    targetPath: string
  ): Promise<void> {
    try {
      await this.app.vault.adapter.rename(sourcePath, targetPath);
    } catch (error) {
      const targetExists = await this.app.vault.adapter.exists(targetPath);
      if (targetExists) {
        await this.app.vault.adapter.remove(sourcePath);
        return;
      }
      throw error;
    }
  }

  private getDailyNoteDateStamp(filename: string): string | null {
    return this.extractDateStamp(filename, "\\.md");
  }

  private getSummaryDateStamp(filename: string): string | null {
    return this.extractDateStamp(filename, "_summary\\.md");
  }

  private extractDateStamp(filename: string, suffixPattern: string): string | null {
    const regex = new RegExp(`^(\\d{4}-\\d{2}-\\d{2})${suffixPattern}$`);
    const match = filename.match(regex);
    return match ? match[1] : null;
  }
}

class DailyNotesDigestSettingTab extends PluginSettingTab {
  plugin: DailyNotesDigestPlugin;

  constructor(app: App, plugin: DailyNotesDigestPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const {containerEl} = this;
    containerEl.empty();

    this.addTextSetting(containerEl, {
      name: "Daily notes folder",
      desc: "Folder containing daily notes named yyyy-mm-dd.md",
      placeholder: "Daily",
      value: this.plugin.settings.dailyNotesFolder,
      onChange: (value) => {
        this.plugin.settings.dailyNotesFolder = value.trim() || "Daily";
      }
    });

    this.addTextSetting(containerEl, {
      name: "Summary output folder",
      desc: "Folder where yyyy-mm-dd_summary.md files are written",
      placeholder: "Daily Summaries",
      value: this.plugin.settings.outputFolder,
      onChange: (value) => {
        this.plugin.settings.outputFolder = value.trim() || "Daily Summaries";
      }
    });

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
      name: "Summary prompt template",
      desc: "Use {{date}} to include the date in the prompt. The daily note content will be appended to this template as a separate message when sent to the LLM.",
      value: this.plugin.settings.promptTemplate,
      onChange: (value) => {
        this.plugin.settings.promptTemplate = value;
      }
    });

    this.addTextSetting(containerEl, {
      name: "Check interval (minutes)",
      desc: "Interval (in minutes) for automatic digest generation and file sorting checks",
      placeholder: "60",
      value: String(this.plugin.settings.checkIntervalMinutes),
      onChange: (value) => {
        const parsed = Number.parseInt(value, 10);
        this.plugin.settings.checkIntervalMinutes = Number.isFinite(parsed)
          ? Math.max(5, parsed)
          : 60;
      }
    });

    this.addToggleSetting(containerEl, {
      name: "Sort daily notes and summaries",
      desc: "Organize daily notes (except today) and summaries (before yesterday) into yyyy/mm folders.",
      value: this.plugin.settings.sortDailyNotesAndSummaries,
      onChange: (value) => {
        this.plugin.settings.sortDailyNotesAndSummaries = value;
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

    new Setting(containerEl)
      .setName("Sort daily notes and summaries")
      .setDesc(
        "Move older daily notes into yyyy/mm folders and archive summaries older than yesterday."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.sortDailyNotesAndSummaries)
          .onChange(async (value) => {
            this.plugin.settings.sortDailyNotesAndSummaries = value;
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

  private addToggleSetting(
    containerEl: HTMLElement,
    options: {
      name: string;
      desc: string;
      value: boolean;
      onChange: (value: boolean) => void;
    }
  ): void {
    new Setting(containerEl)
      .setName(options.name)
      .setDesc(options.desc)
      .addToggle((toggle) =>
        toggle.setValue(options.value).onChange(async (value) => {
          options.onChange(value);
          await this.plugin.saveSettings();
        })
      );
  }
}
