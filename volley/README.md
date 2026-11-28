# Võrkpalli kalender (prototüüp)

Koondab Eesti võrkpalliturniirid (rand + saal) ühte kalendrisse.

```
cd volley/scraper && python3 run.py     # tõmbab allikad -> web/events.js
open volley/web/index.html              # kalender (filtrid: sugu, tase, ala, allikas)
```

## Allikad (praegu töötavad)
- `beach44.py` – beach44.ee/turniirid (kuupäev, kell, sugu, tasemed, registreerimislink)
- `turniir.ee` – võrkpalli turniirid (`?sport=3`); liigad/noored/koolid filtreeritakse välja

Allikate nimekiri ja staatus: `sources.json`. Uue allika lisamiseks tee `scraper/<nimi>.py`,
mis tagastab sündmuste listi (vt `beach44.py` väljad) ja lisa see `run.py` SOURCES-i.

Facebooki ei loeta (blokeerib automaatse lugemise).
