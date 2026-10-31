#!/usr/bin/env node
import { openDatabase } from "./db.js";
import { runMaintenance } from "./maintenance.js";
import { createIngestServer } from "./server.js";
import { addSite, listSites, rotateSigningKey } from "./sites.js";

const USAGE = `Usage: looku <command>

  site:add <site-id> --domain <domain> [--name <name>] [--timezone <tz>]
  site:list
  site:rotate-key <site-id>
  ingest                 Start the receiver (POST /ingest)
  maintain               Nightly job: salts, rollups, retention

Environment:
  LOOKU_DB               Database file (default ./data/looku.db)
  LOOKU_INGEST_HOST      Receiver address (default 127.0.0.1)
  LOOKU_INGEST_PORT      Receiver port (default 8787)
`;

function parseOptions(args) {
  const options = {};
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i].startsWith("--")) {
      options[args[i].slice(2)] = args[i + 1];
      i += 1;
    } else {
      positional.push(args[i]);
    }
  }
  return { options, positional };
}

function main(argv) {
  const [command, ...rest] = argv;
  const { options, positional } = parseOptions(rest);
  const dbFile = process.env.LOOKU_DB || "./data/looku.db";

  switch (command) {
    case "site:add": {
      const db = openDatabase(dbFile);
      const { siteId, signingKey } = addSite(db, {
        siteId: positional[0],
        domain: options.domain,
        name: options.name,
        timezone: options.timezone,
      });
      console.log(`Site ${siteId} added. Signing key (shown once):\n${signingKey}`);
      return;
    }
    case "site:list": {
      const db = openDatabase(dbFile);
      console.table(listSites(db));
      return;
    }
    case "site:rotate-key": {
      const db = openDatabase(dbFile);
      console.log(rotateSigningKey(db, positional[0]));
      return;
    }
    case "ingest": {
      const db = openDatabase(dbFile);
      const host = process.env.LOOKU_INGEST_HOST || "127.0.0.1";
      const port = Number(process.env.LOOKU_INGEST_PORT) || 8787;
      const server = createIngestServer(db);
      server.listen(port, host, () => {
        console.log(`Looku receiver listening on ${host}:${port}`);
      });
      const stop = () => server.close(() => db.close());
      process.on("SIGTERM", stop);
      process.on("SIGINT", stop);
      return;
    }
    case "maintain": {
      const db = openDatabase(dbFile);
      console.log(JSON.stringify(runMaintenance(db), null, 2));
      db.close();
      return;
    }
    default:
      console.log(USAGE);
      process.exitCode = command ? 1 : 0;
  }
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
