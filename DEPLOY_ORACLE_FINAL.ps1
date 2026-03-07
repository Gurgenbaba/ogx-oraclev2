# OGX Oracle — Final Deploy Script
# Run this from: C:\Users\gurge\Desktop\RandomStuff\Coding2\ogx-oraclev2

$dl = "$env:USERPROFILE\Downloads"
$app = "."

Write-Host "Deploying OGX Oracle final files..." -ForegroundColor Cyan

# Templates
Copy-Item "$dl\final_base.html"     "$app\app\templates\base.html"     -Force
Copy-Item "$dl\final_login.html"    "$app\app\templates\login.html"     -Force
Copy-Item "$dl\final_prestige.html" "$app\app\templates\prestige.html"  -Force

# Static JS (new + updated)
Copy-Item "$dl\final_i18n.js"       "$app\app\static\i18n.js"          -Force
Copy-Item "$dl\final_auth.js"       "$app\app\static\auth.js"          -Force
Copy-Item "$dl\final_login.js"      "$app\app\static\login.js"         -Force
Copy-Item "$dl\final_prestige.js"   "$app\app\static\prestige.js"      -Force

# Static CSS
Copy-Item "$dl\final_prestige.css"  "$app\app\static\prestige.css"     -Force
Copy-Item "$dl\final_app.css"       "$app\app\static\app.css"          -Force

# Backend
Copy-Item "$dl\final_main.py"       "$app\app\main.py"                 -Force

# Lang files
Copy-Item "$dl\final_lang_en.json"  "$app\app\lang\en.json"            -Force
Copy-Item "$dl\final_lang_de.json"  "$app\app\lang\de.json"            -Force
Copy-Item "$dl\final_lang_fr.json"  "$app\app\lang\fr.json"            -Force

Write-Host "Files copied. Committing..." -ForegroundColor Yellow

git add app/
git commit -m "fix: CSP-safe i18n, prestige page, inline token after login, auth nav"
git push origin main

Write-Host ""
Write-Host "Done! Railway will redeploy in ~60s." -ForegroundColor Green
Write-Host "After deploy:" -ForegroundColor Cyan
Write-Host "  1. Login -> Token erscheint direkt auf der Login-Seite"
Write-Host "  2. Prestige-Link erscheint in der Nav nach Login"
Write-Host "  3. /prestige zeigt dein Profil + Leaderboard"
