"""Beach44 rannahall (Kiili/Luige) – https://www.beach44.ee/turniirid

Leht on Framer'i serveripoolselt renderdatud HTML; iga turniir on <a href=bit.ly...>
blokk, milles on pealkiri, tüüp, <time datetime>, kellaaeg ja tasemed.
"""
import re
from common import fetch, strip_tags, detect_gender, detect_levels

URL = "https://www.beach44.ee/turniirid"
HALL = "Beach44 (Kiili, Harju)"


def parse(page):
    events, seen = [], set()
    for m in re.finditer(r'<a [^>]*?href="(https://bit\.ly/[^"]+)"[^>]*>(.*?)</a>', page, re.S):
        link, inner = m.group(1), m.group(2)
        dt = re.search(r'<time datetime="(\d{4}-\d{2}-\d{2})', inner)
        if not dt:
            continue
        paras = [strip_tags(p) for p in re.findall(r"<p[^>]*>(.*?)</p>", inner, re.S)]
        paras = [p for p in paras if p]
        if not paras:
            continue
        title = paras[0]
        kind = paras[1] if len(paras) > 1 else ""
        rest = " ".join(paras[2:])
        tm = re.search(r"(\d{1,2}[:.]\d{2})\s*-\s*(\d{1,2}[:.]\d{2})", rest)
        key = (link, dt.group(1))
        if key in seen:
            continue
        seen.add(key)
        low = (title + " " + kind).lower()
        if "tennis" in low:
            discipline = "rannatennis"
        elif "laager" in low:
            discipline = "laager"
        else:
            discipline = "rannavolle"
        events.append({
            "source": "beach44.ee",
            "title": f"{title} {kind}".strip(),
            "discipline": discipline,
            "date": dt.group(1),
            "start": tm.group(1).replace(".", ":") if tm else "",
            "end": tm.group(2).replace(".", ":") if tm else "",
            "venue": HALL,
            "indoor": True,
            "gender": detect_gender(title + " " + rest),
            "levels": detect_levels(rest),
            "fee": "",          # registreerimisvorm (bit.ly) pole selle keskkonna võrgust kättesaadav
            "reg_url": link,
            "reg_deadline": "",
            "info_url": URL,
            "raw": rest,
        })
    return events


def run():
    return parse(fetch(URL))


if __name__ == "__main__":
    import json
    print(json.dumps(run(), ensure_ascii=False, indent=1))
