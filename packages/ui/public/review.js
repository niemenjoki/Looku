// Monthly review (view C) as sentences. Pure functions, so the texts can be
// tested without a browser and reused for the monthly report email later.

const SEARCH_ENGINES = /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|yandex|baidu|startpage|qwant|brave)\./;

export function monthRange(month) {
  const [year, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

export function shiftMonth(month, delta) {
  const [year, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, m - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

export function percentChange(current, previous) {
  if (!previous) {
    return null;
  }
  return Math.round(((current - previous) / previous) * 100);
}

function share(part, total) {
  return total ? Math.round((part / total) * 100) : 0;
}

// data: { month, today, summary, previous, points, referrers, devices, pages, entries }
// Returns { title, lead (segments), sections: [{ id, title, sentences }], foot }.
export function buildReview(L, data, { formatNumber, formatDay }) {
  const R = L.report;
  const [year, monthIndex] = data.month.split("-").map(Number);
  const monthName = R.months[monthIndex - 1];
  const prevName = R.months[(monthIndex + 10) % 12];
  const s = data.summary;
  const n = formatNumber;
  const title = (headline) => `${monthName.charAt(0).toUpperCase()}${monthName.slice(1)} ${year}: ${headline}`;

  if (!s.pageviews) {
    return { title: title(R.headline.empty), lead: [R.empty], sections: [], foot: R.foot };
  }

  const change = percentChange(s.visitors, data.previous?.visitors);
  let headline = R.headline.first;
  let compare = "";
  if (change !== null) {
    if (change >= 3) {
      headline = R.headline.more(n(change));
      compare = R.compareMore(n(change), R.inMonth(prevName));
    } else if (change <= -3) {
      headline = R.headline.less(n(-change));
      compare = R.compareLess(n(-change), R.inMonth(prevName));
    } else {
      headline = R.headline.same;
      compare = R.compareSame(R.inMonth(prevName));
    }
  }

  const lead = R.lead(
    R.inMonth(monthName),
    n(s.visitors),
    R.visitorsWord(s.visitors),
    n(s.pageviews),
    R.pagesWord(s.pageviews),
    n(s.sessions),
  );
  lead.push(compare);
  const range = monthRange(data.month);
  if (data.today && data.today >= range.from && data.today <= range.to) {
    lead.push(R.partial(formatDay(data.today)));
  }

  const visitors = [];
  const refs = data.referrers || [];
  const sessions = s.sessions;
  const search = refs.filter((row) => SEARCH_ENGINES.test(row.value)).reduce((sum, row) => sum + row.entries, 0);
  if (search) {
    visitors.push(R.search(n(share(search, sessions))));
  }
  const top = refs.filter((row) => row.value && row.entries).sort((a, b) => b.entries - a.entries)[0];
  if (top) {
    visitors.push(R.topSource(top.value, n(top.entries)));
  }
  const direct = refs.find((row) => row.value === "");
  if (direct?.entries) {
    visitors.push(R.direct(n(share(direct.entries, sessions))));
  }
  const mobile = (data.devices || []).find((row) => row.value === "mobile");
  if (mobile) {
    visitors.push(R.mobile(n(share(mobile.pageviews, s.pageviews))));
  }
  const busiest = (data.points || []).reduce((best, p) => (p.pageviews > (best?.pageviews || 0) ? p : best), null);
  if (busiest) {
    visitors.push(R.busiest(formatDay(busiest.period), n(busiest.pageviews)));
  }

  const content = [];
  if (data.pages?.[0]) {
    content.push(R.topPage(data.pages[0].value, n(data.pages[0].pageviews)));
  }
  if (data.entries?.[0]) {
    content.push(R.topEntry(data.entries[0].value));
  }

  return {
    title: title(headline),
    lead,
    sections: [
      { id: "visitors", title: R.visitorsTitle, sentences: visitors },
      { id: "content", title: R.contentTitle, sentences: content },
    ],
    foot: R.foot,
  };
}
