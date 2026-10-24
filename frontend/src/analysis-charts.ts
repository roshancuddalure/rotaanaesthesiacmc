import { esc as escapeHtml } from "./ui";

export interface AnalysisBarEntry {
  label: string;
  total: number;
  weekend?: number;
  title?: string;
}

/** Presentation only: callers retain their existing analysis calculations and exports. */
export function renderAnalysisBars(entries: AnalysisBarEntry[], title: string, maxH = 120): string {
  if (!entries.length) return '<p class="empty">No chart data available for this scope.</p>';
  const stacked = entries.some(entry => entry.weekend !== undefined);
  const canPlot = (entry: AnalysisBarEntry) => Number.isFinite(entry.total) && entry.total >= 0
    && (entry.weekend === undefined || (Number.isFinite(entry.weekend) && entry.weekend >= 0 && entry.weekend <= entry.total));
  const max = Math.max(1, ...entries.filter(canPlot).map(entry => entry.total));
  const value = (number: number | undefined) => Number.isFinite(number) ? escapeHtml(String(number)) : "Unavailable";
  const height = (number: number) => Math.round(number / max * maxH);
  const bar = (number: number, kind: string) => `<div class="bar ${kind}" ${number === 0 ? 'hidden' : ''} style="height:${height(number)}px"></div>`;
  const columns = entries.map(entry => {
    const weekend = entry.weekend ?? 0;
    const bars = !canPlot(entry) ? '<span class="chart-unavailable">—</span>'
      : entry.weekend !== undefined
        ? `${bar(weekend, "weekend-bar")}${bar(entry.total - weekend, "weekday-bar")}`
        : bar(entry.total, "weekday-bar");
    return `<div class="bar-col" aria-hidden="true"><span>${value(entry.total)}</span><div class="bar-stack">${bars}</div><small>${escapeHtml(entry.label)}</small></div>`;
  }).join("");
  const rows = entries.map(entry => `<tr><th scope="row">${escapeHtml(entry.title ?? entry.label)}</th><td>${value(entry.total)}</td>${stacked ? `<td>${value(entry.weekend)}</td><td>${value(Number.isFinite(entry.total) && Number.isFinite(entry.weekend) ? entry.total - entry.weekend! : undefined)}</td>` : ""}</tr>`).join("");
  return `<figure class="analysis-chart">
    <figcaption class="visually-hidden">${escapeHtml(title)}</figcaption>
    ${stacked ? '<p class="chart-legend"><span><i class="analysis-chart-swatch is-weekend" aria-hidden="true"></i>Weekend · striped</span><span><i class="analysis-chart-swatch is-weekday" aria-hidden="true"></i>Weekday · solid</span></p>' : ""}
    <div class="bar-chart" role="region" aria-label="${escapeHtml(title)} visual chart" tabindex="0">${columns}</div>
    ${entries.some(entry => !canPlot(entry)) ? '<p class="chart-data-note">Some values cannot be plotted. Check the data table for the returned values.</p>' : ""}
    <details class="chart-data"><summary>View chart data<span class="visually-hidden">: ${escapeHtml(title)}</span></summary>
      <p class="comparison-scroll-cue">If columns extend beyond this panel, scroll horizontally. Keyboard: focus the table region and use the arrow keys.</p>
      <div class="chart-data__scroll" role="region" aria-label="${escapeHtml(title)} data" tabindex="0">
        <table><caption>${escapeHtml(title)}</caption><thead><tr><th scope="col">Period</th><th scope="col">Total</th>${stacked ? '<th scope="col">Weekend</th><th scope="col">Weekday</th>' : ""}</tr></thead><tbody>${rows}</tbody></table>
      </div>
    </details>
  </figure>`;
}
