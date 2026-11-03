---
title: Aloita tästä
description: Mitä tarvitset, mikä asennustapa sopii sinulle ja mitä ohjeissa käytetyt sanat tarkoittavat.
---

Tämä sivu auttaa sinua valitsemaan asennustavan. Jos palvelimet ovat sinulle uusia, seuraa kolmea **opasta**
järjestyksessä: [1. Kokeile Lookua omalla koneellasi](/looku/fi/tutorials/try-it/),
[2. Ensimmäinen asennus kotipalvelimelle](/looku/fi/tutorials/home-server/) ja
[3. Liitä sivustosi](/looku/fi/tutorials/connect-your-site/). Ne selittävät jokaisen vaiheen ja näyttävät, mitä
sinun pitäisi nähdä. Muut sivut ovat dokumentaatiota: lyhyempiä, ja niissä on kaikki vaihtoehdot.
[Mitä Lookulla voi tehdä?](/looku/fi/use-cases/) kertoo, mitä otat käyttöön mihinkin tarpeeseen.

Lue tämä sivu, vaikka olisit ylläpitänyt palvelimia ennenkin: Lookussa on kaksi osaa, ja niillä on eri säännöt
sille, kuka niihin saa yhteyden.

## Mitä tarvitset

- **Sivuston, jonka palvelinta hallitset** tai jonka palvelinpuolen koodia voit ainakin muuttaa: Next.js (myös
  Vercelissä), Node.js tai Express, tai staattinen sivusto, joka tarjoillaan Cloudflaren kautta. Jos voit vain liittää
  skriptin sivustonrakentajaan, Looku ei sovi.
- **Paikan, jossa Looku toimii**: oma tietokoneesi (kokeiluun), kotipalvelin tai virtuaalipalvelin (VPS). Se
  tarvitsee Dockerin tai Node.js:n version 22 tai uudemman. Looku on pieni: sen kaksi prosessia käyttävät yhteensä
  noin 100 Mt muistia, ja kaikki tiedot ovat yhdessä tietokantatiedostossa.
- **Tavan, jolla sivustosi saa yhteyden Lookuun.** Sivustosi palvelin lähettää jokaisen sivunäytön Lookulle
  internetin kautta, joten Lookun vastaanottavalla osalla on oltava julkinen HTTPS-osoite. Ohjeissa näytetään kaksi
  tapaa: Cloudflare Tunnel (kotona ei avata portteja) tai käänteinen välityspalvelin VPS:llä.
- **Noin tunnin** ensimmäiseen oikeaan asennukseen. Kokeilu omalla tietokoneella vie noin 20 minuuttia.

Sinun ei tarvitse osata Dockeria, tunneleita tai allekirjoituksia etukäteen. Jokainen ohje selittää ne siinä kohdassa,
jossa niitä tarvitaan, ja [Näin Looku toimii](/looku/fi/concepts/) selittää kokonaisuuden.

## Valitse asennustapa

| | Kokeile omalla koneella | Kotipalvelin + Cloudflare | VPS + Caddy |
|---|---|---|---|
| **Kenelle** | Lookuun tutustumiseen ennen päätöstä | jos sinulla on jo kotipalvelin tai Raspberry Pi | kaikille, joilla ei ole kotipalvelinta |
| **Kustannukset** | ei mitään | verkkotunnus (noin 10 € vuodessa); Cloudflare-tili on ilmainen | VPS (muutama euro kuukaudessa) ja verkkotunnus |
| **Vastaanotin** (ottaa sivunäytöt vastaan) | omalla koneellasi | Cloudflare Tunnelin takana | Caddyn takana, HTTPS:llä |
| **Kojelauta** (josta luet luvut) | omalla koneellasi | vain kotiverkossa (tai [Tailscalella](/looku/fi/guides/tailscale/)) | internetissä salasanan takana, rajattuna omiin verkkoihisi |
| **Oikeita kävijöitä?** | ei, vain esittelysivusto | kyllä | kyllä |
| **Opas** | [1. Kokeile Lookua omalla koneellasi](/looku/fi/tutorials/try-it/) | [2. Ensimmäinen asennus](/looku/fi/tutorials/home-server/) | |
| **Dokumentaatio** | | [Kotipalvelin + Cloudflare](/looku/fi/guides/home-server-cloudflare/) | [VPS + Caddy](/looku/fi/guides/vps-caddy/) (vaihe vaiheelta) |

Etkö ole varma? Aloita oppaasta [1. Kokeile Lookua omalla koneellasi](/looku/fi/tutorials/try-it/). Mikään, mitä teet siinä, ei
vaikuta oikeaan sivustoon.

