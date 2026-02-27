# OGX Oracle (v2) — Galaxy Collector + Web UI

OGX Oracle ist ein privates Tracking-Tool für OGX-Galaxy-Daten
(Spieler, Allianzen, Kolonien, Monde).

Die Daten werden über ein Tampermonkey-Userscript direkt aus der
Galaxy-Ansicht gesammelt und an den OGX-Oracle-Server gesendet.

Fokus:
Nur sichtbare Ingame-Daten.
Keine versteckten oder automatisierten Spielmechaniken.

------------------------------------------------------------

STACK

- FastAPI
- SQLite (Development)
- Jinja Templates
- Tampermonkey (GM_xmlhttpRequest)

------------------------------------------------------------

FEATURES

- Auto-Scan: Galaxy öffnen → sichtbare Slots werden gesendet
- Spieler-Suche: alle Kolonien eines Spielers
- Allianz-Tracker: automatische Zuordnung
- Ingame UI: Badge + Menü (Rechtsklick = Setup)
- Export/Backup möglich

------------------------------------------------------------

LIVE DEPLOYMENT (Railway)

Produktions-URL:
https://ogx-oraclev2-production.up.railway.app

Hinweis:
Railway nutzt intern Port 8080.
Extern wird automatisch HTTPS bereitgestellt.
Kein :8080 an die URL anhängen.

------------------------------------------------------------

COLLECTOR INSTALLIEREN (Tampermonkey)

1) Tampermonkey installieren
https://www.tampermonkey.net/

2) Userscript hinzufügen
Tampermonkey → Dashboard → Neues Script
Inhalt von ogx-oracle-collector.user.js einfügen
Speichern

3) WICHTIG: @connect korrekt setzen

Im Userscript Header muss stehen:

// @grant   GM_xmlhttpRequest
// @connect ogx-oraclev2-production.up.railway.app

Fehlt @connect, blockt Tampermonkey die Requests.

4) Setup im Spiel

Im Spiel unten rechts erscheint:
◉ Oracle

Rechtsklick → Setup

Base URL eintragen:
https://ogx-oraclev2-production.up.railway.app

Optional:
API Key oder JWT setzen

------------------------------------------------------------

LOKALER START (optional)

python -m venv .venv
.venv\Scripts\python.exe -m pip install fastapi uvicorn sqlalchemy aiosqlite pydantic pydantic-settings python-multipart jinja2
.venv\Scripts\python.exe -m uvicorn app.main:app --reload

App erreichbar unter:
http://127.0.0.1:8000

Im Collector Setup dann:
http://127.0.0.1:8000

------------------------------------------------------------

API KEY (EMPFOHLEN FÜR PROD)

In Railway → Variables setzen:

OGX_INGEST_API_KEY=DEIN_KEY

Der Collector sendet:
x-ogx-api-key: <KEY>

Ohne Auth kann theoretisch jeder POST Requests an /ingest senden.

------------------------------------------------------------

TROUBLESHOOTING

Refused to connect … not part of the @connect list
→ Railway Domain im Userscript Header ergänzen

Badge fehlt
→ Script aktiv?
→ @match korrekt?
→ Strg+F5

Badge zeigt 401 / 403
→ Auth prüfen

Badge zeigt Offline?
→ Server down oder falsche Base URL

------------------------------------------------------------

SECURITY HINWEIS

Wenn öffentlich betrieben:

- API Key Pflicht für /ingest
- Rate Limiting aktivieren
- Logging einschalten
- HTTPS erzwingen

------------------------------------------------------------

LICENSE

Private / internal use.
