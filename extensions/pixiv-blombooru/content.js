(function () {
  if (window.__blomPixivLoaded) return;
  window.__blomPixivLoaded = true;

  function isArtworkPage() {
    return /\/artworks\/\d+/.test(location.pathname);
  }

  function isBookmarkPage() {
    return /\/users\/\d+\/bookmarks\/artworks/.test(location.pathname);
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

  function sanitizeTag(tag) {
    return String(tag || "")
      .trim()
      .replace(/\s+/g, "_")
      .toLowerCase();
  }

  function ensureUi() {
    if (!document.getElementById("blom-pixiv-controls")) {
      const controls = document.createElement("div");
      controls.id = "blom-pixiv-controls";
      controls.innerHTML = `
        <button class="blom-pixiv-btn" id="blom-send-current">Send to Blombooru</button>
        ${isBookmarkPage() ? '<button class="blom-pixiv-btn secondary" id="blom-send-bookmark-page">Send bookmark page</button>' : ""}
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

  async function getArtworkPayload(illustId) {
    const details = await fetchJson(`https://www.pixiv.net/ajax/illust/${illustId}`);
    if (details.error || !details.body) {
      throw new Error("Failed to read artwork metadata.");
    }

    const pagesResp = await fetchJson(`https://www.pixiv.net/ajax/illust/${illustId}/pages`);
    if (pagesResp.error || !Array.isArray(pagesResp.body)) {
      throw new Error("Failed to read artwork pages.");
    }

    const rawTags = (details.body.tags?.tags || []).map((t) => t.tag);
    const tags = rawTags.map(sanitizeTag).filter(Boolean);
    const pageUrls = pagesResp.body.map((p) => p.urls?.original).filter(Boolean);

    return { tags, pageUrls };
  }

  async function importCurrentArtwork() {
    const illustId = getArtworkIdFromUrl();
    if (!illustId) throw new Error("No artwork ID found in URL.");

    const settings = await getSettings();
    const { tags, pageUrls } = await getArtworkPayload(illustId);
    const source = location.href;

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
        tags,
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
    const offset = (page - 1) * 48;
    const settings = await getSettings();

    setOverlay(true);
    setProgress("Reading bookmark page", `Page ${page}`, 0, 1);

    const data = await fetchJson(
      `https://www.pixiv.net/ajax/user/${userId}/illusts/bookmarks?tag=&offset=${offset}&limit=48&rest=show&lang=en`
    );

    if (data.error || !Array.isArray(data.body?.works)) {
      throw new Error("Failed to read bookmark page works.");
    }

    const works = data.body.works;
    let totalImages = 0;
    let doneImages = 0;
    const expanded = [];

    for (const work of works) {
      const id = work.id;
      const pagesResp = await fetchJson(`https://www.pixiv.net/ajax/illust/${id}/pages`);
      const pageUrls = (pagesResp.body || []).map((p) => p.urls?.original).filter(Boolean);
      const tags = (work.tags || []).map(sanitizeTag).filter(Boolean);
      expanded.push({ id, tags, pageUrls });
      totalImages += pageUrls.length;
    }

    if (totalImages === 0) throw new Error("No images found on this bookmark page.");

    for (const work of expanded) {
      for (let i = 0; i < work.pageUrls.length; i++) {
        const pageNo = i + 1;
        const source = `https://www.pixiv.net/en/artworks/${work.id}`;

        setProgress(
          `Bookmark page ${page} import`,
          `Artwork ${work.id} - image ${pageNo}/${work.pageUrls.length}`,
          doneImages,
          totalImages
        );

        const originalUrl = work.pageUrls[i];
        const blob = await fetchBlobViaBlombooruProxy(settings.baseUrl, settings.apiKey, originalUrl);
        const ext = (originalUrl.split("?")[0].match(/\.(\w+)$/)?.[1] || "jpg").toLowerCase();
        const file = new File([blob], `${work.id}_p${i}.${ext}`, { type: blob.type || "image/jpeg" });

        await uploadToBlombooru({
          baseUrl: settings.baseUrl,
          apiKey: settings.apiKey,
          file,
          tags: work.tags,
          source
        });
        doneImages += 1;
      }
    }

    setProgress("Done", `Uploaded ${doneImages} image(s) from bookmark page ${page}.`, doneImages, totalImages);
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
          await importBookmarkPage();
        } catch (err) {
          setProgress("Import failed", String(err.message || err), 0, 1);
          setOverlay(true);
        }
      };
    }
  }

  function init() {
    if (!isArtworkPage() && !isBookmarkPage()) return;
    ensureUi();
    bindActions();
  }

  init();
})();
