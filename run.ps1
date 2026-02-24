# run.ps1 — OGX Oracle start script (Windows, production defaults)
# Usage:
#   ./run.ps1
#   ./run.ps1 -Env dev -Port 8000 -BindHost 127.0.0.1 -Reload
#   ./run.ps1 -Env prod -BindHost 0.0.0.0 -Port 8000
#
# Notes:
# - In prod: reload is OFF by default.
# - Settings uses env_prefix OGX_. This script sets safe defaults.

param(
  [ValidateSet("dev","prod")]
  [string]$Env = "prod",

  [Alias("Host")]
  [string]$BindHost = "127.0.0.1",

  [int]$Port = 8000,

  [switch]$Reload
)

$ErrorActionPreference = "Stop"

Write-Host "== OGX Oracle :: run.ps1 ==" -ForegroundColor Cyan
Write-Host ("Env   : {0}" -f $Env)
Write-Host ("Bind  : {0}:{1}" -f $BindHost, $Port)
Write-Host ("Reload: {0}" -f ($Reload.IsPresent))

# ----------------------------
# Safe defaults (override via .env or your shell env)
# ----------------------------
$env:OGX_ENV = $Env
$env:OGX_BIND_HOST = $BindHost
$env:OGX_BIND_PORT = "$Port"

# Security-ish defaults (tune in .env)
# - Registration in prod typically off
if ($Env -eq "prod") {
  if (-not $env:OGX_ALLOW_REGISTRATION) { $env:OGX_ALLOW_REGISTRATION = "false" }
  if (-not $env:OGX_BOOTSTRAP_FIRST_USER_ADMIN) { $env:OGX_BOOTSTRAP_FIRST_USER_ADMIN = "true" }
  # Ingest auth: require key (or bearer JWT) by default in prod
  if (-not $env:OGX_INGEST_REQUIRE_KEY) { $env:OGX_INGEST_REQUIRE_KEY = "true" }
}

# IMPORTANT: For real production, provide OGX_SECRET_KEY via env/.env/secret manager
if (-not $env:OGX_SECRET_KEY) {
  Write-Warning "OGX_SECRET_KEY is not set. In production you MUST set a strong secret key."
}

# ----------------------------
# Run
# ----------------------------
$uvicornArgs = @(
  "app.main:app",
  "--host", $BindHost,
  "--port", "$Port"
)

if ($Reload.IsPresent) {
  $uvicornArgs += @("--reload")
}

Write-Host ""
Write-Host "Starting uvicorn..." -ForegroundColor Green
python -m uvicorn @uvicornArgs