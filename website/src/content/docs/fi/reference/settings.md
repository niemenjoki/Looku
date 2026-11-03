---
title: Asetukset
description: Kaikki ympäristömuuttujat, joita Looku lukee, oletusarvoineen, ja milloin niitä kannattaa muuttaa.
sidebar:
  order: 1
---

Lookun asetukset tehdään ympäristömuuttujilla. Docker Composessa ne ovat tiedostossa `deploy/.env`. Aja muutoksen
jälkeen `deploy`-kansiossa `docker compose up -d`, jotta kontit luodaan uudelleen uusilla arvoilla. Ilman Dockeria
aseta ne komentotulkissa tai palvelutiedostossa. `looku` ilman argumentteja tulostaa listan.

## Vain Docker Compose

Nämä lukee `compose.yaml`, ei Looku itse.

| Asetus | Oletus | Mitä |
|---|---|---|
| `LOOKU_DATA_DIR` | `./data` | tietokannan kansio palvelinkoneella; varmuuskopioi se. `looku-data` pitää tietokannan sen sijaan Docker-taltiossa, kun [kokeilet Lookua](/looku/fi/guides/try-locally/) Windowsissa tai macOS:ssä |
| `LOOKU_DASHBOARD_BIND` | `127.0.0.1` | palvelinkoneen osoite, jossa kojelaudan portti julkaistaan: lähiverkon tai Tailscalen osoite pitää sen yksityisenä, `127.0.0.1` vain samalla koneella olevaa välityspalvelinta varten |
| `LOOKU_DASHBOARD_PORT` | `8788` | kojelaudan portti palvelinkoneella |
| `CLOUDFLARED_VERSION` | tyhjä = `latest` | Cloudflare-tunnelin levykuvan versio |
| `LOOKU_TUNNEL_TOKEN` | tyhjä | Cloudflare-tunnelisi tunnus (token) (profiili `tunnel`) |

Vastaanottimen porttia ei julkaista palvelinkoneelle. Saman Compose-projektin tunneli tai välityspalvelin tavoittaa
sen osoitteesta `http://ingest:8787`.

## Yleiset

| Asetus | Oletus | Mitä |
|---|---|---|
| `LOOKU_DB` | `./data/looku.db` | tietokantatiedosto (`/data/looku.db` Docker-levykuvassa) |
| `LOOKU_TIMEZONE` | `Europe/Helsinki` | yöajon ja kuukausisähköpostin aikavyöhyke |
| `LOOKU_SCHEDULER` | päällä | `0` = vastaanotin ei aja yöajoa eikä lähetä kuukausisähköpostia; aja silloin itse `looku maintain` joka yö |

## Vastaanotin

| Asetus | Oletus | Mitä |
|---|---|---|
| `LOOKU_INGEST_HOST` | `127.0.0.1` (Dockerissa `0.0.0.0`) | osoite, jota vastaanotin kuuntelee |
| `LOOKU_INGEST_PORT` | `8787` | vastaanottimen portti |

## Kojelauta ja lukurajapinta

| Asetus | Oletus | Mitä |
|---|---|---|
| `LOOKU_API_HOST` | `127.0.0.1` (Dockerissa `0.0.0.0`) | osoite, jota kojelauta kuuntelee (myös `looku all`) |
| `LOOKU_API_PORT` | `8788` | kojelaudan portti |
| `LOOKU_PORT` | `8788` | komennon `looku all` portti |
| `LOOKU_API_HOSTS` | tyhjä = mikä tahansa | hyväksytyt `Host`-otsakkeet pilkuilla erotettuina, esim. `192.168.1.10:8788`. Muut saavat vastauksen `Unknown host`. Suojaa DNS rebinding -hyökkäykseltä; aseta se. |
| `LOOKU_PUBLIC_ORIGIN` | tyhjä | julkinen osoite käänteisen välityspalvelimen takana, esim. `https://looku.example.com`; hyväksytään myös palvelinnimeksi |
| `LOOKU_COOKIE_SECURE` | `0` | `1` = kirjautumiseväste vain HTTPS:n yli, ja HSTS; aseta se, kun käytössä on HTTPS |
| `LOOKU_TRUST_PROXY` | `0` | kojelaudan edessä olevien käänteisten välityspalvelinten määrä; vain silloin `X-Forwarded-For` luetaan. Katso [Tietoturva](/looku/fi/reference/security/#asiakkaan-osoite-ja-välityspalvelimet) |
| `LOOKU_API_ALLOW` | tyhjä = kaikki | osoitteet tai verkot, joista kojelaudan saa avata, esim. `203.0.113.0/24,2001:db8::/48`; muut saavat vastauksen `Forbidden`. Terveystarkistus pysyy avoimena. |
| `LOOKU_API_CORS` | tyhjä | verkkosivustojen alkuperät (origin), jotka saavat kutsua rajapintaa selaimesta, pilkuilla erotettuina |
| `LOOKU_UI_DIR` | paketti `@looku/ui` | kojelaudan tiedostojen kansio |

## Kuukausisähköposti

Mitään ei lähetetä, kun `LOOKU_SMTP_URL` on tyhjä.

| Asetus | Oletus | Mitä |
|---|---|---|
| `LOOKU_SMTP_URL` | tyhjä | sähköpostipalvelin, esim. `smtps://user:password@smtp.example.com:465` |
| `LOOKU_REPORT_FROM` | tyhjä | lähettäjän osoite |
| `LOOKU_REPORT_TO` | tyhjä | vastaanottajat pilkuilla erotettuina |
| `LOOKU_REPORT_LANG` | `fi` | `fi` tai `en` |

Sähköposti lähetetään kuukauden 1. päivänä kello 7.00 jälkeen (`LOOKU_TIMEZONE`), tai myöhemmin ensimmäisen viikon
aikana, jos Looku oli poissa käytöstä. Esikatsele sitä komennolla `looku report:send --dry-run`.

## Sivustokohtaiset

Nämä tallennetaan tietokantaan ja niitä muutetaan komennoilla, ei ympäristömuuttujilla: moduulit, kävijät päällä tai
pois, maa ja säilytysaika. Sivuston aikavyöhyke, joka ratkaisee, milloin päivä vaihtuu sen raporteissa, asetetaan
komennolla `site:add --timezone` ja vaihdetaan komennolla `site:timezone`. Katso [Komennot](/looku/fi/reference/cli/).
