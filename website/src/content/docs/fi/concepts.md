---
title: Näin Looku toimii
description: Yhden sivunäytön reitti kävijän pyynnöstä kojelautaan ja syy siihen, miksi Lookussa on kaksi osaa.
---

Tällä sivulla seurataan yhtä sivunäyttöä Lookun läpi. Kun olet lukenut sen, asennusvaiheiden pitäisi olla
ymmärrettäviä: jokainen niistä rakentaa yhden tämän ketjun lenkin.

## Yhden sivunäytön reitti

```
 Kävijän selain
       │  1. pyytää sivua https://myblog.com/hello
       ▼
 Sivustosi palvelin  (Next.js, Express, Cloudflare Worker …)
       │  2. liitin kokoaa tietueen ja allekirjoittaa sen allekirjoitusavaimella
       │  3. lähettää sen internetin kautta:  POST https://looku.myblog.com/ingest
       ▼
 Tunneli tai käänteinen välityspalvelin  (Cloudflare Tunnel, Caddy)
       │  4. päästää läpi POST /ingest ja POST /orders, torjuu kaiken muun
       ▼
 Lookun vastaanotin  (portti 8787)
       │  5. tarkistaa allekirjoituksen, laskee päivittäisen kävijätiivisteen,
       │     hylkää IP-osoitteen ja selaimen tunnistemerkkijonon, kirjoittaa rivin
       ▼
 SQLite-tietokanta  (yksi tiedosto, looku.db)
       ▲
       │  6. lukee
 Lookun kojelauta ja lukurajapinta  (portti 8788)
       ▲
       │  7. avaat sen salasanalla kotiverkostasi tai sallimastasi verkosta
 Sinä
```

1. **Kävijä pyytää sivua.** Selain lähettää pyynnön sivustollesi kuten aina. Looku ei lisää sivuun mitään: ei
   skriptiä eikä evästettä.
2. **Liitin kokoaa tietueen** sivustosi palvelimella: polku (`/hello`), mistä kävijä tuli (viittaaja),
   kampanjatunnisteet (`utm_source` ja niin edelleen), kävijän IP-osoite ja selaimen tunnistemerkkijono (user agent).
   Se ohittaa botit, esilataukset, tiedostot ja kävijät, jotka lähettävät Do Not Track- tai Global Privacy Control
   -pyynnön.
3. **Liitin allekirjoittaa tietueen ja lähettää sen** vastaanottimelle. Allekirjoitus lasketaan tietueesta ja
   sivustosi allekirjoitusavaimesta. Se todistaa, että tietue tuli sivustoltasi eikä sitä ole muutettu matkalla, ja
   jokainen allekirjoitus hyväksytään vain kerran ja vain viiden minuutin ajan. Sivu ei hidastu: tietue lähetetään
   vastauksen jälkeen taustalla.
4. **Tunneli tai välityspalvelin** antaa vastaanottimelle julkisen HTTPS-osoitteen. Asetat sen päästämään läpi vain
   ne kaksi osoitetta, joita vastaanotin tarvitsee.
5. **Vastaanotin tarkistaa allekirjoituksen.** Tietue, jossa ei ole kelvollista allekirjoitusta, saa vastauksen
   `401` ja hylätään. Vastaanotin käyttää IP-osoitetta ja selaimen tunnistemerkkijonoa vain kävijätiivisteen
   laskemiseen sekä laitetyypin ja selainperheen tunnistamiseen, ja unohtaa ne sitten.
6. **Tietokanta** on yksi SQLite-tiedosto. Joka yö vastaanotin laskee päättyneiden päivien yhteenvedot ja poistaa
   säilytysaikaa vanhemmat tiedot.
7. **Kojelauta** lukee samaa tiedostoa ja näyttää luvut. Siinä on salasana, ja se on tarkoitettu yksityiseksi.

## Miksi kaksi osaa

Vastaanottimeen on saatava yhteys internetistä, koska sivustosi palvelin lähettää sille tietoja. Kojelautaan ei
pitäisi saada, koska se näyttää lukusi ja siinä on kirjautumissivu. Kun osat on erotettu, voit pitää kojelaudan
kotiverkossasi ja julkaista vain vastaanottimen. Vastaanottimesta ei voi lukea mitään: se vastaa vain "hyväksytty"
tai "ei".

Jos et tarvitse tätä jakoa, `looku all` ajaa molemmat samassa portissa. Katso
[Ilman Dockeria](/looku/fi/guides/without-docker/).

## Kävijät ilman tunnisteita

Laskeakseen kävijät Lookun on tiedettävä, mitkä sivunäytöt tulivat samalta ihmiseltä saman päivän aikana. Se laskee
tiivisteen (sormenjäljen, jota ei voi purkaa takaisin) IP-osoitteesta, selaimen tunnistemerkkijonosta, sivuston
tunnuksesta ja satunnaisesta arvosta, joka vaihtuu joka päivä (päivän suola). Kun päivä päättyy, suola poistetaan.
Sen jälkeen kukaan, et sinäkään, ei voi laskea tiivistettä uudelleen IP-osoitteesta, eikä eri päivien tiivisteitä voi
yhdistää toisiinsa.

Voit poistaa tiivisteen käytöstä sivustokohtaisesti. Looku laskee silloin sivunäytöt mutta ei kävijöitä eikä
käyntejä. Katso [Tietosuoja ja laki](/looku/fi/privacy/).

## Moduulit

Jokaisella sivustolla on perusmoduuli (`perus`): sivunäytöt, kävijät, viittaajat ja laitteet. Voit ottaa käyttöön
lisää moduuleja sivustokohtaisesti:

| Moduuli | Näyttää | Tarvitsee |
|---|---|---|
| `campaigns` | kampanjat ja niiden tulokset | linkit, joissa on `utm_`-tunnisteet |
| `content` | lukuaika ja vierityssyvyys | [selainkeräimen](/looku/fi/guides/consent-and-browser/) ja kävijän suostumuksen |
| `shop` | tilaukset, ostopolku, myydyimmät tuotteet | [verkkokaupastasi lähetetyt tilaukset](/looku/fi/guides/shop-orders/) |

## Missä mikäkin on

| Mikä | Missä |
|---|---|
| Asetukset | `.env`-tiedosto `compose.yaml`-tiedoston vieressä ([kaikki asetukset](/looku/fi/reference/settings/)) |
| Tiedot | yksi kansio, `LOOKU_DATA_DIR` (oletus `deploy/data`), jossa on `looku.db` |
| Sivustot, moduulit, avaimet, salasana | tietokannassa, muutetaan `looku`-komennoilla ([kaikki komennot](/looku/fi/reference/cli/)) |
| Allekirjoitusavain | `looku site:add` tulostaa sen kerran; sivustosi säilyttää sen omissa asetuksissaan |
