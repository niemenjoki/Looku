---
title: Varmuuskopiointi ja päivitys
description: Varmuuskopioi Lookun tietokanta sen ollessa käynnissä, palauta se ja päivitä Looku ja Cloudflare-tunneli.
sidebar:
  order: 1
---

Kaikki Lookun tiedot ovat yhdessä tiedostossa, `looku.db`, datakansiossa (`LOOKU_DATA_DIR`, oletuksena `deploy/data`).
Asetukset ovat tiedostossa `.env`. Varmuuskopioi molemmat.

## Varmuuskopiointi

Älä kopioi tiedostoa `looku.db`, kun Looku on käynnissä: tavallinen kopio voi osua kesken kirjoituksen. Anna Lookun
tehdä kopio:

```bash
docker compose run --rm ingest backup /data/backup-$(date +%F).db
```

Näet rivin `Backup written to /data/backup-2026-11-03.db.`, jossa on tämän päivän päivämäärä. Tiedosto ilmestyy
palvelimen datakansioon (kontin sisällä `/data` on sama kuin datakansio kontin ulkopuolella). Kopioi se muualle,
esimerkiksi toiselle tietokoneelle tai varmuuskopiopalveluun. Samalla levyllä oleva varmuuskopio ei auta, jos levy
hajoaa.

Kopiosta jätetään tarkoituksella pois päivän suola, joten kopion kävijätiivisteitä ei voi laskea uudelleen
IP-osoitteesta.

**Automaattinen päivittäinen varmuuskopio.** Aja palvelimella `crontab -e` ja lisää rivi (omalla polullasi):

```
30 4 * * * cd /home/you/looku/deploy && docker compose run --rm -T ingest backup /data/backup-$(date +\%a).db >/dev/null
```

Näin säilyy yksi kopio kutakin viikonpäivää kohden (`backup-Mon.db` … `backup-Sun.db`), ja se korvaa edellisen viikon
kopion. Crontabissa `%` pitää kirjoittaa muodossa `\%`. Jos tarvitset komennolle `docker` oikeudet `sudo`, käytä sen
sijaan komentoa `sudo crontab -e`, jolloin ajo tehdään pääkäyttäjänä (root). Tarkista seuraavana päivänä, että
`ls data/` näyttää tiedoston.

**Kopioi varmuuskopiot pois palvelimelta** omalta tietokoneeltasi:

```bash
scp you@192.168.1.10:looku/deploy/data/backup-*.db .
```

Ilman Dockeria: `LOOKU_DB=/var/lib/looku/looku.db npx looku backup /backups/looku.db`.

## Palautus

```bash
cd ~/looku/deploy
docker compose stop ingest dashboard
sudo mv data/looku.db data/looku.db.broken
sudo rm -f data/looku.db-wal data/looku.db-shm
sudo cp data/backup-Mon.db data/looku.db
sudo chown 1000:1000 data/looku.db
docker compose start ingest dashboard
```

Valitse haluamasi kopio komennolla `ls -l data/`. Tiedostot kuuluvat kontin käyttäjälle (1000), ja siksi tarvitaan
`sudo`. `looku.db.broken` säilytetään, kunnes olet tarkistanut kojelaudan. Poista se sen jälkeen. Sivunäytöt, jotka
lähetetään Lookun ollessa pysäytettynä, menetetään, joten pidä katko lyhyenä. Koska kopiossa ei ole päivän suolaa,
palautuspäivän kävijät voivat tulla lasketuiksi kahdesti.

## Lookun päivitys

Lue ensin muutosloki (`CHANGELOG.md`). Sitten:

```bash
cd ~/looku
git pull
cd deploy
docker compose up -d --build
```

`git pull` lataa uuden version, ja `up -d --build` rakentaa uuden levykuvan ja korvaa kontit. Tietokannan muutokset
ajetaan itsestään, kun vastaanotin käynnistyy. Vastaanotin on poissa käytöstä muutaman sekunnin, ja sinä aikana
lähetetyt sivunäytöt menetetään. Tarkista jälkeenpäin:

```bash
docker compose ps
```

Kaikkien konttien pitää olla tilassa `Up`, ja minuutin kuluttua `ingest`- ja `dashboard`-konttien tilassa pitää lukea
`(healthy)`.

## Tunnelin päivitys

Tunnelikontti (`cloudflared`) ei päivitä itseään. Tiedostossa `.env` asetus `CLOUDFLARED_VERSION` valitsee version.
Tyhjä arvo tarkoittaa versiota `latest` ensimmäisen latauksen hetkellä. Päivitä asettamalla uudempi versio
[Cloudflaren julkaisuista](https://github.com/cloudflare/cloudflared/releases) (esimerkiksi `2026.10.7`) tai jätä arvo
tyhjäksi, ja aja:

```bash
docker compose --profile tunnel pull tunnel
docker compose --profile tunnel up -d tunnel
```

Tarkista Cloudflaren kojelaudasta (**Networking → Tunnels**), että tunneli on taas yhdistetty, ja tee `curl`-tarkistus
[kotipalvelinohjeesta](/looku/fi/guides/home-server-cloudflare/#4-päästä-läpi-vain-vastaanottimen-tarvitsemat-pyynnöt).
