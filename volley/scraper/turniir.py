"""turniir.ee – võrkpalli turniirid (sport=3). Server filtreerib spordiala järgi."""
import re
from common import fetch, strip_tags, detect_gender, detect_levels

BASE = "https://turniir.ee"
LIST_URL = BASE + "/?sport=3&country=1"


def parse(page):
    events = []
    chunks = page.split('<div class="tournament-card">')[1:]
    for c in chunks:
        href = re.search(r'href="(/tournament/\d+)"', c)
        name = re.search(r'tournament-name">([^<]*)', c)
        rng = re.search(r'tournament-date__range-text">(.*?)</span></span>', c, re.S)
        if not (href and name and rng):
            continue
        dates = re.findall(r"(\d{2})\.(\d{2})\.(\d{4})", strip_tags(rng.group(1)))
        if not dates:
            continue
        iso = lambda d: f"{d[2]}-{d[1]}-{d[0]}"
        classes = re.search(r'turniir-icon--list" aria-hidden="true"></span> <span>([^<]*)', c)
        classes = strip_tags(classes.group(1)) if classes else ""
        title = strip_tags(name.group(1))
        can_register = "Register" in c
        events.append({
            "source": "turniir.ee",
            "title": title,
            "discipline": "saalivolle",
            "date": iso(dates[0]),
            "end_date": iso(dates[-1]),
            "start": "", "end": "",
            "venue": "",
            "indoor": True,
            "gender": detect_gender(classes + " " + title),
            "levels": detect_levels(classes),
            "fee": "",
            "reg_url": BASE + href.group(1) + "/registration" if can_register else "",
            "reg_deadline": "",
            "info_url": BASE + href.group(1),
            "raw": classes,
        })
    return events


def run():
    return parse(fetch(LIST_URL))


if __name__ == "__main__":
    import json
    print(json.dumps(run(), ensure_ascii=False, indent=1))
