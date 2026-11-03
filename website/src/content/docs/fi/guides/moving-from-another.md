---
title: Siirtyminen toisesta järjestelmästä
description: Tuo aiemman analytiikkasi keräämät sivunäytöt, tapahtumat ja lukuajat, niin historiasi jatkuu Lookussa.
sidebar:
  order: 5
---

Jos sivustollasi oli aiemmin käytössä jokin muu analytiikkajärjestelmä, voit tuoda sen historian Lookuun komennolla
`looku history:import`. Silloin kaaviosi jatkuvat ilman katkosta.

**Tarvitset:** aiemmat tiedot tiedostona, jossa on yksi JSON-objekti riviä kohden (JSON lines). Useimmat
järjestelmät osaavat viedä tiedot CSV- tai JSON-muodossa. Muunna ne alla olevaan muotoon pienellä skriptillä tai
taulukkolaskentaohjelmalla.

## Tiedostomuoto

```json
{"type":"pageview","ts":"2026-10-29T08:00:00Z","path":"/","visitor_hash":"a1b2c3","referrer_host":"google.com","referrer_path":"/","utm_source":"","utm_medium":"","utm_campaign":"","utm_content":"","utm_term":""}
{"type":"engagement","ts":"2026-10-29T08:02:00Z","path":"/","dwell_ms":12000,"max_scroll_pct":80}
{"type":"event","ts":"2026-10-29T08:03:00Z","path":"/","name":"add_to_cart","target":"","value":null,"props":{},"items":[{"sku":"A1","quantity":1}]}
```

| Kenttä | Koskee | Mitä |
|---|---|---|
| `type` | kaikkia | `pageview`, `engagement` tai `event` |
| `ts` | kaikkia | aika UTC-ajassa (ISO 8601). Looku laskee päivän sivuston aikavyöhykkeellä |
| `path` | kaikkia | sivun polku |
| `visitor_hash` | sivunäyttöjä | aiemman järjestelmän päivittäinen kävijätunniste, ei koskaan IP-osoite. Ilman sitä jokainen sivunäyttö lasketaan uudeksi kävijäksi |
| `referrer_host`, `referrer_path`, `utm_…` | sivunäyttöjä | valinnaisia |
| `dwell_ms`, `max_scroll_pct` | lukuaikarivejä (engagement) | lukuaika millisekunteina ja vierityssyvyys 0-100 |
| `name`, `target`, `value`, `props`, `items` | tapahtumia | kuten kohdassa [tapahtumat](/looku/fi/guides/consent-and-browser/#tapahtumat) |

Laite, selain ja maa jäävät tuoduilla riveillä tyhjiksi.

## Tuonti

Selvitä, milloin Looku otti vastaan ensimmäisen oman sivunäyttönsä: katso kojelaudasta tai mieti, milloin liitit
sivuston. Käytä tätä aikaa `--before`-arvona, jotta mitään ei lasketa kahdesti. Kopioi tiedosto palvelimen
`deploy`-kansioon (omalta tietokoneeltasi: `scp history.jsonl you@192.168.1.10:looku/deploy/`) ja aja siinä
kansiossa:

```bash
docker compose run --rm -v "$PWD/history.jsonl:/tmp/history.jsonl:ro" ingest history:import myblog /tmp/history.jsonl --before 2026-11-02T12:00:00Z
```

Näet tämänkaltaisen yhteenvedon:

```
3 page views, 1 events, 1 engagement rows imported to myblog; 1 skipped at or after --before, 0 older than the retention; 1 days rolled up.
```

## Säännöt

- **Kaikki tai ei mitään.** Jos yksikin rivi on virheellinen, mitään ei tuoda, ja viesti kertoo, mikä rivi on
  kyseessä. Korjaa rivi ja aja komento uudelleen.
- **Samaa tiedostoa ei voi tuoda kahdesti.** Muutettu tiedosto lasketaan uudeksi tiedostoksi, joten älä tuo
  tiedostoja, joiden sisältö menee päällekkäin.
- **Laita kunkin päivän rivit yhteen tiedostoon.** Kävijätunnisteet tiivistetään uudelleen avaimella, joka on olemassa
  vain yhden tuonnin ajan. Siksi sama kävijä samana päivänä kahdessa tiedostossa laskettaisiin kahdesti.
- Rivit, jotka ovat vanhempia kuin sivuston säilytysaika (oletus 25 kuukautta), ohitetaan.
- Valmiit päivät lasketaan yhteen heti. Kaksi viimeistä päivää lasketaan yhteen seuraavassa yöajossa.

Mitä tämä tarkoittaa tietosuojan kannalta, katso [Tietosuoja ja laki](/looku/fi/privacy/#mitä-looku-tekee).
