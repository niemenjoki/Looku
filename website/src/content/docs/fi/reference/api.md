---
title: Lukurajapinta
description: Lue Lookun luvut omiin kojelautoihisi, skripteihisi tai Home Assistantiin API-avaimella.
sidebar:
  order: 3
---

Kojelauta itse käyttää vain lukurajapintaa, joten kaikki, mitä se näyttää, on myös sinun käytettävissäsi. Rajapinta
palauttaa vain summia, ei koskaan yksittäisiä sivunäyttöjä eikä kävijätiivisteitä. Täysi kuvaus on kojelautasi
osoitteessa polulla `/api/v1/openapi.json`.

## Avaimen hankkiminen

Kojelaudan asetuksissa tai palvelimella:

```bash
docker compose run --rm ingest token:create homeassistant --scope read --site myblog
```

Komento tulostaa `Key 1 created. Key (shown once):` ja avaimen, joka alkaa `lk_`. `read`-avaimella voi lukea
raportteja. `admin`-avaimella voi lisäksi muuttaa asetuksia ja avaimia. `--site` rajaa avaimen yhteen sivustoon.

Lähetä avain `Authorization`-otsakkeessa:

```bash
curl -H "Authorization: Bearer lk_…" "http://192.168.1.10:8788/api/v1/sites/myblog/summary?range=7d"
```

Rajapinta on kojelaudan osoitteessa, joten samat säännöt pätevät: `LOOKU_API_HOSTS`, `LOOKU_API_ALLOW` ja
kotipalvelimella kotiverkkosi.

## Raportit

Kaikki raporttipolut alkavat `/api/v1/sites/<site>/`. Valitse ajanjakso parametrilla `range` (`24h` on viimeiset
24 tuntia tähän hetkeen asti; `7d`, `28d`, `3m` ja `12m` päättyvät tähän päivään sivuston aikavyöhykkeellä; oletus
`28d`), parametreilla `from` ja `to` (`YYYY-MM-DD`) tai aikaikkunalla `since` ja `until` (ISO 8601 -ajat, enintään
31 päivän päässä toisistaan). Aikaikkunassa lukuaika ja ostoskoritapahtumat, jotka säilytetään vain päivän
tarkkuudella, kattavat ne kokonaiset päivät, joihin ikkuna osuu.

Polut palautetaan dekoodattuina eli luettavassa muodossa: `/opas/lämpö` eikä `/opas/l%C3%A4mp%C3%B6`.

| Polku | Palauttaa |
|---|---|
| `summary` | sivunäytöt, kävijät, käynnit, sivuja käyntiä kohden; `compare=previous` lisää edellisen jakson |
| `timeseries` | summat jaksoittain (`interval`): `hour` (enintään 31 päivää), `day`, `week` tai `month` |
| `breakdown/<dimension>` | summat jaoteltuina: `page`, `entry`, `exit`, `referrer`, `utm_source`, `utm_medium`, `utm_campaign`, `device`, `browser`, `os`, `country` tai `page_group`; `limit` (oletus 50), `sort` |
| `reports/<module>/<report>` | moduulien raportit: `perus/missing` (osoitteet, joihin sivusto vastasi "ei löydy", katso [Sivut, joita ei ole](/looku/fi/guides/connect-nextjs/#sivut-joita-ei-ole); `limit`), `shop/summary`, `shop/timeseries`, `shop/funnel`, `shop/products`, `campaigns/overview`, `content/engagement`, `content/rising`. Vain sivustolla päällä oleville moduuleille (`site:modules`); muuten vastaus on `Unknown report.` |
| `export.csv?report=…` | mikä tahansa yllä olevista CSV-muodossa |

`summary`, `timeseries` ja `breakdown` hyväksyvät myös suodattimet. `page` (yhden sivun polku), `page_group`,
`device` ja `country` rajaavat sivunäytöt, jotka täsmäävät. `referrer` (palvelimen nimi, kuten `www.google.com`,
tyhjä suorille käynneille), `utm_source` ja `utm_campaign` rajaavat kokonaiset istunnot, jotka alkoivat sillä
arvolla, joten `breakdown/page?referrer=…` listaa kaikki sivut, joita nämä kävijät katsoivat.

Jokaisessa vastauksessa on `meta` (sivusto, aikavyöhyke, ajanjakso) ja `data`. Kun `meta.sample` on `true`, luvut
tulevat vain suostumuksen antaneilta kävijöiltä (lukuaika).

## Muut polut

| Polku | |
|---|---|
| `GET /api/v1/health` | tila ja versio, avainta ei tarvita |
| `GET /api/v1/sites` | sivustot, joita tällä avaimella voi lukea, ja kunkin uusimman sivunäytön aika (`last_pageview`) |
| `GET /api/v1/modules` | moduulit ja niiden raportit |
| `GET /api/v1/me` | mitä nykyinen avain saa tehdä |
| `GET`, `PUT /api/v1/sites/<site>/config` | sivuston kojelaudan asetukset (`PUT` vaatii admin-avaimen) |
| `GET`, `POST /api/v1/tokens`, `DELETE /api/v1/tokens/<id>` | avainten hallinta (admin) |

## Home Assistant -esimerkki

Kaikkien sivustojen anturit saat [Looku-integraatiolla](/looku/fi/guides/home-assistant/)
([ha-looku](https://github.com/niemenjoki/ha-looku) GitHubissa). Ilman sitä anturi
viimeisen seitsemän päivän sivunäytöille tiedostossa `configuration.yaml`:

```yaml
rest:
  - resource: http://192.168.1.10:8788/api/v1/sites/myblog/summary?range=7d
    headers:
      Authorization: !secret looku_key
    scan_interval: 900
    sensor:
      - name: Looku page views 7 days
        value_template: "{{ value_json.data.pageviews }}"
```

ja tiedostossa `secrets.yaml`: `looku_key: "Bearer lk_…"`. `summary`-vastaus näyttää tältä (lyhennettynä),
joten muut kentät toimivat samalla tavalla (`value_json.data.visitors`):

```json
{"meta":{"site":"myblog","timezone":"Europe/Helsinki","range":{"from":"2026-10-28","to":"2026-11-03"},"sample":false},
 "data":{"pageviews":412,"visitors":198,"sessions":231,"pages_per_session":1.8}}
```
