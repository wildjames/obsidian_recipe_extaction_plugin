import {beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import RecipeParsingPlugin from "../src/main";
import {DEFAULT_SETTINGS} from "../src/settings";
import * as Obsidian from "obsidian";

type TestPlugin = RecipeParsingPlugin & {
  settings: typeof DEFAULT_SETTINGS;
};

type RequestPayload = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
};

const createPlugin = (): TestPlugin => {
  const app = new Obsidian.App();
  const plugin = new RecipeParsingPlugin(app) as TestPlugin;
  plugin.settings = {...DEFAULT_SETTINGS};
  return plugin;
};

describe("callLlm", () => {
  let plugin: TestPlugin;

  beforeEach(() => {
    vi.restoreAllMocks();
    plugin = createPlugin();
  });

  it("throws when endpoint is empty", async () => {
    plugin.settings.llmEndpoint = "   ";

    await expect(
      (plugin as unknown as {callLlm: (messages: unknown[], model: string) => Promise<string>})
        .callLlm([], "gpt")
    ).rejects.toThrow("LLM endpoint is empty");
  });

  it("throws when model is empty", async () => {
    plugin.settings.llmEndpoint = "https://example.com";

    await expect(
      (plugin as unknown as {callLlm: (messages: unknown[], model: string) => Promise<string>})
        .callLlm([], "   ")
    ).rejects.toThrow("Model is empty");
  });

  it("posts to configured endpoint with headers and payload", async () => {
    plugin.settings.llmEndpoint = "https://example.com";
    plugin.settings.apiKey = "  secret-key  ";

    const requestSpy = vi.spyOn(Obsidian, "requestUrl").mockResolvedValue({
      status: 200,
      json: {
        choices: [{message: {content: "ok"}}]
      }
    } as unknown as {status: number; json: unknown});

    const messages = [{role: "system", content: "hello"}];
    const result = await (plugin as unknown as {callLlm: (messages: unknown[], model: string) => Promise<string>})
      .callLlm(messages, "gpt-5.2");

    expect(result).toBe("ok");
    const payload = requestSpy.mock.calls[0]?.[0] as RequestPayload;
    expect(payload.method).toBe("POST");
    expect(payload.url).toBe("https://example.com");
    expect(payload.headers["Content-Type"]).toBe("application/json");
    expect(payload.headers.Authorization).toBe("Bearer secret-key");

    const body = JSON.parse(payload.body) as {
      model: string;
      messages: unknown[];
      temperature: number;
    };
    expect(body).toEqual({
      model: "gpt-5.2",
      messages,
      temperature: 0.2
    });
  });

  it("omits Authorization header when api key is empty", async () => {
    plugin.settings.llmEndpoint = "https://example.com";
    plugin.settings.apiKey = "  ";

    const requestSpy = vi.spyOn(Obsidian, "requestUrl").mockResolvedValue({
      status: 200,
      json: {
        choices: [{message: {content: "ok"}}]
      }
    } as unknown as {status: number; json: unknown});

    await (plugin as unknown as {callLlm: (messages: unknown[], model: string) => Promise<string>})
      .callLlm([], "gpt-5.2");

    const payload = requestSpy.mock.calls[0]?.[0] as RequestPayload;
    expect(payload.headers.Authorization).toBeUndefined();
  });

  it("throws on non-200 response", async () => {
    plugin.settings.llmEndpoint = "https://example.com";

    vi.spyOn(Obsidian, "requestUrl").mockResolvedValue({
      status: 500,
      json: {}
    } as unknown as {status: number; json: unknown});

    await expect(
      (plugin as unknown as {callLlm: (messages: unknown[], model: string) => Promise<string>})
        .callLlm([], "gpt-5.2")
    ).rejects.toThrow("LLM request failed (500)");
  });

  it("throws when response content is missing", async () => {
    plugin.settings.llmEndpoint = "https://example.com";

    vi.spyOn(Obsidian, "requestUrl").mockResolvedValue({
      status: 200,
      json: {
        choices: [{message: {content: 123}}]
      }
    } as unknown as {status: number; json: unknown});

    await expect(
      (plugin as unknown as {callLlm: (messages: unknown[], model: string) => Promise<string>})
        .callLlm([], "gpt-5.2")
    ).rejects.toThrow("Unexpected LLM response shape");
  });
});

