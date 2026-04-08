# Blombooru Pixiv Importer Extension

## What it does

- Adds Pixiv page buttons to send media to Blombooru.
- Imports tags from Pixiv:
  - Artwork page: `/ajax/illust/{id}` -> `body.tags.tags[].tag`
  - Bookmark page API: `/ajax/user/{userId}/illusts/bookmarks` -> `body.works[].tags`
- Uploads each image page to Blombooru with:
  - `tags` (space-separated)
  - `source` = current Pixiv artwork URL

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `extensions/pixiv-blombooru`.

## Configure

1. Click the extension icon.
2. Set:
   - Blombooru Base URL (example: `http://localhost:8000`)
   - Blombooru API Key (`blom_...`)
3. Save.

## Use

- On `pixiv.net/.../artworks/{id}` click **Send to Blombooru**.
- On bookmark pages click:
  - **Send to Blombooru** (imports current bookmark page), or
  - **Send bookmark page**.

The fullscreen overlay shows progress, including image page number.
