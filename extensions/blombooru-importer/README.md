# Blombooru Web Importer

Browser extension to send images from the web into your [Blombooru](https://github.com/mrblomblo/blombooru) instance.

## Features

- **Right-click any image** → **Send image to Blombooru** — tag/source form, then upload via API key.
- **ExHentai / E-Hentai** gallery pages (`/g/{id}/…`) — auto-fill tags from `#taglist` (namespaces stripped: `anon`, `filming`, `arknights_endfield`, …).
- **Pixiv** — artwork and bookmark pages with bulk import.
- **Sankaku** — single posts and list pages.
- Source URL defaults to the current page (editable before upload).

## Install

1. Open `chrome://extensions` (or your browser’s extension page).
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select: `extensions/blombooru-importer`.

## Configure

1. Click the extension icon.
2. Set **Blombooru Base URL** (e.g. `http://localhost:8000`).
3. Set **Blombooru API Key** (`blom_…` from Admin → API keys).
4. Save.

## Use

| Site | How |
|------|-----|
| Any site | Right-click image → **Send image to Blombooru** |
| Pixiv artwork | **Send to Blombooru** (floating button) |
| Pixiv bookmarks | **Send to Blombooru** / **Send page** |
| Sankaku post | **Send to Blombooru** |
| Sankaku list | **Send page** |

Progress is shown in the fullscreen overlay.
