# OGX Oracle (v2) — Galaxy Collector + Web UI

OGX Oracle ist ein privates Tracking-Tool für OGX-Galaxy-Daten (Spieler, Allianzen, Kolonien, Monde).
Die Daten werden über ein Tampermonkey Userscript direkt aus der Galaxy-Ansicht gesammelt und an den OGX-Oracle-Server gesendet.

Stack:
- FastAPI
- SQLite
- Jinja Templates
- Tampermonkey (GM_xmlhttpRequest)

---

## Features

- 🌌 Auto-Scan: Galaxy öffnen → sichtbare Slots werden automatisch gesendet
- 🔍 Spieler-Suche: alle Kolonien eines Spielers auf einen Blick
- 🏰 Allianz-Tracker: Ally → Spieler Zuordnung automatisch befüllt
- 📡 Ingame UI: Badge + Menü-Button (Rechtsklick = Setup)
- 💾 Export/Backup: Datensicherung möglich

---

## Live Deployment (Railway)

Produktions-URL:

https://ogx-oraclev2-production.up.railway.app

Port intern: 8080

---

## Collector installieren (Tampermonkey)

### 1) Tampermonkey installieren
https://www.tampermonkey.net/

### 2) Userscript hinzufügen
Tampermonkey → Dashboard → Neues Script → Inhalt von  
`ogx-oracle-collector.user.js` einfügen → Strg+S

### 3) WICHTIG: @connect korrekt setzen

Im Userscript Header MUSS stehen:

```js
// @grant        GM_xmlhttpRequest
// @connect      ogx-oraclev2-production.up.railway.app
```

Wenn @connect fehlt, blockt Tampermonkey die Requests und das Badge zeigt "Offline?".

### 4) Setup im Spiel

Im Spiel unten rechts erscheint das Badge:

◉ Oracle

Rechtsklick → Setup

Base URL eintragen:

https://ogx-oraclev2-production.up.railway.app

Optional:
- JWT setzen (preferred)
- oder API Key setzen

---

## Lokaler Start (optional)

Wenn du lokal statt Railway arbeiten willst:

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install fastapi uvicorn sqlalchemy aiosqlite pydantic pydantic-settings python-multipart jinja2
.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

Dann erreichst du die App unter:

http://127.0.0.1:8000

Und trägst im Setup ein:

http://127.0.0.1:8000

---

## API Key / Auth (Empfohlen)

Wenn öffentlich deployed, setze in Railway → Variables:

OGX_INGEST_API_KEY=dein-key-hier

Der Collector sendet dann:

x-ogx-api-key: <KEY>

Ohne Auth kann theoretisch jeder POST Requests an /ingest senden.

---

## Troubleshooting

Refused to connect … not part of the @connect list  
→ Railway Domain im Userscript Header ergänzen.

Badge fehlt  
→ Script aktiv?  
→ @match passt zu https://uni1.playogx.com/*  
→ Strg+F5

Badge zeigt 0 Rows  
→ Galaxy noch nicht vollständig geladen  
→ kurz warten oder Badge anklicken

Badge zeigt 401 oder 403  
→ Auth setzen (JWT oder API Key)

Badge zeigt Offline?  
→ Server läuft nicht oder falsche Base URL

---

## Security Hinweis

Wenn öffentlich betrieben:

- API Key Pflicht für /ingest/*
- Rate Limiting aktivieren
- Logging einschalten
- HTTPS erzwingen (Railway Standard)

---

## License

Private / internal use.
