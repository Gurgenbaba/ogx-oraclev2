export function getInstallId(): string {
  const key = "ogx_oracle_install_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

await registerClient(API_BASE, getInstallId());
