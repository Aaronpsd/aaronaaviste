"""Ühised abifunktsioonid: HTTP, tekstipuhastus, sugu/taseme tuvastus."""
import html, re, urllib.request

UA = "Mozilla/5.0 (volley-kalender; isiklik kasutus)"


def fetch(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="ignore")


def strip_tags(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s))).strip()


def detect_gender(text):
    t = text.lower()
    if re.search(r"sega|mix", t):
        return "sega"
    has_m = re.search(r"mehed|poisid|meeste", t)
    has_n = re.search(r"naised|tüdrukud|neiud|naiste", t)
    if has_m and has_n:
        return "mehed/naised"
    if has_m:
        return "mehed"
    if has_n:
        return "naised"
    return ""


def detect_levels(text):
    """Tugevusgrupid: A, B, C, D tähtedena."""
    m = re.findall(r"\b([A-D])(?=[,\s]|ja\b|$)", text)
    return sorted(set(m))


def detect_discipline(text):
    t = text.lower()
    if "tennis" in t:
        return "rannatennis"  # välja filtreeritakse
    if "volle" in t or "võrkpall" in t:
        return "rannavolle"
    return ""
