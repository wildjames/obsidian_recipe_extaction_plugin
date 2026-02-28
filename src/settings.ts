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
    "Extract all the ingredients from this recipe image, exactly as written in the image (accuracy is the most important metric here). Where a recipe has separate ingredients for different components, place them under relevant subheadings as separate lists. Return markdown content (do not surround it with backticks, only return the raw text), in the format:\n    <newline>\n# Ingredients\n## Component A(if appropriate)\n  Serves x(if given)\n  - ingredient\n  - ingredient\n  - ingredient\n\n# Recipe transcription\n  < copy of the recipe instructions > ",
  shoppingListPrompt:
    "You create a shopping list from recipe notes. Return markdown content (do not surround it with backticks, only return the raw text) matching the provided shopping list section exactly, and replace the empty checklist items with consolidated ingredients from both the attached recipies, and any items noted in the main meal plan document. Items must be grouped under the existing headings. If an item fits multiple headings, or is a poor fit for all of them, pick the best fit. Keep the '# Need to buy' header and the category headers unchanged. Keep checklist markers '- [ ] <ingredient>: <quantity>'."
};
