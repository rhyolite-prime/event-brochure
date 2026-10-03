# Event Brochure

A Nuxt 4 web app that presents a funeral service brochure (PDF) in an advanced,
Kindle-style reader built on Mozilla's [pdf.js](https://mozilla.github.io/pdf.js/).

## Features

- **Kindle-style reading experience** — continuous page flow, bottom progress
  slider with "Page X of Y · N% through the brochure", and keyboard paging.
- **Full-text search** — searches every page, shows results with context
  snippets, highlights matches on the page, and lets you step through results
  (Enter / Shift+Enter).
- **Page thumbnails** — lazily rendered thumbnail grid for fast visual navigation.
- **Reading themes** — Paper and Sepia, just like an e-reader.
- **Zoom controls** — zoom in/out, fit-width, fit-page, with crisp HiDPI rendering.
- **Text selection** — real selectable text via the pdf.js text layer.
- **Extras** — jump-to-page input, download button, full-screen mode.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `←` / `→` (or `PageUp` / `PageDown`) | Previous / next page |
| `Home` / `End` | First / last page |
| `+` / `-` | Zoom in / out |
| `Ctrl+F` or `/` | Open search |
| `Enter` / `Shift+Enter` (in search) | Next / previous result |

## Using your own brochure

The brochure is a local asset served from `public/brochure.pdf`.
**Replace that file with the real brochure PDF** — no code changes needed.
The title/subtitle shown in the header can be edited in `app/app.vue`.

A sample brochure (a fictional "Celebration of Life" program) is included and
can be regenerated with:

```bash
npm run make:pdf
```

## Setup

```bash
npm install
```

## Development

```bash
npm run dev
```

The app runs at http://localhost:3000.

## Production

```bash
npm run build      # server build (.output/)
npm run generate   # or: fully static site, deployable to any static host
```

## Project structure

```
app/
  app.vue                        # shell: points the reader at the PDF asset
  components/
    PdfReader.client.vue         # the Kindle-style PDF reader (client-only)
public/
  brochure.pdf                   # the brochure asset (replace with the real one)
scripts/
  generate-sample-pdf.mjs        # generates the sample brochure
```
