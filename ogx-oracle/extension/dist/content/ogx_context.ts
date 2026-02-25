export function isGalaxyPage(): boolean {
  const params = new URLSearchParams(location.search);
  return params.get("page") === "galaxy";
}

export function getUniverseIdFromLocation(): string {
  // Best-effort: host like "uni1.playogx.com" -> "uni1"
  const host = location.hostname || "";
  const sub = host.split(".")[0] || "unknown";
  return sub;
}

export function getGalaxySystemFromDomOrUrl(): { galaxy: number | null; system: number | null } {
  // Try URL first (some OGX clones use &galaxy= &system=)
  const params = new URLSearchParams(location.search);
  const g = params.get("galaxy");
  const s = params.get("system");
  const galaxy = g ? parseInt(g, 10) : NaN;
  const system = s ? parseInt(s, 10) : NaN;

  if (!Number.isNaN(galaxy) && !Number.isNaN(system)) {
    return { galaxy, system };
  }

  // Fallback: try inputs if present
  const gInput = document.querySelector<HTMLInputElement>('input[name="galaxy"], input#galaxy, input.galaxy');
  const sInput = document.querySelector<HTMLInputElement>('input[name="system"], input#system, input.system');

  const galaxy2 = gInput?.value ? parseInt(gInput.value, 10) : NaN;
  const system2 = sInput?.value ? parseInt(sInput.value, 10) : NaN;

  return {
    galaxy: Number.isNaN(galaxy2) ? null : galaxy2,
    system: Number.isNaN(system2) ? null : system2,
  };
}
