---
title: Ilman Dockeria
description: Aja Lookua suoraan Node.js:llä kahtena prosessina tai yhtenä ja pidä se käynnissä systemd:llä.
sidebar:
  order: 5
---

Looku on Node.js-ohjelma, joten Dockeria ei tarvita. Tämä sivu on lukijoille, jotka jo ajavat Node.js-palveluja.
Jos tämä on sinulle uutta, Docker-ohjeet ovat helpompia.

**Tarvitset:** Node.js 22:n tai uudemman, gitin sekä käänteisen välityspalvelimen tai tunnelin vastaanottimelle
samoin kuin muissa ohjeissa.

## Kokeile ensin omassa kansiossasi

Kun kokeilet Lookua omalla koneellasi, et tarvitse pääkäyttäjän oikeuksia, palvelun käyttäjää etkä systemd:tä, ja
nvm:llä asennettu Node.js käy. Kansiossa, johon kloonasit Lookun:

```bash
npm install --omit=dev
export LOOKU_DB="$PWD/data/looku.db"
npx looku site:add myblog --domain localhost --timezone Europe/Helsinki
npx looku admin:password
npx looku all
```

`looku all` jää käyntiin tähän päätteeseen, joten aja muut komennot toisessa päätteessä (aseta `LOOKU_DB` siinäkin).
Kojelauta on osoitteessa `http://127.0.0.1:8788`, ja sivuston `LOOKU_ENDPOINT` on sama osoite, koska `looku all`
vastaanottaa sivunäytöt samassa portissa. Pysäytä Ctrl+C:llä. Oikealle sivustolle asenna alla olevan ohjeen mukaan.

## Asennus

Node.js on asennettava kaikille käyttäjille (jakelusi paketeista tai [NodeSourcesta](https://github.com/nodesource/distributions)),
ei nvm:llä. nvm asentaa sen omaan kotikansioosi, jonne palvelun käyttäjä ei pääse.

```bash
sudo useradd --system --home /var/lib/looku --create-home looku
sudo git clone https://github.com/niemenjoki/Looku.git /opt/looku
cd /opt/looku
sudo npm install --omit=dev
```

`npm install` kääntää SQLite-kirjaston. Jos se epäonnistuu virheellä `gyp ERR!`, asenna käännöstyökalut
(`sudo apt install python3 make g++`) ja aja komento uudelleen.

Jokainen komento tarvitsee tietokannan sijainnin. Ilman `LOOKU_DB`:tä komento käyttää nykyisen kansion tiedostoa
`./data/looku.db` ja luo uuden, tyhjän tietokannan, jos sitä ei ole. Komennot ajetaan `looku`-käyttäjänä, jotta
tietokanta kuuluu sille:

```bash
sudo -u looku LOOKU_DB=/var/lib/looku/looku.db node packages/engine/src/cli.js site:add myblog --domain example.com --timezone Europe/Helsinki
sudo -u looku LOOKU_DB=/var/lib/looku/looku.db node packages/engine/src/cli.js admin:password
```

## Kaksi prosessia vai yksi

| Komento | Kuuntelee | Tekee |
|---|---|---|
| `looku ingest` | `LOOKU_INGEST_HOST:LOOKU_INGEST_PORT` (oletus `127.0.0.1:8787`) | vastaanotin, yöajo, kuukausisähköposti |
| `looku serve` | `LOOKU_API_HOST:LOOKU_API_PORT` (oletus `127.0.0.1:8788`) | kojelauta ja lukurajapinta |
| `looku all` | `LOOKU_API_HOST:LOOKU_PORT` (oletus `127.0.0.1:8788`) | molemmat samassa portissa: `/ingest`, `/orders` ja `/healthz` menevät vastaanottimelle, kaikki muu kojelaudalle |

Kahdella prosessilla voit julkaista pelkän vastaanottimen. `looku all` on yksinkertaisempi, kun molemmat ovat saman
HTTPS-välityspalvelimen takana. Aseta silloin `LOOKU_API_ALLOW`, jotta kojelaudan voi avata vain omista osoitteistasi
(katso [Asetukset](/looku/fi/reference/settings/)).

## Pidä käynnissä systemd:llä

`/etc/systemd/system/looku-ingest.service`:

```ini
[Unit]
Description=Looku receiver
After=network.target

[Service]
User=looku
WorkingDirectory=/opt/looku
Environment=LOOKU_DB=/var/lib/looku/looku.db
Environment=LOOKU_TIMEZONE=Europe/Helsinki
ExecStart=/usr/bin/node packages/engine/src/cli.js ingest
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/looku-dashboard.service` on samanlainen, mutta siinä on `Description=Looku dashboard`,
`ingest`-sanan tilalla `serve` sekä tarvitsemasi kojelaudan asetukset (esimerkiksi
`Environment=LOOKU_API_HOST=192.168.1.10` ja `Environment=LOOKU_API_HOSTS=192.168.1.10:8788`). Jos `which node`
tulostaa eri polun kuin `/usr/bin/node`, käytä sitä.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now looku-ingest looku-dashboard
systemctl status looku-ingest
```

Tilan pitäisi olla `active (running)`. Lokit: `journalctl -u looku-ingest`.

Kaikki asetukset on lueteltu sivulla [Asetukset](/looku/fi/reference/settings/).
