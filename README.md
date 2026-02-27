# Recipe Parsing Helper (Obsidian Plugin)

We want two plugin commands, one will take all images in a given markdown file and using a call to chatgpt, pull out the ingredients and how many people it serves. Parse that into a given markdown template, and add it to the original file just above the link to the picture.

The other one should take a filled-in meal plan template and look at each linked recipe and feed all of those files into an llm and ask it to construct a shopping list in the format defined by the template file.

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

- `release/daily-notes-digest-<version>.zip`
- `release/release-manifest.json` (SHA-256 hashes for the zip and included files)
