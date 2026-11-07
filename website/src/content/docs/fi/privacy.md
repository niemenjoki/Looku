---
title: Tietosuoja ja laki
description: Mitä Looku kerää ja tallentaa, avoin oikeudellinen kysymys suostumuksesta ja tietosuojaselosteen malli.
---

Tämä sivu kuvaa, mitä Looku tekee teknisesti, jotta voit päättää, miten käytät sitä ja mitä kerrot kävijöillesi.
**Tämä ei ole oikeudellinen neuvo.** Ajat Lookua omalla palvelimellasi, ja olet sen keräämien tietojen
rekisterinpitäjä. Se, tarvitseeko käyttösi suostumuksen ja mitä tietosuojaselosteessasi pitää lukea, riippuu maastasi,
sivustostasi ja asetuksistasi. Looku toimitetaan ilman takuuta (GNU AGPL 3.0, kohdat 15 ja 16; liittimien osalta MIT
License).

Jokaisessa kohdan "Mitä Looku tekee" väitteessä mainitaan lähdetiedosto, josta sen voi tarkistaa.

## Mitä Looku tekee

**Palvelinpuolen sivunäytöt (kaikki kävijät).** Liitin (`@looku/next`, `@looku/node` tai oma liittimesi) lähettää
vastaanottimelle yhden tietueen jokaisesta sivupyynnöstä palvelimeltasi, ei selaimesta. Tietueessa on polku,
viittaava sivu (referrer), UTM-parametrit, IP-osoite, selaimen tunniste (user agent) ja maakoodi, jos alustasi antaa
sen. (`packages/next/src/index.js`, `buildPageview`)

**Sivunäyttöjä varten selaimeen ei tallenneta mitään.** Evästettä ei aseteta eikä skriptiä käytetä. Liitin lukee vain
yhden evästeen, ja vain jos määrität sen: sivuston omistajan kieltäytymisevästeen (`optOutCookie`).
(`packages/next/src/index.js`)

**IP-osoitetta ja selaimen tunnistetta ei tallenneta.** Vastaanotin käyttää niitä vain:
- laitetyypin, selainperheen ja käyttöjärjestelmäperheen luokitteluun ja
- päivittäisen kävijätiivisteen laskemiseen: SHA-256 satunnaisesta suolasta, sivuston tunnuksesta, IP-osoitteesta ja
  selaimen tunnisteesta, lyhennettynä 16 tavuun.
(`packages/engine/src/ingest.js`, `visitor.js`)

**Päivän suola.** Jokaisella sivustolla on yksi satunnainen suola paikallista vuorokautta kohden. Kun uuden päivän
ensimmäinen sivunäyttö saapuu, edellisen päivän suola poistetaan. Myös yöajo poistaa sen (kello 3.00 jälkeen
aikavyöhykkeellä `LOOKU_TIMEZONE`). Poistetut tiedot kirjoitetaan tietokantatiedostossa yli (`secure_delete`). Sen
jälkeen tallennettua tiivistettä ei voi laskea uudelleen IP-osoitteesta, joten eri päivien tiivisteitä ei voi
yhdistää toisiinsa. Ennen kuin suola poistetaan, joku, jolla on pääsy tietokantaan, voisi laskea saman päivän
tiivisteet uudelleen. `looku backup` jättää suolan pois kopiosta. Jos poistat ajastimen käytöstä
(`LOOKU_SCHEDULER=0`), aja `looku maintain` itse joka yö.
(`packages/engine/src/visitor.js`, `maintenance.js`, `db.js`, `cli.js`)

**Kävijätiivisteen voi poistaa käytöstä** sivustokohtaisesti: `looku site:visitors <site> off`. Suola poistetaan
heti, sen jälkeen tiivistettä ei lasketa, ja jokainen sivunäyttö on erillinen. Looku raportoi silloin sivunäytöt,
viittaavat sivut ja kampanjat, mutta ei kävijöitä, käyntejä, aloitus- tai poistumissivuja, ostopolkua eikä
konversiota. Tämä koskee kojelautaa, rajapintaa ja kuukausisähköpostia. (`packages/engine/src/sites.js`,
`visitor.js`, `modules/visitors.js`, `report-email.js`)

**Maan voi poistaa käytöstä** sivustokohtaisesti: `looku site:country <site> off`. (`packages/engine/src/ingest.js`)

**Do Not Track ja Global Privacy Control otetaan oletuksena huomioon.** Sivunäyttöjä eikä selainkeräimen tietoja
kirjata pyynnöistä, joissa on `DNT: 1` tai `Sec-GPC: 1`. Myöskään tunnettuja botteja (tunnistetaan selaimen
tunnisteesta) ja esilatauksia ei kirjata. (`packages/next/src/index.js`) Vastaanotin hylkää lisäksi pyynnöt, joiden
tunnisteesta ei löydy selainta eikä käyttöjärjestelmää, sekä kävijän, joka lataa yli 20 sivua kahdessa minuutissa
tai yli 4 sivua kolmessa sekunnissa:
tämän kävijän sen päivän sivunäytöt ja tapahtumat poistetaan. (`packages/engine/src/classify.js`,
`packages/engine/src/ingest.js`)

