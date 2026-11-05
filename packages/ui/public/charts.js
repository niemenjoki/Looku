import { h, replace, s } from "./dom.js";

// Line charts and sparklines as inline SVG. Values can be null (no data for
// that point); the line breaks there.

const WIDTH = 600;

export function niceMax(value) {
  if (!(value > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const m = value / power;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * power;
}

const isNumber = (v) => typeof v === "number" && Number.isFinite(v);

function xOf(i, n, width) {
  return n > 1 ? (i * width) / (n - 1) : width / 2;
}

// Path through values[start..end]; a null value lifts the pen.
function linePath(values, max, width, height, start = 0, end = values.length - 1) {
  let d = "";
  let pen = false;
  for (let i = start; i <= end; i += 1) {
    const y = values[i];
    if (!isNumber(y)) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${xOf(i, values.length, width).toFixed(1)},${(height - (max ? y / max : 0) * height).toFixed(1)}`;
    pen = true;
  }
  return d;
}

export function spark(values) {
  const width = 100;
  const height = 24;
  const max = Math.max(...values.filter(isNumber), 0) * 1.08;
  const d = linePath(values, max, width, height);
  const svg = s("svg", { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "none", "aria-hidden": "true" });
  if (d && values.every(isNumber)) {
    svg.append(s("path", { d: `${d}L${width},${height}L0,${height}Z`, class: "spark-area" }));
  }
  if (d) svg.append(s("path", { d, class: "spark-line", "vector-effect": "non-scaling-stroke" }));
  return svg;
}

// A line chart that can be read point by point with the mouse, a finger or
// the arrow keys.
//   periods: labels of the points (passed to periodLabel)
//   series: [{ label, values, cls (stroke class), legendCls, area, faint }]
//   previous: { label, values } drawn dashed behind, or null
//   partial: { first, last } marks a period that is not complete
//   extra(i): more lines for the readout of point i
export function lineChart({ periods, series, previous = null, height = 140, format, periodLabel, partial = {}, label, texts, extra = null }) {
  const n = periods.length;
  const values = [...series.flatMap((x) => x.values), ...(previous ? previous.values : [])].filter(isNumber);
  const max = niceMax(Math.max(...values, 0));

  const svg = s("svg", { viewBox: `0 0 ${WIDTH} ${height}`, preserveAspectRatio: "none", "aria-hidden": "true" });
  svg.style.height = `${height}px`;
  for (const f of [0.5, 1]) {
    svg.append(s("line", { x1: 0, x2: WIDTH, y1: height - f * height, y2: height - f * height, class: "grid-line", "vector-effect": "non-scaling-stroke" }));
  }
  svg.append(s("line", { x1: 0, x2: WIDTH, y1: height, y2: height, class: "axis", "vector-effect": "non-scaling-stroke" }));
  if (previous) {
    const d = linePath(previous.values.slice(0, n), max, WIDTH, height);
    if (d) svg.append(s("path", { d, class: "s-prev", "vector-effect": "non-scaling-stroke" }));
  }
  const first = partial.first && n > 2 ? 1 : 0;
  const last = partial.last && n > 2 ? n - 2 : n - 1;
  for (const x of series) {
    const d = linePath(x.values, max, WIDTH, height);
    if (!d) continue;
    if (x.area && x.values.every(isNumber)) {
      svg.append(s("path", { d: `${d}L${xOf(n - 1, n, WIDTH)},${height}L${xOf(0, n, WIDTH)},${height}Z`, class: "a-pv" }));
    }
    if (!x.faint && (first || last < n - 1)) {
      // The incomplete ends dashed under the solid middle.
      svg.append(s("path", { d, class: `${x.cls} part`, "vector-effect": "non-scaling-stroke" }));
      const solid = linePath(x.values, max, WIDTH, height, first, last);
      if (solid) svg.append(s("path", { d: solid, class: x.cls, "vector-effect": "non-scaling-stroke" }));
    } else {
      svg.append(s("path", { d, class: x.cls, "vector-effect": "non-scaling-stroke" }));
    }
  }

  // Readout: a vertical line, a dot per series and a box with the values.
  const cross = h("div", { class: "cross", hidden: true });
  const dots = series.map((x) => h("i", { class: `dot ${x.legendCls}`, hidden: true }));
  const tip = h("div", { class: "tip", hidden: true });
  const plot = h("div", { class: "plot", tabindex: "0", role: "group", "aria-label": `${label}. ${texts.keys}` }, svg, cross, dots, tip);
  let current = -1;
  const show = (index) => {
    if (!n) return;
    const i = Math.min(Math.max(index, 0), n - 1);
    current = i;
    const left = n > 1 ? (i / (n - 1)) * 100 : 50;
    cross.hidden = false;
    cross.style.left = `${left}%`;
    series.forEach((x, k) => {
      const v = x.values[i];
      dots[k].hidden = !isNumber(v);
      dots[k].style.left = `${left}%`;
      dots[k].style.top = `${(1 - (isNumber(v) ? v / max : 0)) * height}px`;
    });
    const incomplete = (partial.last && i === n - 1) || (partial.first && i === 0);
    replace(tip,
      h("strong", {}, periodLabel(periods[i]), incomplete ? ` (${texts.partial})` : ""),
      series.map((x) => h("div", {}, h("i", { class: x.legendCls }), `${x.label}: `, h("b", {}, isNumber(x.values[i]) ? format(x.values[i]) : "-"))),
      previous && isNumber(previous.values[i]) ? h("div", { class: "muted" }, h("i", { class: "i-prev" }), `${previous.label}: ${format(previous.values[i])}`) : null,
      extra ? extra(i) : null,
    );
    tip.hidden = false;
    tip.classList.toggle("flip", left > 55);
    tip.style.left = `${left}%`;
  };
  const hide = () => {
    current = -1;
    cross.hidden = true;
    tip.hidden = true;
    dots.forEach((dot) => { dot.hidden = true; });
  };
  const fromPointer = (event) => {
    const box = plot.getBoundingClientRect();
    show(Math.round(((event.clientX - box.left) / box.width) * (n - 1)));
  };
  plot.addEventListener("pointermove", fromPointer);
  plot.addEventListener("pointerdown", fromPointer);
  plot.addEventListener("pointerleave", (event) => { if (event.pointerType === "mouse") hide(); });
  plot.addEventListener("blur", hide);
  plot.addEventListener("keydown", (event) => {
    const moves = { ArrowRight: current < 0 ? n - 1 : current + 1, ArrowLeft: current < 0 ? n - 1 : current - 1, Home: 0, End: n - 1 };
    if (event.key in moves) show(moves[event.key]);
    else if (event.key === "Escape") hide();
    else return;
    event.preventDefault();
  });

  const ticks = [];
  const count = Math.min(5, n);
  for (let i = 0; i < count; i += 1) {
    const index = count > 1 ? Math.round((i * (n - 1)) / (count - 1)) : 0;
    const tick = h("span", { class: i === 0 && count > 1 ? "first" : i === count - 1 && count > 1 ? "last" : null }, periodLabel(periods[index]));
    tick.style.left = `${n > 1 ? (index / (n - 1)) * 100 : 50}%`;
    ticks.push(tick);
  }
  const top = h("span", { class: "yl" }, format(max));
  top.style.top = "12px";
  const mid = h("span", { class: "yl" }, format(max / 2));
  mid.style.top = `${12 + height / 2}px`;
  const chart = h("div", { class: "chart" }, top, mid, plot, h("div", { class: "xl" }, ticks));
  chart.style.paddingTop = "12px";

  // The same numbers as a table for screen readers.
  const data = h("table", { class: "sr" },
    h("caption", {}, label),
    h("thead", {}, h("tr", {}, h("th", {}, ""), series.map((x) => h("th", {}, x.label)), previous ? h("th", {}, previous.label) : null)),
    h("tbody", {}, periods.map((period, i) => h("tr", {},
      h("th", {}, periodLabel(period)),
      series.map((x) => h("td", {}, isNumber(x.values[i]) ? format(x.values[i]) : "")),
      previous ? h("td", {}, isNumber(previous.values[i]) ? format(previous.values[i]) : "") : null))));

  return [
    chart,
    h("div", { class: "legend" },
      series.map((x) => h("span", {}, h("i", { class: x.legendCls }), x.label)),
      previous ? h("span", {}, h("i", { class: "i-prev" }), previous.label) : null,
      partial.first || partial.last ? h("span", {}, h("i", { class: "i-part" }), texts.partialLegend) : null),
    data,
  ];
}
