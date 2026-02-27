export interface DailyNotesDigestSettings {
  dailyNotesFolder: string;
  outputFolder: string;
  llmEndpoint: string;
  apiKey: string;
  model: string;
  promptTemplate: string;
  checkIntervalMinutes: number;
  sortDailyNotesAndSummaries: boolean;
  lastProcessedDate: string;
  lastOpenedDigestDate: string;
}

export const DEFAULT_SETTINGS: DailyNotesDigestSettings = {
  dailyNotesFolder: "daily_notes",
  outputFolder: "daily_digests",
  llmEndpoint: "https://api.openai.com/v1/chat/completions",
  apiKey: "",
  model: "gpt-4o-mini",
  promptTemplate:
    "Summarize the daily note into concise bullet points and action items.\n\nDate: {{date}}\n\nFocus on key events, decisions, blockers, and next actions.",
  checkIntervalMinutes: 60,
  sortDailyNotesAndSummaries: false,
  lastProcessedDate: "",
  lastOpenedDigestDate: ""
};