Jos käytät jo muuta käänteistä välityspalvelinta kuin Caddya (nginx, Traefik), seuraa VPS-ohjetta ja sovella
välityspalvelimen vaihetta. Jos haluat käyttää Lookua ilman Dockeria, katso [Ilman Dockeria](/looku/fi/guides/without-docker/).

## Asennuksen jälkeen

1. **Liitä sivustosi**, jotta se lähettää sivunäytöt: [Next.js](/looku/fi/guides/connect-nextjs/) tai
   [Node.js, Express, Cloudflare tai oma toteutus](/looku/fi/guides/connect-other/).
2. **Päivitä tietosuojaselosteesi.** [Tietosuoja ja laki](/looku/fi/privacy/) sisältää mallipohjan ja kertoo, mitä
   tallennetaan.
3. Valinnaisesti: [lukuaika ja vierityssyvyys](/looku/fi/guides/consent-and-browser/) suostumuksen antaneilta
   kävijöiltä, [verkkokaupan tilaukset](/looku/fi/guides/shop-orders/) tai
   [tiedot aiemmasta analytiikkatyökalusta](/looku/fi/guides/moving-from-another/).
4. Ota käyttöön [varmuuskopiot ja päivitykset](/looku/fi/operate/backup-and-update/).

## Ohjeissa käytetyt sanat

**Vastaanotin**
: Lookun osa, joka ottaa vastaan sivunäytöt sivustoltasi (`looku ingest`, portti 8787). Siihen on saatava yhteys
  sivustosi palvelimelta, yleensä internetin kautta. Se hyväksyy vain tiedot, joissa on kelvollinen allekirjoitus, eikä
  siitä voi lukea mitään.

**Kojelauta**
: Osa, josta luet luvut (`looku serve`, portti 8788). Se vaatii salasanan. Pidä se niin yksityisenä kuin voit.

**Liitin**
: Pieni koodinpätkä, jonka lisäät sivustoosi. Jokaisella sivupyynnöllä se lähettää allekirjoitetun tietueen
  vastaanottimelle.

**Sivuston tunnus ja allekirjoitusavain**
: Kun lisäät sivuston Lookuun, se saa itse valitsemasi lyhyen tunnuksen (esimerkiksi `myblog`) ja pitkän
  satunnaisen allekirjoitusavaimen. Liitin allekirjoittaa jokaisen tietueen avaimella, joten vastaanotin tietää
  tietueen todella tulleen sivustoltasi. Pidä avain salassa kuten salasana.

**Pääte (terminaali), komentotulkki**
: Tekstiikkuna, johon kirjoitat komentoja: macOS:ssä ja Linuxissa Terminal, Windowsissa PowerShell. Katso
  [1. Kokeile Lookua omalla koneellasi](/looku/fi/tutorials/try-it/). Palvelimella avaat sen
  `ssh`-komennolla, joka toimii myös PowerShellissä.

**Docker, kontti, Compose**
: Docker ajaa ohjelman eristetyssä laatikossa (kontissa), jossa on kaikki ohjelman tarvitsema, joten sinun ei
  tarvitse asentaa Node.js:ää tai kirjastoja palvelimelle. Docker Compose käynnistää useita kontteja yhdestä
  tiedostosta (`compose.yaml`) ja yhdestä asetustiedostosta (`.env`).

**Ympäristömuuttuja**
: Nimetty asetus, joka annetaan ohjelmalle sen ulkopuolelta, esimerkiksi `LOOKU_TIMEZONE=Europe/Helsinki`. Dockeria
  käytettäessä ne ovat `.env`-tiedostossa. Katso [Asetukset](/looku/fi/reference/settings/).

**Käänteinen välityspalvelin**
: Verkkopalvelin sovellustesi edessä (Caddy, nginx). Sillä on HTTPS-varmenne, ja se välittää jokaisen pyynnön
  oikealle sovellukselle.

**Tunneli**
: Palvelimellasi toimiva ohjelma, joka avaa lähtevän yhteyden palveluun, kuten Cloudflareen. Julkiseen osoitteeseesi
  tulevat pyynnöt palaavat tätä yhteyttä pitkin, joten sinun ei tarvitse avata portteja kotireitittimeesi.

**Verkkotunnus, palvelinnimi**
: `example.com` on verkkotunnus; `looku.example.com` on sen alla oleva palvelinnimi. Vastaanotin tarvitsee oman
  palvelinnimen.
