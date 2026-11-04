---
title: Looku ja vaihtoehdot
description: Miten Looku eroaa Plausible Community Editionista, Umamista, GoatCounterista ja Matomosta, lähteineen.
---

Tällä sivulla verrataan, miten Looku ja neljä muuta itse ylläpidettävää analytiikkatyökalua keräävät ja tallentavat
tietoa. Se ei ole paremmuusjärjestys. Jokainen niistä sopii joillekin sivustoille paremmin kuin Looku. Kaiken voi
tarkistaa linkitetyistä lähteistä, jotka on luettu 4.11.2026. Versiot muuttuvat, joten tarkista lähteet ennen kuin
päätät.

## Kaikki osaavat kirjata sivunäytöt palvelimelta

Lookun sivunäytöt tulevat sivustosi palvelimelta, eivät selaimen skriptistä. Muutkin pystyvät siihen:

- **Plausiblessa** on Events API palvelinpuolen seurantaan. Jokaisen sivunäytön mukana lähetetään kävijän
  selaintunniste ja IP-osoite.
- **Umami** ottaa sivunäytöt vastaan osoitteessa `/api/send` ilman avainta, kunhan pyynnössä on kunnollinen
  selaintunniste.
- **GoatCounterissa** on HTTP-rajapinta palvelimen väliohjelmistolle, ja se osaa tuoda nginxin, Apachen, Caddyn ja
  muiden palvelinten lokit.
- **Matomo** osaa tuoda palvelimen lokit (Log Analytics), mutta silloin osa toiminnoista ei ole käytössä.

Ero on oletuksessa. Muissa tavallinen tapa on selaimen skripti, ja palvelinreitti on vaihtoehto, jonka rakennat
itse. Lookussa palvelinreitti on ainoa perustapa, ja liittimet Next.js:lle ja Node.js:lle tekevät sen puolestasi,
myös kävijän osoitteen ja selaintunnisteen välittämisen. Cloudflare Workersille on valmis esimerkki.

## Yhdellä silmäyksellä

| | Looku 1.0.0 | Plausible CE 3.2.1 | Umami | GoatCounter | Matomo 6 |
|---|---|---|---|---|---|
| **Tavallinen keräystapa** | Sivustosi palvelin (liitin) | Selaimen skripti | Selaimen skripti | Selaimen skripti | Selaimen skripti |
| **Palvelinreitti** | Ainoa perusreitti | Events API | `/api/send` | HTTP-rajapinta, lokituonti | Log Analytics (lokituonti) |
| **Tietokanta** | SQLite | PostgreSQL ja ClickHouse | PostgreSQL | SQLite tai PostgreSQL | MySQL 8+ tai MariaDB 10.6+ |
| **Mitä ajat** | Yksi levykuva: vastaanotin ja kojelauta (Compose-tiedostossa 2 konttia) | 3 konttia: sovellus, PostgreSQL, ClickHouse | 2 konttia: sovellus, PostgreSQL | Yksi staattinen ohjelma | PHP 8.1+ -sovellus ja sen tietokanta |
| **Lisenssi** | AGPL-3.0, liittimet MIT | AGPL-3.0, seurantaskripti MIT | MIT | EUPL 1.2 (muokattu), skripti ISC | GPL-3.0 tai uudempi |

Huomioita:

- Plausible Community Editionista puuttuu osa Plausiblen pilvipalvelun toiminnoista, kuten suppilot, verkkokaupan
  tulotavoitteet, kertakirjautuminen ja sivustorajapinta. Se julkaistaan noin kahdesti vuodessa, ja siinä on
  perustason bottisuodatus.
- Lookun voi ajaa myös yhtenä prosessina (`looku all`) ilman Dockeria. Katso [Ilman Dockeria](/looku/fi/guides/without-docker/).

## Valitse Looku, jos

- sivustosi toimii omalla palvelimellaan (Next.js, Node.js, Express) tai Cloudflaren takana,
- haluat yhden pienen palvelun ja yhden tietokantatiedoston, jonka varmuuskopiointi on helppoa,
- haluat verkkokaupan tilaukset ja sivunäytöt samaan paikkaan tai kojelaudan suomeksi.

## Valitse jokin muu, jos

- voit vain liittää skriptin sivuillesi (valmis sivustonrakentaja, pelkkä staattinen sivupalvelu): kaikki neljä
  muuta toimivat skriptillä,
- tarvitset useita käyttäjiä tai tiimejä omine kirjautumisineen: Lookussa on yksi ylläpitäjän salasana ja
  rajapinta-avaimet,
- tarvitset lämpökarttoja tai istuntotallenteita: Lookussa ei ole kumpaakaan,
- ajat jo PostgreSQL:ää tai ClickHousea ja haluat käyttää niitä.

## Lähteet

Luettu 4.11.2026.

- Plausible: [github.com/plausible/analytics](https://github.com/plausible/analytics) (lisenssi, tietokannat,
  Community Edition), [community-edition compose.yml](https://github.com/plausible/community-edition/blob/master/compose.yml)
  (kontit, v3.2.1), [Events API](https://plausible.io/docs/events-api)
- Umami: [github.com/umami-software/umami](https://github.com/umami-software/umami) (lisenssi, PostgreSQL),
  [docker-compose.yml](https://github.com/umami-software/umami/blob/master/docker-compose.yml),
  [Sending stats](https://docs.umami.is/docs/api/sending-stats)
- GoatCounter: [github.com/arp242/goatcounter](https://github.com/arp242/goatcounter) (tietokannat, keräystavat,
  ohjelmat), [LICENSE](https://github.com/arp242/goatcounter/blob/master/LICENSE)
- Matomo: [vaatimukset](https://matomo.org/faq/on-premise/matomo-requirements/),
  [Log Analytics](https://matomo.org/log-analytics/), [github.com/matomo-org/matomo](https://github.com/matomo-org/matomo)
  (lisenssi)

Löysitkö virheen? [Avaa issue](https://github.com/niemenjoki/Looku/issues).
