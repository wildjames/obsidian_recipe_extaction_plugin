# TODO Tests

## Settings
- [x] Load defaults when no saved data exists.
- [x] Merge saved settings over defaults (all fields).
- [x] Legacy model migration: when saved has `model` and missing `imageModel` and `textModel`, both should be set to legacy value.
- [x] Legacy model not applied if `imageModel` or `textModel` already present.
- [x] Save settings persists current values via `saveData`.

## Command: Parse Recipe Images
- [x] Shows notice when no active file.
- [x] Shows notice when active file is not markdown.
- [x] Shows notice when file has no image links.
- [x] Inserts extracted text before each image link (positions based on original indices, reverse order insertion).
- [x] Handles multiple image links with mixed wiki and markdown formats.
- [x] Does not modify file when LLM response is empty/whitespace (error notice).
- [x] Uses `resolveImageFile` and errors when attachment not found (notice includes link path).
- [x] Does not modify file when an error occurs mid-loop (early return).
- [x] Writes updated content only when changes are made.
- [x] Success notice after insertion.

## Command: Build Shopping List
- [x] Shows notice when no active file.
- [x] Shows notice when active file is not markdown.
- [x] Shows notice when '# Need to buy' section is missing.
- [x] Shows notice when no linked recipe files are found.
- [x] Shows notice when shopping list prompt is empty/whitespace.
- [x] Strips image embeds from recipe contents before sending to LLM.
- [x] Builds LLM prompt with template section and cleaned recipes.
- [x] Valid LLM response must include '# Need to buy' header; otherwise notice and no file change.
- [x] Replaces only the matched Need to buy section and keeps rest of file intact.
- [x] Success notice after updating content.

## findImageLinks
- [x] Matches wiki embeds: `![[image.png]]`.
- [x] Matches wiki embeds with alias and/or heading: `![[image.png|alias]]`, `![[image.png#Section]]`.
- [x] Matches markdown images: `![alt](path.png)`.
- [x] Matches markdown images with title: `![alt](path.png "title")`.
- [x] Returns correct start indices for each match.
- [x] Does not include non-image links.

## findLinkedRecipeFiles
- [x] Collects unique wiki links (dedup).
- [x] Ignores image embeds (preceded by `!`).
- [x] Resolves to existing markdown files only.
- [x] Ignores non-markdown files.
- [x] Handles links with alias/heading.

## stripImageEmbeds
- [x] Removes wiki image embeds.
- [x] Removes markdown image embeds.
- [x] Removes HTML `<img>` tags (case-insensitive).
- [x] Leaves non-image content untouched.
- [x] Works with multiple images in a single file.

## resolveImageFile
- [x] Trims whitespace and ignores empty paths.
- [x] Rejects http/https URLs.
- [x] Rejects data URLs.
- [x] Strips `|alias` and `#heading` portions.
- [x] Resolves to a `TFile` when metadata cache returns a file.
- [x] Returns null when no destination found.

## callLlmForImage
- [x] Throws when book extraction prompt is empty/whitespace.
- [x] Reads binary content from image file.
- [x] Uses correct mime types for jpg/jpeg/png/webp/gif/bmp and default for unknown.
- [x] Builds data URL with base64 payload.
- [x] Sends messages with system prompt + user image payload.
- [x] Uses `imageModel` for the call.

## callLlm
- [x] Throws when endpoint is empty/whitespace.
- [x] Throws when model is empty/whitespace.
- [x] Sets JSON content-type header.
- [x] Adds Authorization header when api key is non-empty (trimmed).
- [x] Does not add Authorization header when api key is empty/whitespace.
- [x] Posts to configured endpoint with model/messages/temperature.
- [x] Throws on non-200 response with status included.
- [x] Throws when response content shape is missing or not a string.
- [x] Returns message content on success.

## getMimeType
- [x] Correctly maps file types
  - [x] Maps jpg/jpeg to image/jpeg.
  - [x] Maps png to image/png.
  - [x] Maps webp to image/webp.
  - [x] Maps gif to image/gif.
  - [x] Maps bmp to image/bmp.
  - [x] Defaults to application/octet-stream for unknown extension.
  - [x] Handles uppercase extensions.

## toBase64
- [x] Produces expected base64 output for small ArrayBuffer.
- [x] Handles large buffers by chunking (multiple iterations).
- [x] Output matches standard base64 of byte array.

## Settings UI (RecipeParsingSettingTab)
- [x] Text inputs trim values before saving.
- [x] Image model and text model fall back to default when empty.
- [x] Text area fields persist raw value (no trim).
- [x] Save called after each setting change.

## Notices and Error Handling
- [x] Error messages include the link path for image extraction failures.
- [x] LLM errors propagate to notices with message text.
- [x] No extra notices are shown on early returns.
