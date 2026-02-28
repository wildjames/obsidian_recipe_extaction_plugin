export interface RecipeParsingSettings {
  llmEndpoint: string;
  apiKey: string;
  imageModel: string;
  textModel: string;
  bookExtractionPrompt: string;
  shoppingListPrompt: string;
}

export const DEFAULT_SETTINGS: RecipeParsingSettings = {
  llmEndpoint: "https://api.openai.com/v1/chat/completions",
  apiKey: "",
  imageModel: "gpt-5.2",
  textModel: "gpt-5.2",
  bookExtractionPrompt:
    "Extract all the ingredients from this recipe image. Return markdown content (do not surround it with backticks, only return the raw text), in the format:\n# Ingredients\nServes x (if given)\n- ingredient\n- ingredient\n- ingredient",
  shoppingListPrompt:
    "You create a shopping list from recipe notes. Return markdown content (do not surround it with backticks, only return the raw text) matching the provided shopping list section exactly, and replace the empty checklist items with consolidated ingredients grouped under the existing headings. If an item fits multiple headings, pick the best fit. Keep the '# Need to buy' header and the four category headers. Keep checklist markers '- [ ] <ingredient>: <quantity>'."
};
