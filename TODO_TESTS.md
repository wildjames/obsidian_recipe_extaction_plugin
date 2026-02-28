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
- [ ] Matches wiki embeds: `![[image.png]]`.
- [ ] Matches wiki embeds with alias and/or heading: `![[image.png|alias]]`, `![[image.png#Section]]`.
- [ ] Matches markdown images: `![alt](path.png)`.
- [ ] Matches markdown images with title: `![alt](path.png "title")`.
- [ ] Returns correct start indices for each match.
- [ ] Does not include non-image links.

## findLinkedRecipeFiles
- [ ] Collects unique wiki links (dedup).
- [ ] Ignores image embeds (preceded by `!`).
- [ ] Resolves to existing markdown files only.
- [ ] Ignores non-markdown files.
- [ ] Handles links with alias/heading.

## stripImageEmbeds
- [ ] Removes wiki image embeds.
- [ ] Removes markdown image embeds.
- [ ] Removes HTML `<img>` tags (case-insensitive).
- [ ] Leaves non-image content untouched.
- [ ] Works with multiple images in a single file.

## resolveImageFile
- [ ] Trims whitespace and ignores empty paths.
- [ ] Rejects http/https URLs.
- [ ] Rejects data URLs.
- [ ] Strips `|alias` and `#heading` portions.
- [ ] Resolves to a `TFile` when metadata cache returns a file.
- [ ] Returns null when no destination found.

## callLlmForImage
- [ ] Throws when book extraction prompt is empty/whitespace.
- [ ] Reads binary content from image file.
- [ ] Uses correct mime types for jpg/jpeg/png/webp/gif/bmp and default for unknown.
- [ ] Builds data URL with base64 payload.
- [ ] Sends messages with system prompt + user image payload.
- [ ] Uses `imageModel` for the call.

## callLlm
- [ ] Throws when endpoint is empty/whitespace.
- [ ] Throws when model is empty/whitespace.
- [ ] Sets JSON content-type header.
- [ ] Adds Authorization header when api key is non-empty (trimmed).
- [ ] Does not add Authorization header when api key is empty/whitespace.
- [ ] Posts to configured endpoint with model/messages/temperature.
- [ ] Throws on non-200 response with status included.
- [ ] Throws when response content shape is missing or not a string.
- [ ] Returns message content on success.

## getMimeType
- [ ] Maps jpg/jpeg to image/jpeg.
- [ ] Maps png to image/png.
- [ ] Maps webp to image/webp.
- [ ] Maps gif to image/gif.
- [ ] Maps bmp to image/bmp.
- [ ] Defaults to application/octet-stream for unknown extension.
- [ ] Handles uppercase extensions.

## toBase64
- [ ] Produces expected base64 output for small ArrayBuffer.
- [ ] Handles large buffers by chunking (multiple iterations).
- [ ] Output matches standard base64 of byte array.

## Settings UI (RecipeParsingSettingTab)
- [ ] Text inputs trim values before saving.
- [ ] Image model and text model fall back to default when empty.
- [ ] Text area fields persist raw value (no trim).
- [ ] Save called after each setting change.

## Notices and Error Handling
- [ ] Error messages include the link path for image extraction failures.
- [ ] LLM errors propagate to notices with message text.
- [ ] No extra notices are shown on early returns.
