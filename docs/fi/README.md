# Looku suomeksi

Looku on evästeetön kävijätilastointi, joka toimii omalla palvelimellasi. Sivunäytöt kirjataan sivuston palvelimella:
kävijän selaimeen ei tallenneta mitään, eikä sivulle tarvita skriptiä. Kojelauta ja luvut pysyvät omalla palvelimellasi,
esimerkiksi kotiverkossa.

Tarkemmat ohjeet ovat englanniksi: [asennus](../install.md), [sivuston liittäminen](../connectors.md) ja
[tietosuoja ja laki](../privacy.md).

## Pikaohje Dockerilla

```bash
cd deploy
cp .env.example .env
mkdir -p data && sudo chown 1000:1000 data
docker compose up -d --build
docker compose run --rm ingest site:add esimerkki --domain esimerkki.fi
docker compose run --rm -it dashboard admin:password
```

`site:add` näyttää allekirjoitusavaimen kerran. Sivuston liitin tarvitsee sen, vastaanottimen osoitteen ja sivuston
tunnuksen.

## Asennustavat

- **Koti:** vastaanotin tunnelin takana (esim. Cloudflare Tunnel), kojelauta vain kotiverkossa tai Tailscalessa.
- **Julkinen palvelin:** kumpikin HTTPS-välityspalvelimen (esim. Caddy) takana, `LOOKU_TRUST_PROXY=1`. Kojelaudassa
  on salasana, ja se kannattaa rajata omiin verkkoihin (`LOOKU_API_ALLOW`).
- **Yksi prosessi:** `looku all` palvelee vastaanottimen ja kojelaudan samasta portista.

## Tietosuoja lyhyesti

Tämä ei ole oikeudellista neuvontaa. Sivuston ylläpitäjä on rekisterinpitäjä ja vastaa siitä, miten Lookua käyttää ja
mitä tietosuojaselosteessa kerrotaan.

- Sivunäytöistä ei tallenneta mitään kävijän laitteelle, eikä IP-osoitetta tai selaintunnistetta tallenneta.
- Kävijämäärä lasketaan päivittäin vaihtuvalla tiivisteellä. On epävarmaa, vaatiiko tiiviste suostumuksen (EDPB:n ohje
  2/2023, kohdat 54-55). Tiivisteen saa pois sivustokohtaisesti: `looku site:visitors <sivusto> off`.
- Maatiedon saa pois: `looku site:country <sivusto> off`.
- Lukuaika ja vieritys (`@looku/browser`) kerätään vain suostumuksen antaneilta, ilman tunnistetta ja ilman
  kellonaikaa (sivuston on kysyttävä suostumus).

Perustelut, lähteet ja selostemalli: [privacy.md](../privacy.md).
