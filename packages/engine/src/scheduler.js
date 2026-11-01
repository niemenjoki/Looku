import { shiftMonth } from "@looku/ui/public/review.js";

import { runMaintenance } from "./maintenance.js";
import { sendMonthlyReports } from "./report-email.js";
import { dayKey } from "./time.js";

const CHECK_MS = 60 * 1000;
const MAINTENANCE_HOUR = 3;
const REPORT_HOUR = 7;

function localHour(date, timeZone) {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(date),
  );
}

// Runs the nightly maintenance after 03:00 and, when SMTP is configured, the
// monthly email after 07:00 on the 1st, or on the next days up to the 7th if
// the receiver was down (local time of `timeZone`). Each runs once: the run is
// marked in the meta table first, so a restart or a failure does not repeat it.
// `maintain` lets the receiver run the maintenance in a worker thread, so
// page views are not held up.
export function createScheduler(db, {
  timeZone = "Europe/Helsinki",
  settings = null,
  send = sendMonthlyReports,
  maintain = async (now) => runMaintenance(db, now),
  log = console,
} = {}) {
  const getMeta = db.prepare("SELECT value FROM meta WHERE key = ?");
  const setMeta = db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  let running = false;

  async function tick(now = new Date()) {
    if (running) {
      return;
    }
    running = true;
    try {
      const today = dayKey(now, timeZone);
      const hour = localHour(now, timeZone);
      if (hour >= MAINTENANCE_HOUR && getMeta.get("scheduled_maintenance_day")?.value !== today) {
        setMeta.run("scheduled_maintenance_day", today);
        await maintain(now);
        log.log(`maintenance done for ${today}`);
      }
      const month = shiftMonth(today.slice(0, 7), -1);
      if (
        settings &&
        Number(today.slice(8, 10)) <= 7 &&
        hour >= REPORT_HOUR &&
        getMeta.get("report_month")?.value !== month
      ) {
        // Marked first, so a failing mail server does not cause a retry loop.
        setMeta.run("report_month", month);
        const sent = await send(db, { month, settings });
        log.log(`monthly report ${month} sent for ${sent.join(", ") || "no sites"}`);
      }
    } catch (error) {
      log.error(`scheduled job failed: ${error.message}`);
    } finally {
      running = false;
    }
  }

  let timer = null;
  return {
    tick,
    start() {
      tick();
      timer = setInterval(tick, CHECK_MS);
      timer.unref?.();
    },
    stop() {
      clearInterval(timer);
    },
  };
}