**Säilytysaika.** Yksittäiset sivunäytöt, tapahtumat ja lukuaikatietueet säilytetään oletuksena 25 kuukautta
(`looku site:retention`). Sen jälkeen jäljelle jäävät vain sivunäyttöjen päiväsummat sivuittain ja jaotteluittain.
Tapahtumista ja lukuajasta ei säilytetä summia. Verkkokauppamoduulin tilauksia ei poisteta automaattisesti.
(`packages/engine/src/maintenance.js`)

**Selainkeräin (`@looku/browser`, valinnainen).** Se kirjaa lukuajan, vierityssyvyyden ja nimetyt tapahtumat.
Sivustosi käynnistää sen vasta, kun kävijä on antanut suostumuksensa. Suostumuksen kysyminen on sivustosi tehtävä.
Selainkeräin ei tallenna selaimeen mitään eikä lähetä tunnistetta. Sivustosi oma reitti välittää tiedot ilman
IP-osoitetta ja selaimen tunnistetta, ja Looku tallentaa vain päivän, ei kellonaikaa. Tietueissa on sivun polku ja
tapahtumissa nimi sekä ne `target`- ja `props`-arvot, jotka sivustosi lähettää. Älä laita niihin henkilötietoja.
(`packages/browser/src/index.js`, `packages/next/src/index.js` `createCollectHandler`,
`packages/engine/src/ingest.js`)

**Tilaukset (verkkokauppamoduuli, valinnainen).** Verkkokauppasi lähettää tilauksen tunnuksen, ajan, loppusumman,
tuotteet ja kampanjan. Kaikki muut kentät hylätään. Looku ei yhdistä tilauksia kävijöihin tai käynteihin.
Verkkokauppasi omassa järjestelmässä tilauksen tunnus on yhdistetty asiakkaaseen. (`packages/engine/src/orders.js`)

**Historia aiemmasta järjestelmästä (valinnainen).** `looku history:import` tuo sivunäyttöjä, tapahtumia ja
lukuaikatietueita, jotka toinen järjestelmä on kerännyt. Tiedostossa ei ole IP-osoitetta eikä selaimen tunnistetta,
joten laite, selain ja maa jäävät tyhjiksi. Kunkin sivunäytön aiemman järjestelmän päivittäinen kävijätiiviste
tiivistetään uudelleen satunnaisella avaimella, joka on olemassa vain tuonnin ajan eikä sitä koskaan tallenneta,
joten tallennettuja tiivisteitä ei voi yhdistää aiemman järjestelmän tietoihin. Tapahtumista ja lukuaikatietueista
säilyy vain päivä. Tuotuihin tietoihin sovelletaan samaa säilytysaikaa kuin Lookun omiin. Olet vastuussa siitä, että
aiempi järjestelmä on kerännyt tiedot lainmukaisesti, esimerkiksi suostumuksella silloin, kun sitä tarvittiin.
(`packages/engine/src/history.js`)

**Minne tiedot menevät.** Looku tallentaa tiedot vain palvelimellesi eikä lähetä mitään tekijöilleen. Kojelauta ei
lataa ulkoisia tiedostoja. Tiedot kulkevat muiden palvelujen kautta vain, jos otat ne itse käyttöön:
- tunneli tai välityspalvelin vastaanottimen edessä (esimerkiksi Cloudflare), joka näkee sivunäytöt IP-osoitteineen
  matkalla;
- Cloudflare Worker -liitin;
- kuukausisähköpostin sähköpostipalvelin, joka vastaanottaa kuukausiyhteenvedon.
(`packages/ui/public/index.html`, Content-Security-Policy tiedostossa `packages/engine/src/api/server.js`,
`report-email.js`)

## Avoin oikeudellinen kysymys

EU:ssa verkkoanalytiikkaan voi soveltua kaksi eri sääntöä:

1. **Sähköisen viestinnän tietosuojasäännös päätelaitteesta.** Tämä on direktiivin 2002/58/EY 5 artiklan 3 kohta,
   Suomessa sähköisen viestinnän palveluista annetun lain 917/2014 205 §. Se vaatii suostumuksen tietojen
   tallentamiseen kävijän laitteelle tai pääsyn saamiseen laitteella oleviin tietoihin, paitsi jos tämä on
   välttämätöntä kävijän pyytämän palvelun tarjoamiseksi.
2. **Yleinen tietosuoja-asetus (GDPR)** kaikkeen henkilötietojen käsittelyyn. IP-osoite on yleensä henkilötieto.

