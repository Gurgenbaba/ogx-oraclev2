let lastKey = "";

export function shouldParseGalaxy(): boolean {
  const params = new URLSearchParams(location.search);
  if (params.get("page") !== "galaxy") return false;

  const key = `${params.get("galaxy")}:${params.get("system")}`;
  if (key === lastKey) return false;

  lastKey = key;
  return true;
}
