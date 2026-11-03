---
title: Tietoturva
description: Mitä kukin Lookun osa tuo näkyville, kenen pitäisi päästä siihen käsiksi ja mitkä suojaukset on rakennettu sisään.
sidebar:
  order: 4
---

## Kuka pääsee mihinkin

| Osa | Portti | Tavoitettavissa | Vastaa |
|---|---|---|---|
| Vastaanotin | 8787 | sivustosi palvelimelta, eli yleensä internetistä, tunnelin tai välityspalvelimen kautta | `POST /ingest`, `POST /orders`, `GET /healthz`; kaikkeen muuhun `404` tai `405` |
| Kojelauta ja lukurajapinta | 8788 | vain sinulle: kotiverkko, Tailscale tai sallittujen lista | kojelauta, `/api/v1` |

Vastaanottimesta ei voi lukea mitään. Ilman kelvollista allekirjoitusta se vastaa `401` eikä tallenna mitään. Päästä
silti tunnelin tai välityspalvelimen läpi vain `POST /ingest` ja `POST /orders`, jotta muut pyynnöt pysähtyvät ennen
palvelintasi.

## Vastaanotin

- **Allekirjoitukset.** Jokainen tietue allekirjoitetaan HMAC-SHA256:lla ja sivuston allekirjoitusavaimella.
  Allekirjoitus on voimassa viisi minuuttia ja vain kerran, joten kaapattua pyyntöä ei voi toistaa.
- **Kokorajat.** Suuret pyynnöt torjutaan vastauksella `413` ennen kuin ne luetaan.
- **Allekirjoitusavaimet** ovat sivustokohtaisia. Jos jokin vuotaa, `site:rotate-key` korvaa sen.

## Kojelauta

- **Salasana** on vähintään 10 merkkiä, ja se tallennetaan suolattuna tiivisteenä. Käytä julkisella palvelimella
  pitkää salasanaa.
- **Kirjautumisrajat.** 10 epäonnistunutta kirjautumista asiakasosoitetta kohden 15 minuutissa (IPv6-asiakkaalla /64-verkkoa
  kohden), ja yhteensä 200. Ilman asetusta `LOOKU_API_ALLOW` kuka tahansa voi kuluttaa kokonaisrajan loppuun ja
  lukita sinut ulos enintään 15 minuutiksi, joten aseta julkisella palvelimella sallittujen lista.
- **Kirjautumiseväste** on `HttpOnly` ja `SameSite=Strict`. Asetuksella `LOOKU_COOKIE_SECURE=1` se lähetetään vain
  HTTPS:n yli, ja kojelauta lisää HSTS:n.
- **Palvelinnimen tarkistus.** Kun `LOOKU_API_HOSTS` on asetettu, pyynnöt, joissa on jokin muu `Host`-otsake, saavat
  vastauksen `421 Unknown host`. Tämä estää DNS rebinding -hyökkäyksen, jossa verkkosivu huijaa selaimesi lähettämään
  pyyntöjä kotiverkkosi palvelimelle.
- **Sivustojen väliset pyynnöt**, jotka muuttavat jotain, torjutaan (`403`).
- **Content Security Policy.** Kojelauta ei lataa mitään muista osoitteista, eikä sitä voi upottaa kehykseen.
- **API-avaimet** näytetään kerran ja tallennetaan tiivisteinä. `read`-avaimilla ei voi muuttaa mitään. Avaimen voi
  rajata yhteen sivustoon.

## Asiakkaan osoite ja välityspalvelimet

Kojelauta tarvitsee asiakkaan osoitteen asetusta `LOOKU_API_ALLOW` ja kirjautumisrajoja varten. Oletuksena se
käyttää yhteyden osoitetta. Käänteisen välityspalvelimen takana tämä osoite on välityspalvelimen osoite, joten aseta
`LOOKU_TRUST_PROXY` kojelaudan edessä olevien välityspalvelinten määräksi. Looku lukee silloin
`X-Forwarded-For`-otsakkeen ja ottaa merkinnän, joka on niin monta paikkaa oikealta: jokainen välityspalvelin lisää
näkemänsä osoitteen loppuun, ja vasemmammalla olevat merkinnät on voinut kirjoittaa asiakas.

Tämä on turvallista vain, jos kojelaudan porttiin ei pääse välityspalvelinten ohi. Pidä
`LOOKU_DASHBOARD_BIND=127.0.0.1` tai jätä portti julkaisematta. Muuten kuka tahansa voisi lähettää väärennetyn
otsakkeen.

Välityspalvelinten pitää lisätä otsakkeeseen eikä korvata sitä. Caddy korvaa sen, kun pyyntö tulee osoitteesta, johon
se ei luota, ja siksi [VPS-ohjeessa](/looku/fi/guides/vps-caddy/#cloudflaren-välityspalvelimen-takana) Cloudflarea
käytetään DNS only -tilassa.

## Päivitykset

Pidä Looku, Docker ja tunneli ajan tasalla; katso [Varmuuskopiointi ja päivitys](/looku/fi/operate/backup-and-update/).
Ilmoita tietoturvaongelmista yksityisesti GitHubin kautta repositorion kohdasta **Security → Report a vulnerability**.
