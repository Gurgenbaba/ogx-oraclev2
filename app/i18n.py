# app/i18n.py
"""
i18n für OGX Oracle.

Unterstützte Sprachen werden AUTOMATISCH aus app/lang/*.json geladen.
Um eine neue Sprache hinzuzufügen: einfach app/lang/XX.json erstellen.
Nichts ist hardcoded.

Priorität:
  1) Cookie  ogx_lang=XX       ← User hat explizit gewählt (persistent)
  2) ?lang=XX                  ← einmaliger URL-Override
  3) Accept-Language Header    ← Browser-Einstellung
  4) DEFAULT ("en")            ← letzter Ausweg
"""
from __future__ import annotations
import json
from functools import lru_cache
from pathlib import Path
from typing import Callable

LANG_DIR    = Path(__file__).parent / "lang"
LANG_COOKIE = "ogx_lang"
DEFAULT     = "en"


def _discover_supported() -> tuple[str, ...]:
    """Alle verfügbaren Sprachen aus app/lang/*.json dynamisch laden."""
    if not LANG_DIR.exists():
        return (DEFAULT,)
    codes = sorted(p.stem for p in LANG_DIR.glob("*.json") if len(p.stem) == 2)
    return tuple(codes) if codes else (DEFAULT,)


# Einmal beim Serverstart ermitteln
SUPPORTED: tuple[str, ...] = _discover_supported()

# Module-level dicts for convenient access in templates/routes
# Populated after _flag() and get_label() are defined below,
# but we forward-declare here and fill after function definitions.
FLAG:  dict[str, str] = {}
LABEL: dict[str, str] = {}


@lru_cache(maxsize=None)
def _load(lang: str) -> dict:
    f = LANG_DIR / f"{lang}.json"
    if not f.exists():
        return {}
    return json.loads(f.read_text("utf-8"))


@lru_cache(maxsize=None)
def _flag(lang: str) -> str:
    """Unicode-Flagge aus Sprachcode (ISO 639-1 → Regional Indicator Symbols)."""
    # Standard-Mapping: Sprachcode → Länderkürzel für die Flagge
    LANG_TO_COUNTRY = {
        "en": "GB", "de": "DE", "fr": "FR", "es": "ES",
        "it": "IT", "pt": "PT", "nl": "NL", "pl": "PL",
        "ru": "RU", "tr": "TR", "ar": "SA", "zh": "CN",
        "ja": "JP", "ko": "KR",
    }
    country = LANG_TO_COUNTRY.get(lang, lang.upper())
    # Regional Indicator Symbols: A=🇦 … Z=🇿  (U+1F1E6 + offset)
    return "".join(chr(0x1F1E6 + ord(c) - ord("A")) for c in country[:2])


def get_label(lang: str) -> str:
    return lang.upper()


def _parse_accept_language(header: str) -> str | None:
    """Accept-Language Header parsen, beste unterstützte Sprache zurückgeben."""
    parts: list[tuple[float, str]] = []
    for segment in header.split(","):
        segment = segment.strip()
        if not segment:
            continue
        if ";q=" in segment:
            tag, qv = segment.split(";q=", 1)
            try:
                weight = float(qv.strip())
            except ValueError:
                weight = 0.0
        else:
            tag, weight = segment, 1.0
        code = tag.strip().split("-")[0].lower()[:2]
        parts.append((weight, code))
    parts.sort(key=lambda x: -x[0])
    for _, code in parts:
        if code in SUPPORTED:
            return code
    return None


def get_lang(request) -> str:
    """
    Sprache für diesen Request ermitteln.
    Priorität: Cookie > ?lang= > Accept-Language > DEFAULT
    """
    # 1) Persistente Nutzerwahl via Cookie
    cookie = request.cookies.get(LANG_COOKIE, "").strip().lower()[:2]
    if cookie in SUPPORTED:
        return cookie

    # 2) Expliziter URL-Override (?lang=de)
    query = request.query_params.get("lang", "").strip().lower()[:2]
    if query in SUPPORTED:
        return query

    # 3) Browser-Präferenz via Accept-Language
    accept = request.headers.get("accept-language", "")
    browser = _parse_accept_language(accept)
    if browser:
        return browser

    # 4) Fallback
    return DEFAULT


def make_translator(lang: str) -> Callable:
    """t(key, **fmt) Funktion für die gegebene Sprache zurückgeben."""
    strings  = _load(lang)
    fallback = _load(DEFAULT) if lang != DEFAULT else {}

    def t(key: str, **kwargs) -> str:
        val = strings.get(key) or fallback.get(key) or key
        if kwargs:
            try:
                return val.format(**kwargs)
            except (KeyError, ValueError):
                return val
        return val

    return t


def get_translations_js(lang: str) -> dict:
    """Vollständiges Translation-Dict für JS-Injection zurückgeben."""
    strings  = _load(lang)
    fallback = _load(DEFAULT) if lang != DEFAULT else {}
    return {**fallback, **strings}


def get_lang_switcher_data(current: str) -> list[dict]:
    """Liste der Sprachoptionen für den Switcher UI zurückgeben."""
    return [
        {
            "code":   code,
            "flag":   _flag(code),
            "label":  get_label(code),
            "active": code == current,
        }
        for code in SUPPORTED
    ]


# Populate module-level FLAG and LABEL dicts after all functions are defined
FLAG.update({code: _flag(code) for code in SUPPORTED})
LABEL.update({code: get_label(code) for code in SUPPORTED})
