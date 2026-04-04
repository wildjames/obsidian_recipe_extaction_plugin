export async function extractFromHtml(
  _html: string,
  _url?: string
): Promise<{content: string; title?: string} | null> {
  throw new Error("extractFromHtml not mocked");
}