**Palvelinpuolen sivunäytöt ilman kävijätiivistettä** eivät tallenna laitteelle mitään eivätkä lähetä sille mitään
ohjetta. Tiedot ovat niitä, jotka selain lähettää joka tapauksessa sivun lataamiseksi. Euroopan tietosuojaneuvoston
(EDPB) ohjeet 2/2023 (versio 2, 7.10.2024, kohdat 32 ja 33) kuvaavat "pääsyn saamisen" (gaining access) yleisesti
niin, että osapuoli ohjeistaa laitetta lähettämään tietoja, esimerkiksi evästeillä tai JavaScriptillä. Meidän
tulkintamme on, että 5 artiklan 3 kohta ei koske tätä tilaa. Tämä on meidän tulkintamme, ei ratkaisu, ja
viranomaiset tai tuomioistuimet voivat nähdä asian toisin.

**Päivittäinen kävijätiiviste** käyttää IP-osoitetta ja selaimen tunnistetta saman kävijän tunnistamiseen yhden
päivän ajan yhdellä sivustolla. Samojen ohjeiden kohdissa 54 ja 55 todetaan, että pelkkään IP-osoitteeseen perustuva
seuranta voi kuulua 5 artiklan 3 kohdan piiriin, kun IP-osoite tulee kävijän laitteelta. Lookun tiiviste ei seuraa
sivustojen välillä eikä päivien yli, mutta se on lähellä tätä kuvausta. **Siksi on epävarmaa, tarvitseeko
päivittäinen tiiviste suostumuksen.** Jos haluat välttää tämän epävarmuuden, poista tiiviste käytöstä
(`looku site:visitors <site> off`).

**Yleistä tietosuoja-asetusta sovelletaan joka tapauksessa**, koska IP-osoitetta käsitellään hetken. Sinä päätät
käsittelyperusteen. Sivustot käyttävät koottuihin tilastoihin usein oikeutettua etua, mutta se vaatii oman
arviointisi. Tietosuojaselosteessasi pitää myös kuvata käsittely. Alla oleva malli voi auttaa.

**Lain muutokset.** EU:n ehdotettuun Digital Omnibus -kokonaisuuteen sisältyy poikkeus ensimmäisen osapuolen
yleisömittaukselle. Neuvosto sopi neuvotteluasemastaan 21.10.2026. Euroopan parlamentti ei ollut sopinut omastaan.
Kyseisenä päivänä laissa ei ollut vielä muuttunut mitään.

Lähteet (luettu 31.10.2026): [EDPB:n ohjeet 2/2023 v2](https://www.edpb.europa.eu/system/files/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf),
[Laki sähköisen viestinnän palveluista 917/2014, Finlex](https://www.finlex.fi/fi/lainsaadanto/2014/917).
Tarkista itse, onko niihin tullut muutoksia.

## Tietosuojaselosteen malli

Tämä on lähtökohta, ei valmis teksti. Muokkaa se asetuksiisi ja omaan oikeudelliseen arvioosi sopivaksi, ja poista
osat, joita et käytä.

> **Kävijätilastot.** Laskemme käyntejä tällä sivustolla Looku-ohjelmalla, joka toimii omalla palvelimellamme.
> Jokaisesta sivupyynnöstä palvelimemme kirjaa sivun, sivuston, jolta tulit, kampanjaparametrit, laitetyypin,
> selaimen ja käyttöjärjestelmän perheen [ja maan]. IP-osoitettasi ja selaimesi tunnistetta käytetään vain hetken
> näiden tietojen [ja päivittäin vaihtuvan kävijäkoodin, joka tunnistaa saman päivän toistuvat sivunäytöt]
> johtamiseen, eikä niitä tallenneta. Tähän ei käytetä evästeitä. Yksittäiset sivunäytöt säilytetään [25 kuukautta],
> minkä jälkeen jäljelle jäävät vain päiväsummat. [Sivupyynnöt kulkevat matkalla palvelimellemme palvelun [palvelu]
> kautta.] Käsittelyperuste: [käsittelyperusteesi]. [Suostumuksellasi mittaamme myös lukuajan ja vierityssyvyyden
> ilman tunnistetta.] [Tilaukset kirjataan tilastoihin ilman asiakkaan nimeä tai yhteystietoja.]

## Valintasi sivuston omistajana

| Asetus | Vaikutus |
|---|---|
| `looku site:visitors <site> off` | ei kävijätiivistettä: raporteissa ei kävijöitä eikä käyntejä |
| `looku site:country <site> off` | maata ei tallenneta |
| `looku site:retention <site> <months>` | yksittäiset sivunäytöt, tapahtumat ja lukuaika poistetaan aiemmin |
| jätä `@looku/browser` pois | ei lukuaika- eikä vieritystietoja |
| `respectDoNotTrack: false` liittimessä | ei suositella |
