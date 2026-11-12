/** Formatting and small calendar helpers shared by the UI. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const fmtInt = (v: number | null | undefined) =>
  v == null || Number.isNaN(v) ? "–" : Math.round(v).toLocaleString("en-US");

export const fmtPct = (v: number | null | undefined, digits = 2) =>
  v == null || Number.isNaN(v) ? "–" : `${v.toFixed(digits)}%`;

export const fmtK = (v: number) => `${(v / 1000).toFixed(0)}k`;

/** "2021-10" -> "Oct 21" */
export const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;

/** "2021-10" -> "Oct 2021" */
export const monthLong = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

export const monthName = (n: number) => MONTHS[n - 1];

export function nextMonth(m: string): string {
  let y = Number(m.slice(0, 4));
  let mo = Number(m.slice(5, 7)) + 1;
  if (mo === 13) {
    y += 1;
    mo = 1;
  }
  return `${y}-${String(mo).padStart(2, "0")}`;
}
