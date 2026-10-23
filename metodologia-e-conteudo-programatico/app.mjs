import { loadPublicCatalog } from "./catalog_service.mjs";

const REFRESH_INTERVAL_MS = 120000;
const REQUEST_TIMEOUT_MS = 12000;
const heroCount = document.getElementById("catalogHeroCount");

const state = {
  isLoading: false,
  lastLoadedAt: 0
};

async function refreshCatalogCount() {
  if (!heroCount || state.isLoading) return;

  state.isLoading = true;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const lessons = await loadPublicCatalog(window.fetch.bind(window), {
      signal: controller.signal
    });
    heroCount.textContent = String(lessons.length);
    state.lastLoadedAt = Date.now();
  } catch {
    // Retain the last valid count when the public catalog is unavailable.
  } finally {
    window.clearTimeout(timeout);
    state.isLoading = false;
  }
}

function refreshIfNeeded() {
  if (document.visibilityState !== "visible") return;
  if (Date.now() - state.lastLoadedAt < REFRESH_INTERVAL_MS) return;
  void refreshCatalogCount();
}

if (heroCount) {
  document.addEventListener("visibilitychange", refreshIfNeeded);
  window.setInterval(refreshIfNeeded, REFRESH_INTERVAL_MS);
  void refreshCatalogCount();
}
