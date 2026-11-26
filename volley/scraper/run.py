"""Koondab kõigi allikate turniirid -> web/events.js (+ events.json)."""
import json, datetime, sys
import beach44, turniir

# Võistlused, kuhu harrastaja ei saa registreeruda (liigad, noored, koolid) – välja
EXCLUDE = ("meistriliiga", "esiliiga", "meistrivõistlused", "ekv ", "koolinoorte", "rahvastepall", "pallilahing")
SOURCES = [("beach44", beach44.run), ("turniir.ee", turniir.run)]


def main():
    today = datetime.date.today().isoformat()
    out, report = [], {}
    for name, fn in SOURCES:
        try:
            evs = fn()
            report[name] = len(evs)
        except Exception as e:  # üks katkine allikas ei tohi kõike ära rikkuda
            report[name] = f"VIGA: {e}"
            continue
        out += evs
    keep = []
    for e in out:
        t = (e["title"] + " ").lower()
        if any(x in t for x in EXCLUDE):
            continue
        if e["discipline"] == "rannatennis":
            continue
        if (e.get("end_date") or e["date"]) < today:
            continue
        e["kind"] = "liiga" if "liiga" in t else "turniir"
        keep.append(e)
    keep.sort(key=lambda e: (e["date"], e["start"]))
    # duplikaadid (sama kuupäev + pealkiri + koht)
    seen, uniq = set(), []
    for e in keep:
        k = (e["date"], e["title"].lower(), e["venue"])
        if k not in seen:
            seen.add(k); uniq.append(e)
    payload = {"generated": datetime.datetime.now().isoformat(timespec="minutes"), "events": uniq}
    json.dump(payload, open("../data_events.json", "w", encoding="utf8"), ensure_ascii=False, indent=1)
    open("../web/events.js", "w", encoding="utf8").write("window.EVENTS = " + json.dumps(payload, ensure_ascii=False) + ";")
    print("allikad:", report, "| sündmusi kalendris:", len(uniq))


if __name__ == "__main__":
    main()
