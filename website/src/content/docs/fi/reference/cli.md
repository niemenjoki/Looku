---
title: Komennot
description: Kaikki looku-komennot, mitä ne tulostavat ja miten ne ajetaan Dockerilla tai ilman.
sidebar:
  order: 2
---

## Komennon ajaminen

| Asennus | Muoto | Missä |
|---|---|---|
| Docker Compose | `docker compose run --rm ingest <command>` | palvelimella, `deploy`-kansiossa |
| Docker Compose, komento joka kysyy jotain | `docker compose run --rm -it ingest <command>` | sama |
| Ilman Dockeria | `npx looku <command>`, kun `LOOKU_DB` on asetettu | Looku-kansiossa |

`run --rm ingest` käynnistää väliaikaisen kontin samasta levykuvasta ja samalla datakansiolla, ajaa komennon ja
poistaa kontin. Käynnissä oleviin vastaanottimeen ja kojelautaan ei kosketa. Käytä `ingest`-konttia, älä
`dashboard`-konttia: Compose voi käynnistää vastaanottimen uudelleen ennen `dashboard`-komentoa, koska kojelauta
riippuu siitä.

Palvelinkoneen tiedosto ei näy kontin sisällä. Jos haluat antaa tiedoston komennolle, liitä se konttiin:
`docker compose run --rm -v "$PWD/file.jsonl:/tmp/file.jsonl:ro" ingest orders:import myblog /tmp/file.jsonl`.

## Sivustot

| Komento | Tekee | Tulostaa |
|---|---|---|
| `site:add <id> --domain <domain> [--name <name>] [--timezone <tz>]` | lisää sivuston; tunnus on itse valitsemasi lyhyt nimi, verkkotunnus ilman `https://`-alkua, aikavyöhykkeen oletus `Europe/Helsinki` | `Site <id> added. Signing key (shown once):` ja avaimen |
| `site:list` | listaa sivustot ja niiden asetukset | taulukon |
| `site:rotate-key <id>` | tekee uuden allekirjoitusavaimen; vanha lakkaa toimimasta heti | uuden avaimen |
| `site:modules <id> <module,...>` | asettaa sivuston moduulit: `perus` (aina päällä), `campaigns`, `content`, `shop`. Luettele kaikki, jotka haluat. | `Modules of <id>: perus, …` |
| `site:visitors <id> daily-hash\|off` | kävijät päivittäisellä tiivisteellä (oletus) tai ei lainkaan | `Visitors for <id>: off. Applies to new page views.` |
| `site:country <id> on\|off` | tallennetaanko kävijän maa (oletus päällä) | `Country for <id>: off.` |
| `site:retention <id> <months>` | kuinka kauan yksittäiset sivunäytöt säilytetään (oletus 25), minkä jälkeen jäljellä ovat vain päiväsummat | `Retention for <id>: 13 months. Applies from the next nightly job.` |
| `site:timezone <id> <tz>` | vaihtaa sivuston aikavyöhykkeen, esimerkiksi `Europe/Helsinki`. Uudet sivunäytöt saavat päivänsä uuden aikavyöhykkeen mukaan; jo tallennetut päivät säilyttävät päivämääränsä | `Time zone for <id>: Europe/Helsinki. Applies to new page views; days already recorded keep their dates.` |

## Kojelaudan käyttöoikeudet

| Komento | Tekee |
|---|---|
| `admin:password` | asettaa kojelaudan salasanan (vähintään 10 merkkiä). Se kysytään kerran, eikä kirjoittaessa näy mitään. Olemassa olevat kirjautumiset pysyvät voimassa, kunnes kojelauta käynnistyy uudelleen. |
| `token:create <name> [--scope read\|admin] [--site <id>]` | luo API-avaimen [lukurajapintaa](/looku/fi/reference/api/) varten, näytetään kerran; `--site` rajaa sen yhteen sivustoon |
| `token:list` | listaa avaimet (ei koskaan itse avaimia) |
| `token:revoke <id>` | mitätöi avaimen sen numeron perusteella, joka näkyy `token:list`-listassa |

## Data

| Komento | Tekee |
|---|---|
| `backup <file>` | tietokannan eheä kopio Lookun ollessa käynnissä, ilman päivän suolaa; katso [Varmuuskopiointi](/looku/fi/operate/backup-and-update/) |
| `orders:import <id> <file>` | tuo tilaukset, yksi JSON-objekti riviä kohden; kaikki tai ei mitään |
| `history:import <id> <file> [--before <time>]` | tuo sivunäytöt, tapahtumat ja lukuajan aiemmasta järjestelmästä; katso [Siirtyminen toisesta järjestelmästä](/looku/fi/guides/moving-from-another/) |
| `maintain` | ajaa yöajon heti: poistaa vanhat suolat, laskee valmiiden päivien summat ja soveltaa säilytysaikaa. Tulostaa yhteenvedon sivustoittain. |
| `report:send [--month YYYY-MM] [--site <id>] [--dry-run]` | lähettää kuukausisähköpostin (oletus: edellinen kuukausi); `--dry-run` tulostaa sen lähettämisen sijaan |

## Prosessit

Nämä käynnistävät Lookun ja jäävät käyntiin. Docker Composessa ne käynnistää `compose.yaml`. Sinun ei tarvitse ajaa
niitä itse.

| Komento | Käynnistää |
|---|---|
| `ingest` | vastaanottimen, yöajon ja kuukausisähköpostin |
| `serve` | kojelaudan ja lukurajapinnan |
| `all` | molemmat yhdessä prosessissa yhdessä portissa |
