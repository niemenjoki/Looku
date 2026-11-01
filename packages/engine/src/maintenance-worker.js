import { parentPort, Worker, workerData } from "node:worker_threads";

import { openDatabase } from "./db.js";
import { runMaintenance } from "./maintenance.js";

// The nightly maintenance in a worker thread with its own connection, so the
// receiver keeps answering while rollups and retention run.
if (parentPort && workerData?.lookuMaintenance) {
  const db = openDatabase(workerData.file);
  try {
    parentPort.postMessage(runMaintenance(db, new Date(workerData.now)));
  } finally {
    db.close();
  }
}

export function runMaintenanceInWorker(file, now = new Date()) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { lookuMaintenance: true, file, now: now.toISOString() },
    });
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`maintenance worker exited with ${code}`));
    });
  });
}
