---
title: Verkkokaupan tilaukset
description: Lähetä verkkokauppasi tilaukset Lookuun, niin näet myynnin, myydyimmät tuotteet, kampanjoiden tulokset ja ostopolun.
sidebar:
  order: 4
---

Verkkokauppamoduuli näyttää tilaukset, myynnin, myydyimmät tuotteet ja sen, mitkä kampanjat toivat myyntiä, sekä
ostopolun (kuinka moni kävijä eteni tuotesivulta ostoskoriin ja kassalle). Tilaukset tulevat verkkokauppasi
palvelimelta maksun jälkeen.

**Tarvitset:** liitetyn sivuston ja `shop`-moduulin:

```bash
docker compose run --rm ingest site:modules myblog shop
```

(Luettele kaikki moduulit, jotka sivustolla pitää olla, esimerkiksi `content,shop`.)

## Lähetä tilaus

Next.js- tai Node.js-verkkokaupassa käytä kopioimasi liittimen (`lib/looku.js`) funktiota `sendOrder` siinä
kohdassa, jossa tilausjärjestelmäsi vahvistaa maksun. Muuta import-polku sen mukaan, missä tiedosto on, kuten muissa
ohjeissa:

```js
import { sendOrder } from "./lib/looku.js";

await sendOrder({
  id: "1001",
  ts: new Date().toISOString(),
  total: 34.9,
  utm_campaign: "autumn",
  items: [{ sku: "A1", name: "Product", quantity: 2, price: 17.45 }],
});
```

| Kenttä | Pakollinen | Mitä |
|---|---|---|
| `id` | kyllä | tilausnumerosi |
| `ts` | kyllä | tilausaika (ISO 8601) |
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

## Aiemmat tilaukset

Tuo tilaushistoria tiedostosta, jossa on yksi tilaus riviä kohden (JSON lines), samassa muodossa:

```bash
docker compose run --rm -v "$PWD/orders.jsonl:/tmp/orders.jsonl:ro" ingest orders:import myblog /tmp/orders.jsonl
```

Kopioi tiedosto ensin omalta tietokoneeltasi palvelimen `deploy`-kansioon:
`scp orders.jsonl you@192.168.1.10:looku/deploy/`. `-v`-osa tuo tiedoston näkyviin kontin sisälle. Näet tekstin
`120 orders imported to myblog.` omalla määrälläsi. Jos yksikin rivi on virheellinen, mitään ei tuoda, ja viesti
kertoo, mikä rivi on kyseessä.

## Ostopolku

Avaa kojelaudassa **Asetukset** ja aseta verkkokaupan polut: missä tuotesivut, ostoskori ja kassa ovat (esimerkiksi
`/products/`, `/cart`, `/checkout`). Ostopolku laskee kävijät, jotka pääsivät kuhunkin vaiheeseen saman päivän
aikana. Se ei toimi, jos kävijät on kytketty sivustolta pois (`site:visitors <sivusto> off`), koska silloin
sivunäyttöjä ei voi yhdistää käynneiksi.
