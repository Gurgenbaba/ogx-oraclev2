import { isGalaxyPage } from "./ogx_context";
import { parseGalaxyPage } from "./galaxy_parser";
import { enqueue, safeFlush } from "../community/queue";

// debounce helper
function debounce(fn: () => void, ms: number) {
  let t: number | null = null;
  return () => {
    if (t) window.clearTimeout(t);
    t = window.setTimeout(() => {
      t = null;
      fn();
    }, ms);
  };
}

let lastKey = "";

function computeGalaxyKey(): string {
  const params = new URLSearchParams(location.search);
  const g = params.get("galaxy") || "";
  const s = params.get("system") || "";
  return `${location.pathname}?page=${params.get("page") || ""}&g=${g}&s=${s}`;
}

function runOnceIfChanged() {
  if (!isGalaxyPage()) return;

  const key = computeGalaxyKey();
  if (key === lastKey) return;
  lastKey = key;

  const items = parseGalaxyPage();
  if (!items.length) return;

  // TODO: local upsert (IndexedDB) comes next
  // Community upload
  for (const it of items) enqueue(it);

  // try flush soon (but safe)
  safeFlush().catch(() => void 0);
}

const debouncedRun = debounce(runOnceIfChanged, 450);

export function startCollector() {
  // initial
  debouncedRun();

  // URL changes (SPA-ish)
  window.addEventListener("popstate", debouncedRun);

  // listen to clicks that may change galaxy/system
  document.addEventListener(
    "click",
    () => {
      debouncedRun();
    },
    true
  );

  // Mutation observer (for ajax-rendered tables)
  const obs = new MutationObserver(() => debouncedRun());
  obs.observe(document.documentElement, { childList: true, subtree: true });
}
