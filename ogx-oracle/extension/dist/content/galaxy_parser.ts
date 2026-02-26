import { IngestEntity } from "../shared/types";
import { getUniverseIdFromLocation, getGalaxySystemFromDomOrUrl } from "./ogx_context";

function clean(t: string | null | undefined): string {
  return (t || "").replace(/\s+/g, " ").trim();
}

function pickText(el: Element | null | undefined): string | null {
  if (!el) return null;
  const t = clean(el.textContent);
  return t || null;
}

function parsePos(row: Element): number | null {
  // common patterns: ".position", "td.position"
  const posEl =
    row.querySelector(".position") ||
    row.querySelector("td.position") ||
    row.querySelector('td[class*="position"]');

  const t = pickText(posEl);
  if (!t) return null;
  const n = parseInt(t, 10);
  return Number.isFinite(n) ? n : null;
}

function hasMoon(row: Element): boolean {
  // common patterns: .moon, .moonlink, .moonIcon
  return !!(row.querySelector(".moon") || row.querySelector(".moonlink") || row.querySelector('[class*="moon"]'));
}

function parseStatus(row: Element): Record<string, any> {
  const status: Record<string, any> = {};

  // Many clones put status icons in a status cell
  const imgs = row.querySelectorAll(".status img, td.status img, img.status, .microplanet img");
  imgs.forEach((img) => {
    const alt = clean(img.getAttribute("alt") || "");
    const title = clean(img.getAttribute("title") || "");
    const key = alt || title;
    if (key) status[key] = true;
  });

  // Also sometimes status flags as classes
  const cls = row.getAttribute("class") || "";
  if (cls.includes("inactive")) status["inactive"] = true;
  if (cls.includes("active")) status["active"] = true;

  return status;
}

function parsePlayerName(row: Element): string | null {
  return (
    pickText(row.querySelector(".playername")) ||
    pickText(row.querySelector(".playerName")) ||
    pickText(row.querySelector('td[class*="playername"]')) ||
    null
  );
}

function parseAllianceTag(row: Element): string | null {
  const t =
    pickText(row.querySelector(".allytag")) ||
    pickText(row.querySelector(".alliance")) ||
    pickText(row.querySelector('td[class*="ally"]')) ||
    null;

  // Often rendered like "[TAG]"
  if (t && t.startsWith("[") && t.endsWith("]")) return t.slice(1, -1);
  return t;
}

function parsePlanetName(row: Element): string | null {
  return (
    pickText(row.querySelector(".planetname")) ||
    pickText(row.querySelector(".planetName")) ||
    pickText(row.querySelector('td[class*="planetname"]')) ||
    null
  );
}

export function parseGalaxyPage(): IngestEntity[] {
  const universeId = getUniverseIdFromLocation();
  const { galaxy, system } = getGalaxySystemFromDomOrUrl();

  if (!galaxy || !system) return [];

  // Try common selectors for galaxy rows
  const rows = Array.from(
    document.querySelectorAll(
      "table.galaxyTable tr, table#galaxytable tr, table#galaxyTable tr, .galaxyTable tr"
    )
  );

  const out: IngestEntity[] = [];
  const pageUrl = location.href;

  for (const row of rows) {
    const pos = parsePos(row);
    if (!pos) continue;

    const playerName = parsePlayerName(row);
    const allianceTag = parseAllianceTag(row);
    const planetName = parsePlanetName(row);

    // We store planet row as planet, and additionally moon row if present? (we do both)
    const base: Omit<IngestEntity, "bodyType" | "ts"> = {
      universeId,
      source: "galaxy",
      pageUrl,
      coords: `${galaxy}:${system}:${pos}`,
      galaxy,
      system,
      position: pos,
      playerName,
      allianceTag,
      planetName,
      status: parseStatus(row),
    };

    out.push({ ...base, bodyType: "planet", ts: Date.now() });

    if (hasMoon(row)) {
      out.push({ ...base, bodyType: "moon", ts: Date.now() });
    }
  }

  return out;
}
