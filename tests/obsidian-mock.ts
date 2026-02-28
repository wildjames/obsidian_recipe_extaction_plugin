export class App {
  vault = {};
  workspace = {};
  metadataCache = {};
}

export class Plugin {
  app: App;

  constructor(app: App, ..._args: unknown[]) {
    this.app = app;
  }

  async loadData(): Promise<unknown> {
    return null;
  }

  async saveData(_data: unknown): Promise<void> {
    return;
  }

  addSettingTab(_tab: PluginSettingTab): void {
    return;
  }

  addCommand(_command: unknown): void {
    return;
  }
}

export class PluginSettingTab {
  app: App;
  plugin: Plugin;
  containerEl = {
    empty(): void {
      return;
    }
  };

  constructor(app: App, plugin: Plugin) {
    this.app = app;
    this.plugin = plugin;
  }

  display(): void {
    return;
  }
}

export class Setting {
  constructor(_containerEl: unknown) {
    return;
  }

  setName(_name: string): this {
    return this;
  }

  setDesc(_desc: string): this {
    return this;
  }

  addText(_callback: (text: {setValue: (value: string) => void; onChange: (cb: (value: string) => void) => void; inputEl?: HTMLInputElement}) => void): this {
    return this;
  }

  addTextArea(_callback: (text: {setValue: (value: string) => void; onChange: (cb: (value: string) => void) => void; inputEl?: HTMLTextAreaElement}) => void): this {
    return this;
  }

  addButton(_callback: (button: {setButtonText: (value: string) => void; onClick: (cb: () => void) => void}) => void): this {
    return this;
  }
}

export class Notice {
  constructor(_message: string) {
    return;
  }
}

export class TFile {
  path: string;
  extension: string;
  name: string;

  constructor(path: string) {
    this.path = path;
    const parts = path.split("/");
    this.name = parts[parts.length - 1] ?? "";
    const ext = this.name.split(".").pop();
    this.extension = ext ?? "";
  }
}

export async function requestUrl(): Promise<never> {
  throw new Error("requestUrl not mocked");
}
