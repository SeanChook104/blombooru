function isExhentaiGalleryUrl(url) {
  try {
    const u = new URL(url);
    return /^(exhentai\.org|e-hentai\.org)$/i.test(u.hostname) && /^\/g\/\d+\//.test(u.pathname);
  } catch {
    return false;
  }
}

function stripExhentaiTagNamespace(tag) {
  const normalized = String(tag || "")
    .trim()
    .replace(/\s+/g, "_")
    .toLowerCase();
  const colon = normalized.indexOf(":");
  return colon >= 0 ? normalized.slice(colon + 1) : normalized;
}

function extractExhentaiTagsInPage() {
  const taglist = document.querySelector("#taglist");
  if (!taglist) return [];

  const tags = new Set();
  taglist.querySelectorAll('a[href*="/tag/"]').forEach((anchor) => {
    try {
      const path = new URL(anchor.href, location.origin).pathname;
      const match = path.match(/\/tag\/(.+)$/);
      if (!match?.[1]) return;
      const decoded = decodeURIComponent(match[1]).replace(/\+/g, " ").trim();
      const name = stripExhentaiTagNamespace(decoded);
      if (name) tags.add(name);
    } catch {
      // ignore malformed URLs
    }
  });

  return [...tags];
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "BLOM_PING" });
    return;
  } catch {
    // not loaded yet
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  });
  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ["content.css"]
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "blom-send-image",
      title: "Send image to Blombooru",
      contexts: ["image"]
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "blom-send-image" || !tab?.id) return;

  const imageUrl = info.srcUrl || "";
  const pageUrl = tab.url || "";
  if (!imageUrl) return;

  let tags = [];
  if (isExhentaiGalleryUrl(pageUrl)) {
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractExhentaiTagsInPage
      });
      if (Array.isArray(result)) tags = result;
    } catch {
      tags = [];
    }
  }

  await ensureContentScript(tab.id);

  const payload = {
    type: "BLOM_OPEN_IMAGE_UPLOAD",
    imageUrl,
    sourceUrl: pageUrl,
    tags
  };

  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      await chrome.tabs.sendMessage(tab.id, payload);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
  }

  console.error("Blombooru extension: failed to open upload UI after injection");
});