describe("callLlmForImages", () => {
  let plugin: TestPlugin;

  beforeAll(() => {
    if (typeof globalThis.btoa !== "function") {
      globalThis.btoa = (data: string) => Buffer.from(data, "binary").toString("base64");
    }
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    plugin = createPlugin();
  });

  it("throws when book extraction prompt is empty", async () => {
    plugin.settings.bookExtractionPrompt = "   ";
    const imageFile = new Obsidian.TFile("image.png");

    await expect(
      (plugin as unknown as {
        callLlmForImages: (images: Array<{file: Obsidian.TFile; label: string}>) => Promise<string>;
      }).callLlmForImages([{file: imageFile, label: "image.png"}])
    ).rejects.toThrow("Ingredients prompt is empty");
  });

  it("reads binary content and sends image payloads with data URLs", async () => {
    const imageFile = new Obsidian.TFile("assets/photo.png");
    const binary = new Uint8Array([72, 105]).buffer; // "Hi"

    plugin.app.vault.readBinary = vi.fn().mockResolvedValue(binary);

    let capturedMessages: unknown[] | null = null;
    let capturedModel: string | null = null;

    vi.spyOn(plugin as unknown as {callLlm: (messages: unknown[], model: string) => Promise<string>}, "callLlm")
      .mockImplementation(async (messages, model) => {
        capturedMessages = messages;
        capturedModel = model;
        return "ok";
      });

    const result = await (plugin as unknown as {
      callLlmForImages: (images: Array<{file: Obsidian.TFile; label: string}>) => Promise<string>;
    }).callLlmForImages([{file: imageFile, label: "assets/photo.png"}]);

    expect(result).toBe("ok");
    expect(plugin.app.vault.readBinary).toHaveBeenCalledWith(imageFile);
    expect(capturedModel).toBe(plugin.settings.imageModel);

    expect(capturedMessages).toHaveLength(2);
    const [userMessage, systemMessage] = capturedMessages as Array<{role: string; content: unknown}>;

    const userContent = userMessage.content as Array<{type: string; text?: string; image_url?: {url: string}}>;
    expect(userMessage.role).toBe("user");
    expect(userContent[0]).toEqual({
      type: "text",
      text: "Extract information from all images. Return a combined response."
    });
    expect(userContent[1]).toEqual({
      type: "text",
      text: "Image 1: assets/photo.png"
    });
    expect(userContent[2]).toEqual({
      type: "image_url",
      image_url: {
        url: "data:image/png;base64,SGk="
      }
    });

    expect(systemMessage).toEqual({
      role: "system",
      content: plugin.settings.bookExtractionPrompt.trim()
    });
  });

  it("uses the correct mime type for common extensions", async () => {
    const binary = new Uint8Array([]).buffer;
    plugin.app.vault.readBinary = vi.fn().mockResolvedValue(binary);

    const cases = [
      {ext: "jpg", mime: "image/jpeg"},
      {ext: "jpeg", mime: "image/jpeg"},
      {ext: "png", mime: "image/png"},
      {ext: "webp", mime: "image/webp"},
      {ext: "gif", mime: "image/gif"},
      {ext: "bmp", mime: "image/bmp"},
      {ext: "tiff", mime: "application/octet-stream"}
    ];

    for (const {ext, mime} of cases) {
      let capturedUrl = "";
      vi.spyOn(plugin as unknown as {callLlm: (messages: unknown[], model: string) => Promise<string>}, "callLlm")
        .mockImplementationOnce(async (messages) => {
          const userMessage = (messages[0] as {content: Array<{image_url?: {url: string}}>}).content;
          capturedUrl = userMessage[2]?.image_url?.url ?? "";
          return "ok";
        });

      const imageFile = new Obsidian.TFile(`photo.${ext}`);
      await (plugin as unknown as {
        callLlmForImages: (images: Array<{file: Obsidian.TFile; label: string}>) => Promise<string>;
      }).callLlmForImages([{file: imageFile, label: `photo.${ext}`}]);

      expect(capturedUrl.startsWith(`data:${mime};base64,`)).toBe(true);
    }
  });
});

describe("getMimeType", () => {
  let plugin: TestPlugin;

  beforeEach(() => {
    plugin = createPlugin();
  });

  it("maps common extensions and defaults when unknown", () => {
    const getMimeType = (plugin as unknown as {getMimeType: (ext: string) => string}).getMimeType;

    expect(getMimeType("jpg")).toBe("image/jpeg");
    expect(getMimeType("jpeg")).toBe("image/jpeg");
    expect(getMimeType("png")).toBe("image/png");
    expect(getMimeType("webp")).toBe("image/webp");
    expect(getMimeType("gif")).toBe("image/gif");
    expect(getMimeType("bmp")).toBe("image/bmp");
    expect(getMimeType("SVG")).toBe("application/octet-stream");
  });

  it("handles uppercase extensions", () => {
    const getMimeType = (plugin as unknown as {getMimeType: (ext: string) => string}).getMimeType;

    expect(getMimeType("JPG")).toBe("image/jpeg");
    expect(getMimeType("Png")).toBe("image/png");
  });
});

describe("toBase64", () => {
  let plugin: TestPlugin;

  beforeAll(() => {
    if (typeof globalThis.btoa !== "function") {
      globalThis.btoa = (data: string) => Buffer.from(data, "binary").toString("base64");
    }
  });

  beforeEach(() => {
    plugin = createPlugin();
  });

  it("produces expected base64 output for small buffer", () => {
    const buffer = new Uint8Array([72, 101, 108, 108, 111]).buffer; // "Hello"
    const toBase64 = (plugin as unknown as {toBase64: (buf: ArrayBuffer) => string}).toBase64;

    expect(toBase64(buffer)).toBe("SGVsbG8=");
  });

  it("handles large buffers by chunking", () => {
    const size = 0x8000 + 16;
    const bytes = new Uint8Array(size).fill(65); // "A"
    const toBase64 = (plugin as unknown as {toBase64: (buf: ArrayBuffer) => string}).toBase64;

    const expected = Buffer.from(bytes).toString("base64");
    expect(toBase64(bytes.buffer)).toBe(expected);
  });
});
