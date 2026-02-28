# Recipe Parsing Helper (Obsidian Plugin)

This plugin adds two commands:

- Parse images in the active note with an LLM vision model and insert the extracted recipe text above each image embed.
- Build a shopping list from a meal plan note by reading linked recipe notes and updating the `Need to buy` section.

Both commands use a configurable OpenAI-compatible chat completions endpoint and prompts.

## Command: Parse recipe images

This scans the active markdown file for image embeds (`![[...]]` or `![...](...)`) and, for each image, calls your LLM endpoint using the image model. The response is inserted immediately above the topmost image embed.

Only local vault files are supported. External URLs and `data:` images are ignored.

### Example note

```
# Boiled Eggs

![[image_of_egg_recipe_in_book.png]]

```

### Example output (default prompt)

```
# Ingredients
Serves 2
- Eggs
- Salt

# Recipe transcription
1. Boil water.
2. Add eggs and cook for 7 minutes. Serve with salt.
```


## Command: Build shopping list from meal plan

This scans the active meal plan note for recipe links (`[[Recipe Note]]`), loads each linked markdown file, removes image embeds from those recipe notes, and asks the LLM to generate a shopping list in the template below.

Only the `Need to buy` section is replaced; everything else in the note is left unchanged.

### Meal plan template

```
{{date}}
# Recipes
- [ ] [[Recipe A]]
- [ ] [[Recipe B]]


---

# Need to buy
## Veg
- [ ]

## Dairy
- [ ]

## Carbs (bread, pasta, rice, etc)
- [ ]

## Store Cupboard (tins, jams, etc)
- [ ]

## Baking supplies
- [ ]

## Spices, oils, vinegars, sauces
- [ ]

## Nuts and seeds
- [ ]

## Other
- [ ]


```

The `Need to buy` section will be populated. The section title must be **exactly** `Need to buy` (case-insensitive) and it must be a markdown heading (for example, `# Need to buy`). Only that section will be affected by the update.

The categories may be changed, added to, or removed.

## Settings

All settings live in the plugin settings tab.

- LLM endpoint: OpenAI-compatible chat completions endpoint URL.
- API key: Authorization bearer token for your provider (optional for local endpoints).
- Image model: Model used for image parsing (vision model).
- Text model: Model used for shopping list generation.
- Ingredients prompt: System prompt for the image extraction command.
- Shopping list prompt: System prompt for the meal plan command.

Defaults are defined in the code and can be edited to match your preferred output format.

## Limitations

- If any image or LLM call fails, the command stops and shows a notice for the failing image.
- Only markdown files are supported for both commands.
- Image parsing only supports local files in the vault; external URLs are skipped.

## Development

By default, dependabot creates patch releases, and devs create minor releases. If you want to create a major release, prepend your PR with the string `Major: `.

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

Copy `main.js`, `manifest.json`, and optionally `styles.css` into your Obsidian vault plugin folder. `manifest.json` is generated from `manifest.template.json` during release packaging.

## Release package

```bash
npm run release
```

This produces:
