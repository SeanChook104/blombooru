const baseUrlInput = document.getElementById("baseUrl");
const apiKeyInput = document.getElementById("apiKey");
const saveBtn = document.getElementById("saveBtn");
const statusEl = document.getElementById("status");

async function loadSettings() {
  const { blombooruBaseUrl = "", blombooruApiKey = "" } = await chrome.storage.sync.get([
    "blombooruBaseUrl",
    "blombooruApiKey"
  ]);
  baseUrlInput.value = blombooruBaseUrl;
  apiKeyInput.value = blombooruApiKey;
}

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? "#b00020" : "#1b5e20";
}

saveBtn.addEventListener("click", async () => {
  const baseUrl = baseUrlInput.value.trim().replace(/\/+$/, "");
  const apiKey = apiKeyInput.value.trim();

  if (!baseUrl) {
    setStatus("Base URL is required.", true);
    return;
  }

  if (!apiKey.startsWith("blom_")) {
    setStatus("API key must start with blom_.", true);
    return;
  }

  await chrome.storage.sync.set({
    blombooruBaseUrl: baseUrl,
    blombooruApiKey: apiKey
  });
  setStatus("Saved.");
});

loadSettings();
