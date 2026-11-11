---
title: Verkkokaupan tilaukset
description: Lähetä verkkokauppasi tilaukset Lookuun, niin näet myynnin, myydyimmät tuotteet, kampanjoiden tulokset ja ostopolun.
sidebar:
  order: 4
---

Verkkokauppamoduuli näyttää tilaukset, myynnin, myydyimmät tuotteet ja ostopolun (kuinka moni kävijä eteni
tuotesivulta ostoskoriin ja kassalle). Kun myös kampanjamoduuli on päällä, se näyttää, mitkä kampanjat toivat myyntiä.
Tilaukset tulevat verkkokauppasi palvelimelta maksun jälkeen.

**Tarvitset:** liitetyn sivuston (katso [Liitä Next.js-sivusto](/looku/fi/guides/connect-nextjs/)) ja
`shop`-moduulin. `site:modules` asettaa koko moduuliluettelon, joten luettele kaikki moduulit, jotka sivustolla pitää
olla. Tarkista nykyiset ensin komennolla `docker compose run --rm ingest site:list` (sarake `modules_json`).
Verkkokaupan ja kampanjoiden tuloksia varten:

```bash
docker compose run --rm ingest site:modules myblog shop,campaigns
```

Näet tekstin `Modules of myblog: perus, shop, campaigns`. `perus` on perusmoduuli,
joka näkyy kojelaudassa nimellä **Perus**; se on aina päällä.

## Lähetä tilaus

Käytä kopioimasi liittimen (`lib/looku.js`) funktiota `sendOrder` verkkokauppasi palvelinkoodissa siinä kohdassa,
jossa tilausjärjestelmäsi vahvistaa maksun, esimerkiksi reitissä, joka ottaa vastaan maksunvälittäjäsi webhook-kutsun.
Se käyttää samoja kolmea asetusta (`LOOKU_ENDPOINT`, `LOOKU_SITE_ID`, `LOOKU_SIGNING_KEY`) kuin sivunäytöt, joten
avainta ei anneta itse. Se palauttaa `true`, kun Looku hyväksyi tilauksen.

Täydellinen esimerkki Next.js:ssä: reittitiedosto `app/api/order-paid/route.js`. `@/` tarkoittaa projektin
juurikansiota; se toimii, kun projektissasi on import-alias `@/*` (`create-next-app`-komennolla tehdyissä projekteissa
on). Ilman aliasta kirjoita polku tästä tiedostosta `lib`-kansioon, tässä `../../../lib/looku.js`.

```js
import { sendOrder } from "@/lib/looku.js";

export async function POST(request) {
  // Tarkista tässä maksunvälittäjäsi ohjeen mukaan, että pyyntö todella tulee
  // siltä, ja lue tilaus pyynnöstä.
  const ok = await sendOrder({
    id: "1001",
    ts: new Date().toISOString(),
    total: 34.9,
    utm_campaign: "autumn",
    items: [{ sku: "A1", name: "Product", quantity: 2, price: 17.45 }],
  });
  return Response.json({ ok });
}
```

Oikeassa verkkokaupassa ota arvot tilauksesta yllä olevien kiinteiden arvojen sijaan.

| Kenttä | Pakollinen | Mitä |
|---|---|---|
| `id` | kyllä | tilausnumerosi |
| `ts` | kyllä | tilausaika (ISO 8601), ei tulevaisuudessa |
| `total` | kyllä | loppusumma käyttämässäsi valuutassa |
| `items` | ei | enintään 100 tuotetta. Jokaisessa on oltava `sku` ja positiivinen `quantity`, ja niissä voi olla `name` ja `price` |
| `utm_campaign` | ei | kampanja, jonka kautta asiakas tuli, jos verkkokauppasi tallentaa sen |
| `status` | ei | `"cancelled"` poistaa tilauksen. Silloin tarvitaan vain `id` |

Looku tallentaa vain nämä kentät ja hylkää kaiken muun, joten henkilötietoja, joita verkkokauppasi saattaa välittää
(nimiä, osoitteita, sähköpostiosoitteita), ei koskaan tallenneta. Tilauksia ei yhdistetä kävijöihin.

- **Lähetä sama tunnus uudelleen**, kun haluat korvata tilauksen, esimerkiksi muutoksen jälkeen.
- **Peruutus:** `await sendOrder({ id: "1001", status: "cancelled" })` poistaa tilauksen.
- Tilaukset lähetetään sivunäyttöjen tapaan vain tuotannossa. Muu ohjelmointikieli: lähetä `POST /orders` samalla
  allekirjoituksella kuin kohdassa [Oma liitin](/looku/fi/guides/connect-other/#oma-liitin).

**Tarkista:** avaa kojelaudan verkkokauppanäkymä tai kysy [luku-API:lta](/looku/fi/reference/api/)
`reports/shop/summary`. Tilaus näkyy muutamassa sekunnissa.

## Aiemmat tilaukset

Tuo tilaushistoria tiedostosta, jossa on yksi tilaus riviä kohden (JSON lines), samassa muodossa. Esimerkiksi
`orders.jsonl`:

```
{"id":"901","ts":"2026-09-14T10:20:00Z","total":25.5,"items":[{"sku":"A1","quantity":1}]}
{"id":"902","ts":"2026-09-20T15:05:00Z","total":51,"utm_campaign":"autumn"}
```

Kopioi tiedosto ensin omalta tietokoneeltasi palvelimen `deploy`-kansioon (jos Looku on muualla kuin `~/looku`,
muuta polku): `scp orders.jsonl you@192.168.1.10:looku/deploy/`. Aja sitten `deploy`-kansiossa:

```bash
docker compose run --rm -v "$PWD/orders.jsonl:/tmp/orders.jsonl:ro" ingest orders:import myblog /tmp/orders.jsonl
```

`-v`-osa tuo tiedoston näkyviin kontin sisälle. Näet tekstin `2 orders imported to myblog.` omalla määrälläsi. Jos
yksikin rivi on virheellinen, mitään ei tuoda, ja viesti kertoo rivin, esimerkiksi
`Line 2: ts must be an ISO 8601 time, not in the future.`

Tuoduilla tilauksilla ei ole käyntejä, joten niiden päivien konversio (tilauksia käyntiä kohden) näyttää liian
suurelta.

## Ostopolku

Avaa kojelaudassa **Asetukset** ja aseta verkkokaupan polut: missä tuotesivut, ostoskori ja kassa ovat (esimerkiksi
`/products/`, `/cart`, `/checkout`). Ostopolku laskee kävijät, jotka pääsivät kuhunkin vaiheeseen saman päivän
aikana. Se ei toimi, jos kävijät on kytketty sivustolta pois (`site:visitors <sivusto> off`), koska silloin
sivunäyttöjä ei voi yhdistää käynneiksi.

Samalla asetussivulla on verkkokaupan **Valuutta**, jota kojelauta käyttää myynnissä. **Konversio, 7 pv liukuva**
-kortti näyttää konversion ajan mittaan: jokaisena päivänä edellisten seitsemän päivän tilaukset jaettuna niiden
istunnoilla. Jakso alkaa aikaisintaan ensimmäisestä päivästä, jolla on istuntoja, joten ensimmäiset pisteet lasketaan
yhdestä päivästä, sitten kahdesta ja niin edelleen seitsemään asti. Ajalta ennen istuntojen keräystä tuodut tilaukset
eivät siis vääristä konversiota. Saat tilaukset ja konversion kojelaudan yläriville valitsemalla **Kauppa**-näkymän tai kohdan
**Muokkaa näkymää**.
