export interface RecipeParsingSettings {
  llmEndpoint: string;
  apiKey: string;
  model: string;
  ingredientsPrompt: string;
}

export const DEFAULT_SETTINGS: RecipeParsingSettings = {
  llmEndpoint: "https://api.openai.com/v1/chat/completions",
  apiKey: "",
  model: "gpt-4.1",
  ingredientsPrompt:
    "Extract all the ingredients from this recipe image. Return markdown content (do not surround it with backticks, only return the raw text), in the format:\n# Ingredients\nServes x (if given)\n- ingredient\n- ingredient\n- ingredient"
};
