# Dashboard screenshots

The pictures in `website/public/screens` are taken from a throwaway Looku with invented data, in Finnish and English,
light and dark: `<name>-<fi|en>-<light|dark>.png`. Pages show them with `src/components/Screen.astro`.

To take them again, in a copy of the repository on a Linux machine with Docker:

1. In `deploy/compose.yaml`, rename the project and image (for example `name: shots`, `image: shots:local`) so that
   nothing touches a real installation, copy `.env.example` to `.env`, set `LOOKU_DASHBOARD_PORT` to a free port, and
   `mkdir data`.
2. Fill the database (three months of traffic, orders and reading time; `SHOT_PASSWORD` is the dashboard password):

   ```bash
   docker compose build
   docker compose run --rm -T -e SHOT_PASSWORD=... -v "$PWD/../website/screenshots/seed.mjs:/seed.mjs:ro" --entrypoint node ingest /seed.mjs
   docker compose up -d
   ```

3. Take the pictures with Playwright in a container on the same network. In `website/screenshots`, put the password
   in a file `pw` (ignored by git); the pictures go to `out/`:

   ```bash
   docker build -t shots-pw:local -f Dockerfile.pw .
   docker run --rm --network shots_default -v "$PWD:/shots" shots-pw:local sh -c "cp /shots/shoot.mjs /pw/ && cd /pw && node shoot.mjs"
   ```

4. Copy the pictures you need from `out/` to `website/public/screens`, and remove the containers, volume and image.
