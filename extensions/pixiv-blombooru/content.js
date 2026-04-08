(function () {
  if (window.__blomPixivLoaded) return;
  window.__blomPixivLoaded = true;

  function isArtworkPage() {
    return /\/artworks\/\d+/.test(location.pathname);
  }

  function isBookmarkPage() {
    return /\/users\/\d+\/bookmarks\/artworks/.test(location.pathname);
  }
  function isSankakuPostPage() {
    return /^\/[a-z]{2}\/posts\/[^/?#]+/.test(location.pathname);
  }
  function isSankakuListPage() {
    return /^\/[a-z]{2}\/posts\/?$/.test(location.pathname);
  }

  function getArtworkIdFromUrl() {
    const match = location.pathname.match(/\/artworks\/(\d+)/);
    return match ? match[1] : null;
  }

  function getBookmarkUserId() {
    const match = location.pathname.match(/\/users\/(\d+)\/bookmarks\/artworks/);
    return match ? match[1] : null;
  }

  function getBookmarkPage() {
    const p = Number(new URL(location.href).searchParams.get("p") || "1");
    return Number.isFinite(p) && p > 0 ? p : 1;
  }

  function getBookmarkTagFromPath() {
    const match = location.pathname.match(/\/users\/\d+\/bookmarks\/artworks\/([^/?#]+)/);
    if (!match?.[1]) return "";
    try {
      return decodeURIComponent(match[1]).trim();
    } catch {
      return match[1].trim();
    }
  }

  function sanitizeTag(tag) {
    return String(tag || "")
      .trim()
      .replace(/\s+/g, "_")
      .toLowerCase();
  }

  function toArtistTag(authorName) {
    const cleaned = sanitizeTag(authorName);
    return cleaned ? `artist:${cleaned}` : "";
  }

  function ensureUi() {
    if (!document.getElementById("blom-pixiv-controls")) {
      const controls = document.createElement("div");
      controls.id = "blom-pixiv-controls";
      controls.innerHTML = `
        <button class="blom-pixiv-btn" id="blom-send-current">Send to Blombooru</button>
        ${(isBookmarkPage() || isSankakuListPage()) ? '<button class="blom-pixiv-btn secondary" id="blom-send-bookmark-page">Send page</button>' : ""}
      `;
      document.body.appendChild(controls);
    }

    if (!document.getElementById("blom-pixiv-overlay")) {
      const overlay = document.createElement("div");
      overlay.id = "blom-pixiv-overlay";
      overlay.innerHTML = `
        <div class="inner">
          <h2>Blombooru Pixiv Import</h2>
          <div class="line" id="blom-progress-main">Ready</div>
          <div class="line" id="blom-progress-sub"></div>
          <div class="progress-wrap"><div class="progress" id="blom-progress-bar"></div></div>
        </div>
      `;
      document.body.appendChild(overlay);
    }
  }

  function setOverlay(visible) {
    const overlay = document.getElementById("blom-pixiv-overlay");
    if (overlay) overlay.style.display = visible ? "flex" : "none";
  }

  function setProgress(mainText, subText, current, total) {
    const main = document.getElementById("blom-progress-main");
    const sub = document.getElementById("blom-progress-sub");
    const bar = document.getElementById("blom-progress-bar");
    if (main) main.textContent = mainText || "";
    if (sub) sub.textContent = subText || "";
    if (bar) {
      const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
      bar.style.width = `${pct}%`;
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function getBookmarkImportSettings() {
    const defaults = await chrome.storage.sync.get([
      "pixivWaitMs",
      "pixivBookmarkSessionTag",
      "pixivRetryMax",
      "pixivSkipErrors"
    ]);

    const waitMs = Number(defaults.pixivWaitMs ?? 350);
    const sessionTag = String(defaults.pixivBookmarkSessionTag ?? "").trim();
    const retryMax = Number(defaults.pixivRetryMax ?? 5);
    const skipErrors = Boolean(defaults.pixivSkipErrors ?? true);

    return new Promise((resolve) => {
      ensureUi();
      setOverlay(true);

      const inner = document.querySelector("#blom-pixiv-overlay .inner");
      if (!inner) return resolve(null);

      inner.innerHTML = `
        <h2>Bookmark import settings</h2>
        <div class="line" style="font-size: 12px; opacity: 0.9;">These apply to this bookmark import session.</div>
        <div class="line">
          <label style="display:block; font-size:12px; margin-bottom:4px;">Wait (ms) between Pixiv API requests</label>
          <input id="blom-waitms" type="number" min="0" step="50" value="${Number.isFinite(waitMs) ? waitMs : 350}"
            style="width: 100%; padding: 8px; border-radius: 8px; border: 1px solid #444; background:#111; color:#fff;" />
        </div>
        <div class="line">
          <label style="display:block; font-size:12px; margin-bottom:4px;">Add tag to all imported posts (optional)</label>
          <input id="blom-sessiontag" type="text" value="${sessionTag.replace(/"/g, "&quot;")}"
            placeholder="e.g. pixiv_bookmark_2026_04"
            style="width: 100%; padding: 8px; border-radius: 8px; border: 1px solid #444; background:#111; color:#fff;" />
        </div>
        <div class="line">
          <label style="display:block; font-size:12px; margin-bottom:4px;">Retry max (stop after this many failures)</label>
          <input id="blom-retrymax" type="number" min="1" max="10" step="1" value="${Number.isFinite(retryMax) ? retryMax : 5}"
            style="width: 100%; padding: 8px; border-radius: 8px; border: 1px solid #444; background:#111; color:#fff;" />
        </div>
        <div class="line">
          <label style="display:flex; align-items:center; gap:8px; font-size:12px;">
            <input id="blom-skip-errors" type="checkbox" ${skipErrors ? "checked" : ""} />
            Skip error URLs (continue when a link is dead)
          </label>
        </div>
        <div class="line" style="display:flex; gap: 10px; margin-top: 12px;">
          <button id="blom-cancel-settings" class="blom-pixiv-btn secondary" style="flex:1;">Cancel</button>
          <button id="blom-start-settings" class="blom-pixiv-btn" style="flex:1;">Start</button>
        </div>
        <div class="progress-wrap" style="margin-top: 14px;"><div class="progress" id="blom-progress-bar" style="width:0%"></div></div>
        <div class="line" id="blom-progress-main" style="margin-top: 10px;">Waiting…</div>
        <div class="line" id="blom-progress-sub" style="font-size: 12px; opacity: 0.85;"></div>
      `;

      const cancelBtn = document.getElementById("blom-cancel-settings");
      const startBtn = document.getElementById("blom-start-settings");
      const waitEl = document.getElementById("blom-waitms");
      const tagEl = document.getElementById("blom-sessiontag");
      const retryEl = document.getElementById("blom-retrymax");
      const skipErrorsEl = document.getElementById("blom-skip-errors");

      const cleanup = () => {
        // restore base overlay UI (progress UI) for import flow
        const overlay = document.getElementById("blom-pixiv-overlay");
        if (!overlay) return;
        overlay.innerHTML = `
          <div class="inner">
            <h2>Blombooru Pixiv Import</h2>
            <div class="line" id="blom-progress-main">Ready</div>
            <div class="line" id="blom-progress-sub"></div>
            <div class="progress-wrap"><div class="progress" id="blom-progress-bar"></div></div>
          </div>
        `;
      };

      cancelBtn.onclick = () => {
        cleanup();
        setOverlay(false);
        resolve(null);
      };

      startBtn.onclick = async () => {
        const wait = Math.max(0, Number(waitEl.value || 0));
        const sessionTagRaw = String(tagEl.value || "").trim();
        const retry = Math.max(1, Math.min(10, Number(retryEl.value || 5)));
        const skipErrorsVal = Boolean(skipErrorsEl?.checked);

        await chrome.storage.sync.set({
          pixivWaitMs: wait,
          pixivBookmarkSessionTag: sessionTagRaw,
          pixivRetryMax: retry,
          pixivSkipErrors: skipErrorsVal
        });

        cleanup();
        resolve({
          waitMs: wait,
          sessionTag: sessionTagRaw,
          retryMax: retry,
          skipErrors: skipErrorsVal
        });
      };
    });
  }

  async function getSettings() {
    const { blombooruBaseUrl = "", blombooruApiKey = "" } = await chrome.storage.sync.get([
      "blombooruBaseUrl",
      "blombooruApiKey"
    ]);
    if (!blombooruBaseUrl || !blombooruApiKey) {
      throw new Error("Please configure Blombooru URL and API key in the extension popup.");
    }
    return {
      baseUrl: blombooruBaseUrl.replace(/\/+$/, ""),
      apiKey: blombooruApiKey
    };
  }

  async function fetchJson(url) {
    const resp = await fetch(url, { credentials: "include" });
    if (!resp.ok) throw new Error(`Pixiv API error: ${resp.status}`);
    return resp.json();
  }

  async function withRetry(fn, retryMax, label) {
    let lastErr;
    for (let attempt = 1; attempt <= retryMax; attempt++) {
      try {
        return await fn(attempt);
      } catch (e) {
        lastErr = e;
        setProgress("Retrying…", `${label} (attempt ${attempt}/${retryMax}): ${String(e.message || e)}`, 0, 1);
        await sleep(Math.min(2000, 250 * attempt));
      }
    }
    throw lastErr || new Error("Unknown error");
  }

  async function fetchBlobViaBlombooruProxy(baseUrl, apiKey, imageUrl) {
    const proxyUrl = `${baseUrl}/api/booru-import/proxy-image?url=${encodeURIComponent(imageUrl)}`;
    const resp = await fetch(proxyUrl, {
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });
    if (!resp.ok) throw new Error(`Image download failed via proxy: ${resp.status}`);
    return resp.blob();
  }

  async function uploadToBlombooru({ baseUrl, apiKey, file, tags, source }) {
    const form = new FormData();
    form.append("file", file, file.name);
    form.append("rating", "safe");
    form.append("tags", tags.join(" "));
    form.append("source", source);

    const resp = await fetch(`${baseUrl}/api/media/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      body: form
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Blombooru upload failed (${resp.status}): ${errText}`);
    }
  }

  function buildUgoiraFrameUrls(originalTemplate, frameCount) {
    const urls = [];
    for (let i = 0; i < frameCount; i++) {
      urls.push(originalTemplate.replace("ugoira0.", `ugoira${i}.`));
    }
    return urls;
  }

  async function uploadUgoiraGifToBlombooru({
    baseUrl,
    apiKey,
    illustId,
    originalTemplate,
    framesMeta,
    tags,
    source,
    retryMax
  }) {
    const frameUrls = buildUgoiraFrameUrls(originalTemplate, framesMeta.length);
    const delays = framesMeta.map((f) => Number(f.delay || 60));
    const form = new FormData();
    form.append("rating", "safe");
    form.append("tags", tags.join(" "));
    form.append("source", source);
    form.append("filename_base", `${illustId}_ugoira`);
    form.append("delays", JSON.stringify(delays));

    for (let i = 0; i < frameUrls.length; i++) {
      const frameUrl = frameUrls[i];
      const blob = await withRetry(
        () => fetchBlobViaBlombooruProxy(baseUrl, apiKey, frameUrl),
        retryMax,
        `Download ugoira frame ${i + 1}/${frameUrls.length}`
      );
      const ext = (frameUrl.split("?")[0].match(/\.(\w+)$/)?.[1] || "jpg").toLowerCase();
      const file = new File([blob], `${illustId}_f${i}.${ext}`, { type: blob.type || "image/jpeg" });
      form.append("frames", file, file.name);
    }

    const resp = await fetch(`${baseUrl}/api/media/ugoira-gif`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      body: form
    });
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Ugoira GIF upload failed (${resp.status}): ${errText}`);
    }
  }

  async function getArtworkPayload(illustId) {
    const details = await fetchJson(`https://www.pixiv.net/ajax/illust/${illustId}`);
    if (details.error || !details.body) {
      throw new Error("Failed to read artwork metadata.");
    }

    const rawTags = (details.body.tags?.tags || []).map((t) => t.tag);
    const tags = rawTags.map(sanitizeTag).filter(Boolean);
    const artistTag = toArtistTag(details.body.userName);
    if (artistTag) tags.push(artistTag);

    if (Number(details.body.illustType) === 2) {
      const ugoiraMeta = await fetchJson(`https://www.pixiv.net/ajax/illust/${illustId}/ugoira_meta`);
      if (ugoiraMeta.error || !ugoiraMeta.body || !Array.isArray(ugoiraMeta.body.frames)) {
        throw new Error("Failed to read ugoira metadata.");
      }
      return {
        tags,
        kind: "ugoira",
        originalTemplate: details.body.urls?.original || "",
        framesMeta: ugoiraMeta.body.frames
      };
    }

    const pagesResp = await fetchJson(`https://www.pixiv.net/ajax/illust/${illustId}/pages`);
    if (pagesResp.error || !Array.isArray(pagesResp.body)) {
      throw new Error("Failed to read artwork pages.");
    }
    const pageUrls = pagesResp.body.map((p) => p.urls?.original).filter(Boolean);
    return { tags, kind: "images", pageUrls };
  }

  async function importCurrentArtwork() {
    const illustId = getArtworkIdFromUrl();
    if (!illustId) throw new Error("No artwork ID found in URL.");

    const settings = await getSettings();
    const payload = await getArtworkPayload(illustId);
    const source = location.href;

    if (payload.kind === "ugoira") {
      if (!payload.originalTemplate || !payload.framesMeta?.length) {
        throw new Error("No ugoira frames found.");
      }
      setOverlay(true);
      setProgress(`Sending ugoira ${illustId}`, "Converting to GIF and uploading…", 0, 1);
      await uploadUgoiraGifToBlombooru({
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
        illustId,
        originalTemplate: payload.originalTemplate,
        framesMeta: payload.framesMeta,
        tags: payload.tags,
        source,
        retryMax: 5
      });
      setProgress("Done", "Uploaded 1 GIF.", 1, 1);
      setTimeout(() => setOverlay(false), 1200);
      return;
    }

    const pageUrls = payload.pageUrls || [];
    if (pageUrls.length === 0) throw new Error("No image pages found.");

    setOverlay(true);
    for (let i = 0; i < pageUrls.length; i++) {
      const pageNo = i + 1;
      setProgress(
        `Sending artwork ${illustId}`,
        `Image page ${pageNo}/${pageUrls.length}`,
        pageNo - 1,
        pageUrls.length
      );

      const originalUrl = pageUrls[i];
      const blob = await fetchBlobViaBlombooruProxy(settings.baseUrl, settings.apiKey, originalUrl);
      const ext = (originalUrl.split("?")[0].match(/\.(\w+)$/)?.[1] || "jpg").toLowerCase();
      const file = new File([blob], `${illustId}_p${i}.${ext}`, { type: blob.type || "image/jpeg" });

      await uploadToBlombooru({
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
        file,
        tags: payload.tags,
        source
      });

      setProgress(
        `Sending artwork ${illustId}`,
        `Image page ${pageNo}/${pageUrls.length}`,
        pageNo,
        pageUrls.length
      );
    }

    setProgress("Done", `Uploaded ${pageUrls.length} image(s).`, pageUrls.length, pageUrls.length);
    setTimeout(() => setOverlay(false), 1200);
  }

  async function importBookmarkPage() {
    const userId = getBookmarkUserId();
    if (!userId) throw new Error("No bookmark user ID found in URL.");

    const page = getBookmarkPage();
    const bookmarkTagFilter = getBookmarkTagFromPath();
    const offset = (page - 1) * 48;
    const settings = await getSettings();

    const sessionSettings = await getBookmarkImportSettings();
    if (!sessionSettings) return; // cancelled

    const sessionTag = sanitizeTag(sessionSettings.sessionTag);
    const waitMs = sessionSettings.waitMs;
    const retryMax = sessionSettings.retryMax || 5;
    const skipErrors = Boolean(sessionSettings.skipErrors);

    setOverlay(true);
    setProgress("Reading bookmark page", `Page ${page}`, 0, 1);

    const data = await withRetry(
      () =>
        fetchJson(
          `https://www.pixiv.net/ajax/user/${userId}/illusts/bookmarks?tag=${encodeURIComponent(bookmarkTagFilter)}&offset=${offset}&limit=48&rest=show&lang=en`
        ),
      retryMax,
      "Fetch bookmark list"
    );
    await sleep(waitMs);

    if (data.error || !Array.isArray(data.body?.works)) {
      throw new Error("Failed to read bookmark page works.");
    }

    const works = data.body.works;
    let totalUnits = 0;
    let doneUnits = 0;
    const expanded = [];

    for (const work of works) {
      const id = work.id;
      let details;
      try {
        details = await withRetry(
          () => fetchJson(`https://www.pixiv.net/ajax/illust/${id}`),
          retryMax,
          `Fetch details for ${id}`
        );
        await sleep(waitMs);
      } catch (e) {
        if (!skipErrors) throw e;
        setProgress("Skipping dead/failed URL", `Details failed for ${id}: ${String(e.message || e)}`, doneUnits, totalUnits || 1);
        continue;
      }
      const tags = (details.body?.tags?.tags || work.tags || [])
        .map((t) => sanitizeTag(t.tag || t))
        .filter(Boolean);
      const artistTag = toArtistTag(details.body?.userName || work.userName);
      if (artistTag) tags.push(artistTag);
      if (sessionTag) tags.push(sessionTag);

      if (Number(details.body?.illustType) === 2) {
        let ugoiraMeta;
        try {
          ugoiraMeta = await withRetry(
            () => fetchJson(`https://www.pixiv.net/ajax/illust/${id}/ugoira_meta`),
            retryMax,
            `Fetch ugoira meta for ${id}`
          );
          await sleep(waitMs);
        } catch (e) {
          if (!skipErrors) throw e;
          setProgress("Skipping dead/failed URL", `Ugoira meta failed for ${id}: ${String(e.message || e)}`, doneUnits, totalUnits || 1);
          continue;
        }
        expanded.push({
          id,
          tags,
          kind: "ugoira",
          originalTemplate: details.body?.urls?.original || "",
          framesMeta: ugoiraMeta.body?.frames || []
        });
        totalUnits += 1;
      } else {
        let pagesResp;
        try {
          pagesResp = await withRetry(
            () => fetchJson(`https://www.pixiv.net/ajax/illust/${id}/pages`),
            retryMax,
            `Fetch pages for ${id}`
          );
          await sleep(waitMs);
        } catch (e) {
          if (!skipErrors) throw e;
          setProgress("Skipping dead/failed URL", `Pages failed for ${id}: ${String(e.message || e)}`, doneUnits, totalUnits || 1);
          continue;
        }
        const pageUrls = (pagesResp.body || []).map((p) => p.urls?.original).filter(Boolean);
        expanded.push({ id, tags, kind: "images", pageUrls });
        totalUnits += pageUrls.length;
      }
    }

    if (totalUnits === 0) throw new Error("No images found on this bookmark page.");

    for (const work of expanded) {
      if (work.kind === "ugoira") {
        const source = `https://www.pixiv.net/en/artworks/${work.id}`;
        setProgress(
          `Bookmark page ${page} import`,
          `Artwork ${work.id} - ugoira to GIF`,
          doneUnits,
          totalUnits
        );
        try {
          await withRetry(
            () =>
              uploadUgoiraGifToBlombooru({
                baseUrl: settings.baseUrl,
                apiKey: settings.apiKey,
                illustId: work.id,
                originalTemplate: work.originalTemplate,
                framesMeta: work.framesMeta,
                tags: work.tags,
                source,
                retryMax
              }),
            retryMax,
            `Upload ugoira ${work.id}`
          );
        } catch (e) {
          if (!skipErrors) throw e;
          setProgress("Skipping dead/failed URL", `Upload failed for ugoira ${work.id}: ${String(e.message || e)}`, doneUnits, totalUnits || 1);
          continue;
        }
        doneUnits += 1;
        continue;
      }

      for (let i = 0; i < work.pageUrls.length; i++) {
        const pageNo = i + 1;
        const source = `https://www.pixiv.net/en/artworks/${work.id}`;

        setProgress(
          `Bookmark page ${page} import`,
          `Artwork ${work.id} - image ${pageNo}/${work.pageUrls.length}`,
          doneUnits,
          totalUnits
        );

        const originalUrl = work.pageUrls[i];
        let blob;
        try {
          blob = await withRetry(
            () => fetchBlobViaBlombooruProxy(settings.baseUrl, settings.apiKey, originalUrl),
            retryMax,
            `Download ${work.id}_p${i}`
          );
        } catch (e) {
          if (!skipErrors) throw e;
          setProgress("Skipping dead/failed URL", `Download failed for ${work.id}_p${i}: ${String(e.message || e)}`, doneUnits, totalUnits || 1);
          continue;
        }
        const ext = (originalUrl.split("?")[0].match(/\.(\w+)$/)?.[1] || "jpg").toLowerCase();
        const file = new File([blob], `${work.id}_p${i}.${ext}`, { type: blob.type || "image/jpeg" });

        try {
          await withRetry(
            () =>
              uploadToBlombooru({
                baseUrl: settings.baseUrl,
                apiKey: settings.apiKey,
                file,
                tags: work.tags,
                source
              }),
            retryMax,
            `Upload ${work.id}_p${i}`
          );
        } catch (e) {
          if (!skipErrors) throw e;
          setProgress("Skipping dead/failed URL", `Upload failed for ${work.id}_p${i}: ${String(e.message || e)}`, doneUnits, totalUnits || 1);
          continue;
        }
        doneUnits += 1;
      }
    }

    setProgress("Done", `Uploaded ${doneUnits} item(s) from bookmark page ${page}.`, doneUnits, totalUnits);
    setTimeout(() => setOverlay(false), 1400);
  }

  async function fetchHtmlDoc(url) {
    const resp = await fetch(url, { credentials: "include" });
    if (!resp.ok) {
      throw new Error(`Failed to fetch page: ${resp.status}`);
    }
    const text = await resp.text();
    return new DOMParser().parseFromString(text, "text/html");
  }

  function toAbsoluteUrl(urlLike) {
    if (!urlLike) return "";
    if (urlLike.startsWith("//")) return `https:${urlLike}`;
    if (urlLike.startsWith("http://") || urlLike.startsWith("https://")) return urlLike;
    return new URL(urlLike, location.origin).toString();
  }

  function extractSankakuTagsAndAuthorFromAutoPage(autoText) {
    const full = String(autoText || "");
    const tagPart = full.split(" Rating:")[0] || "";
    const tags = tagPart.split(/\s+/).map(sanitizeTag).filter(Boolean);
    const userMatch = full.match(/\bUser:([^\s]+)/);
    const author = userMatch?.[1] || "";
    return { tags, author };
  }

  function resolveSankakuMediaUrls(docLike) {
    const originalHref = toAbsoluteUrl(
      docLike.querySelector("#image-link[href]")?.getAttribute("href") ||
      docLike.querySelector("#highres[href]")?.getAttribute("href") ||
      docLike.querySelector("a[itemprop='contentUrl'][href]")?.getAttribute("href") ||
      ""
    );
    const resizedHref = toAbsoluteUrl(
      docLike.querySelector("#image[src]")?.getAttribute("src") ||
      docLike.querySelector("#post-content img[src]")?.getAttribute("src") ||
      docLike.querySelector("img.fit-width[src], img.fit-height[src]")?.getAttribute("src") ||
      ""
    );
    return { originalHref, resizedHref };
  }

  async function downloadSankakuWithFallback(settings, originalHref, resizedHref, retryMax, labelBase) {
    if (!originalHref && !resizedHref) {
      throw new Error("No media link found on Sankaku post.");
    }

    const originalAttempts = Math.max(1, Math.min(3, Number(retryMax) || 3));
    if (originalHref) {
      try {
        return {
          blob: await withRetry(
            () => fetchBlobViaBlombooruProxy(settings.baseUrl, settings.apiKey, originalHref),
            originalAttempts,
            `${labelBase} (original)`
          ),
          usedUrl: originalHref
        };
      } catch (_err) {
        // Fall through to resized URL after 3 failed original attempts.
      }
    }

    if (!resizedHref) {
      throw new Error("Original media failed and no resized fallback found.");
    }

    return {
      blob: await withRetry(
        () => fetchBlobViaBlombooruProxy(settings.baseUrl, settings.apiKey, resizedHref),
        Math.max(1, retryMax),
        `${labelBase} (resized fallback)`
      ),
      usedUrl: resizedHref
    };
  }

  async function importSankakuCurrentPost() {
    const settings = await getSettings();
    const pageUrl = location.href;
    const source = pageUrl;

    const { originalHref, resizedHref } = resolveSankakuMediaUrls(document);
    if (!originalHref && !resizedHref) {
      throw new Error("Could not find media link on Sankaku post page.");
    }

    const tagAnchors = [...document.querySelectorAll("a.tag-link[href*='tags=']")];
    const tags = tagAnchors
      .map((a) => {
        try {
          const u = new URL(a.href, location.origin);
          return sanitizeTag(u.searchParams.get("tags") || a.textContent || "");
        } catch {
          return sanitizeTag(a.textContent || "");
        }
      })
      .filter(Boolean);

    const titleText = document.querySelector("title")?.textContent || "";
    const authorMatch = titleText.match(/\sby\s(.+?)\s\|\sSankaku/i);
    const authorTag = toArtistTag(authorMatch?.[1] || "");
    if (authorTag) tags.push(authorTag);

    setOverlay(true);
    setProgress("Sending Sankaku post", "Downloading media…", 0, 1);
    const { blob, usedUrl } = await downloadSankakuWithFallback(
      settings,
      originalHref,
      resizedHref,
      5,
      "Download Sankaku post"
    );
    const ext = (usedUrl.split("?")[0].match(/\.(\w+)$/)?.[1] || "jpg").toLowerCase();
    const postId = location.pathname.split("/").pop() || "sankaku_post";
    const file = new File([blob], `${postId}.${ext}`, { type: blob.type || "application/octet-stream" });

    await withRetry(
      () => uploadToBlombooru({ baseUrl: settings.baseUrl, apiKey: settings.apiKey, file, tags, source }),
      5,
      "Upload Sankaku post"
    );
    setProgress("Done", "Uploaded 1 item.", 1, 1);
    setTimeout(() => setOverlay(false), 1200);
  }

  async function importSankakuListPage() {
    const settings = await getSettings();
    const sessionSettings = await getBookmarkImportSettings();
    if (!sessionSettings) return;

    const sessionTag = sanitizeTag(sessionSettings.sessionTag);
    const waitMs = sessionSettings.waitMs;
    const retryMax = sessionSettings.retryMax || 5;
    const skipErrors = Boolean(sessionSettings.skipErrors);

    const cards = [...document.querySelectorAll("article.post-preview[data-id]")];
    if (!cards.length) throw new Error("No Sankaku posts found on this page.");

    const lang = (location.pathname.match(/^\/([a-z]{2})\//)?.[1]) || "en";
    let done = 0;
    setOverlay(true);

    for (const card of cards) {
      const postId = card.getAttribute("data-id");
      if (!postId) continue;
      const source = `${location.origin}/${lang}/posts/${postId}`;
      setProgress("Sankaku page import", `Resolving post ${postId}`, done, cards.length);

      const img = card.querySelector("img[data-auto_page]");
      const parsed = extractSankakuTagsAndAuthorFromAutoPage(img?.getAttribute("data-auto_page") || "");
      const tags = [...parsed.tags];
      const authorTag = toArtistTag(parsed.author);
      if (authorTag) tags.push(authorTag);
      if (sessionTag) tags.push(sessionTag);

      let postDoc;
      try {
        postDoc = await withRetry(
          () => fetchHtmlDoc(source),
          retryMax,
          `Fetch Sankaku post page ${postId}`
        );
        await sleep(waitMs);
      } catch (e) {
        if (!skipErrors) throw e;
        setProgress("Skipping dead/failed URL", `Post page failed for ${postId}: ${String(e.message || e)}`, done, cards.length);
        continue;
      }

      const { originalHref, resizedHref } = resolveSankakuMediaUrls(postDoc);
      if (!originalHref && !resizedHref) {
        throw new Error(`No media link for post ${postId}`);
      }

      let blob;
      let usedUrl = "";
      try {
        const downloaded = await downloadSankakuWithFallback(
          settings,
          originalHref,
          resizedHref,
          retryMax,
          `Download Sankaku ${postId}`
        );
        blob = downloaded.blob;
        usedUrl = downloaded.usedUrl;
      } catch (e) {
        if (!skipErrors) throw e;
        setProgress("Skipping dead/failed URL", `Download failed for ${postId}: ${String(e.message || e)}`, done, cards.length);
        continue;
      }
      const ext = (usedUrl.split("?")[0].match(/\.(\w+)$/)?.[1] || "jpg").toLowerCase();
      const file = new File([blob], `${postId}.${ext}`, { type: blob.type || "application/octet-stream" });

      try {
        await withRetry(
          () => uploadToBlombooru({ baseUrl: settings.baseUrl, apiKey: settings.apiKey, file, tags, source }),
          retryMax,
          `Upload Sankaku ${postId}`
        );
      } catch (e) {
        if (!skipErrors) throw e;
        setProgress("Skipping dead/failed URL", `Upload failed for ${postId}: ${String(e.message || e)}`, done, cards.length);
        continue;
      }
      done += 1;
    }

    setProgress("Done", `Uploaded ${done} item(s) from this Sankaku page.`, done, cards.length);
    setTimeout(() => setOverlay(false), 1400);
  }

  function bindActions() {
    const currentBtn = document.getElementById("blom-send-current");
    const bookmarkBtn = document.getElementById("blom-send-bookmark-page");

    if (currentBtn) {
      currentBtn.onclick = async () => {
        try {
          if (isArtworkPage()) {
            await importCurrentArtwork();
          } else if (isSankakuPostPage()) {
            await importSankakuCurrentPost();
          } else if (isSankakuListPage()) {
            await importSankakuListPage();
          } else if (isBookmarkPage()) {
            await importBookmarkPage();
          } else {
            throw new Error("Unsupported page.");
          }
        } catch (err) {
          setProgress("Import failed", String(err.message || err), 0, 1);
          setOverlay(true);
        }
      };
    }

    if (bookmarkBtn) {
      bookmarkBtn.onclick = async () => {
        try {
          if (isBookmarkPage()) {
            await importBookmarkPage();
          } else if (isSankakuListPage()) {
            await importSankakuListPage();
          }
        } catch (err) {
          setProgress("Import failed", String(err.message || err), 0, 1);
          setOverlay(true);
        }
      };
    }
  }

  function init() {
    if (!isArtworkPage() && !isBookmarkPage() && !isSankakuPostPage() && !isSankakuListPage()) {
      return;
    }
    ensureUi();
    bindActions();
  }

  init();
})();
