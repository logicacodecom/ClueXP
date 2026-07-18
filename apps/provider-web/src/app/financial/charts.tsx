"use client";

import Link from "next/link";
import type { ReactNode } from "react";

/** Shared bar-chart building blocks for the Financial Overview dashboard.
 *
 * No charting dependency: everything here is plain SVG/DOM, sized with
 * relative units so it reflows from mobile to desktop. Every value rendered
 * visually is also present as plain, real text -- row labels/amounts are
 * ordinary DOM text (not chart-only), so a screen reader gets the same
 * numbers a sighted user does without anything extra.
 *
 * Accessibility note: `role="img"` is deliberately NOT applied to containers
 * that hold real text or links (HorizontalBarList/StackedHorizontalBar rows)
 * -- that role flattens descendants in most assistive tech, which would hide
 * the very labels, amounts, and drill-down links it's supposed to describe.
 * Those use `role="list"`/`"listitem"` with a real `aria-label` instead, and
 * their decorative fill bars are `aria-hidden`. MonthlyBars' bar cluster has
 * no interactive descendants, so it correctly takes `role="img"` +
 * `aria-label`, with a real (not just visually-hidden) data table alongside
 * it, outside that img scope, as the full text equivalent.
 *
 * No transitions/animation is used, so there's nothing for a reduced-motion
 * preference to need to defeat. */

const SERIES_COLOR: Record<string, string> = {
  primary: "bg-primary", info: "bg-info", success: "bg-success",
  warn: "bg-warn", danger: "bg-destructive", muted: "bg-muted-foreground/40",
};

// Matching text-color tokens, used with border-current so a negative bar's
// dashed border reads as the same series color as its fill, not the ambient
// foreground color.
const SERIES_TEXT_COLOR: Record<string, string> = {
  primary: "text-primary", info: "text-info", success: "text-success",
  warn: "text-warn", danger: "text-destructive", muted: "text-muted-foreground",
};

export interface BarRow {
  key: string;
  label: ReactNode;
  value: number;
  formattedValue: string;
  secondaryText?: string;
  href?: string;
  color?: keyof typeof SERIES_COLOR;
}

/** One bar per row, scaled to the largest value in the set. Use for "top N by
 * amount" lists (job types, payment methods, top balances). */
export function HorizontalBarList({
  rows, ariaLabel, emptyText = "No data for this period.",
}: {
  rows: BarRow[];
  ariaLabel: string;
  emptyText?: string;
}) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <div aria-label={ariaLabel} className="space-y-3" role="list">
      {rows.map((row) => {
        const pct = Math.max(2, Math.round((Math.abs(row.value) / max) * 100));
        const content = (
          <>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-medium">{row.label}</span>
              <span className="shrink-0 tabular-nums">{row.formattedValue}</span>
            </div>
            <div aria-hidden className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted/40">
              <div className={`h-full rounded-full ${SERIES_COLOR[row.color ?? "primary"]}`} style={{ width: `${pct}%` }} />
            </div>
            {row.secondaryText ? <div className="mt-1 text-xs text-muted-foreground">{row.secondaryText}</div> : null}
          </>
        );
        return row.href ? (
          <Link className="block rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" href={row.href} key={row.key} role="listitem">
            {content}
          </Link>
        ) : (
          <div className="block" key={row.key} role="listitem">
            {content}
          </div>
        );
      })}
    </div>
  );
}

export interface StackedSegment {
  name: string;
  value: number;
  formattedValue: string;
  color: keyof typeof SERIES_COLOR;
}

export interface StackedRow {
  key: string;
  label: ReactNode;
  segments: StackedSegment[];
  href?: string;
  /** Extra context lines below the segment legend -- e.g. directional owed-to/
   * owed-by/pending statements. Real text, not color-only. */
  footerText?: ReactNode;
}

/** One row per entity (e.g. technician), each split into colored segments by
 * proportion. A text legend beneath each row spells out every segment's name
 * and amount, so the split is never color-only. */
export function StackedHorizontalBar({
  rows, ariaLabel, emptyText = "No data for this period.",
}: {
  rows: StackedRow[];
  ariaLabel: string;
  emptyText?: string;
}) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <div aria-label={ariaLabel} className="space-y-4" role="list">
      {rows.map((row) => {
        const total = Math.max(1, row.segments.reduce((sum, s) => sum + Math.abs(s.value), 0));
        const content = (
          <>
            <div className="text-sm font-medium">{row.label}</div>
            <div aria-hidden className="mt-1 flex h-2.5 w-full overflow-hidden rounded-full bg-muted/40">
              {row.segments.filter((s) => s.value > 0).map((segment) => (
                <div
                  className={SERIES_COLOR[segment.color]}
                  key={segment.name}
                  style={{ width: `${Math.max(1, (segment.value / total) * 100)}%` }}
                />
              ))}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              {row.segments.map((segment) => (
                <span className="inline-flex items-center gap-1" key={segment.name}>
                  <span aria-hidden className={`inline-block size-2 rounded-full ${SERIES_COLOR[segment.color]}`} />
                  {segment.name} {segment.formattedValue}
                </span>
              ))}
            </div>
            {row.footerText ? <div className="mt-1 text-xs text-muted-foreground">{row.footerText}</div> : null}
          </>
        );
        return row.href ? (
          <Link className="block rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" href={row.href} key={row.key} role="listitem">
            {content}
          </Link>
        ) : (
          <div className="block" key={row.key} role="listitem">
            {content}
          </div>
        );
      })}
    </div>
  );
}

export interface MonthlySeries {
  name: string;
  color: keyof typeof SERIES_COLOR;
  values: number[]; // one per month, aligned with `months`
  formattedValues: string[];
}

/** Grouped monthly bars: one cluster per month, one bar per series within it.
 * Signed, not absolute-valued: company_retained_cents (and any other series)
 * can go negative when a guaranteed minimum payout or bonus exceeds what was
 * actually retained that month. Positive bars grow up from a shared zero
 * baseline; negative bars grow down from the same line -- position, not just
 * color, carries the sign, and negative bars additionally get a dashed
 * border (a real shape difference, not a hue) so it survives grayscale. */
const CHART_HEIGHT_PX = 128;

export function MonthlyBars({
  months, series, ariaLabel,
}: {
  months: string[]; // "YYYY-MM"
  series: MonthlySeries[];
  ariaLabel: string;
}) {
  if (months.length === 0) return <p className="text-sm text-muted-foreground">No months in range.</p>;
  const allValues = series.flatMap((s) => s.values);
  const maxPositive = Math.max(0, ...allValues.map((v) => Math.max(0, v)));
  const maxNegative = Math.max(0, ...allValues.map((v) => Math.max(0, -v)));
  const span = maxPositive + maxNegative;
  // Split the fixed height budget proportionally to how much range each side
  // actually needs: all-positive data gets the full height above the line
  // (identical to the old unsigned chart), all-negative gets it all below,
  // mixed data splits proportionally so both directions stay legible.
  const positiveBudget = span > 0 ? (CHART_HEIGHT_PX * maxPositive) / span : CHART_HEIGHT_PX / 2;
  const negativeBudget = span > 0 ? (CHART_HEIGHT_PX * maxNegative) / span : CHART_HEIGHT_PX / 2;
  const monthLabel = (ym: string) => {
    const [y, m] = ym.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "short" });
  };
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {series.map((s) => (
          <span className="inline-flex items-center gap-1.5" key={s.name}>
            <span aria-hidden className={`inline-block size-2.5 rounded-sm ${SERIES_COLOR[s.color]}`} />
            {s.name}
          </span>
        ))}
      </div>
      {maxNegative > 0 ? (
        <p className="mb-2 text-xs text-muted-foreground">Dashed, below the line: a negative amount for that month.</p>
      ) : null}
      {/* Decorative only -- no interactive/text descendants, so role=img here
          is safe and doesn't hide anything. The real values live in the table below. */}
      <div aria-label={ariaLabel} className="flex items-stretch gap-3 overflow-x-auto pb-1" role="img">
        {months.map((month, i) => (
          <div className="flex min-w-[64px] flex-1 flex-col items-center gap-1" key={month}>
            <div className="flex w-full flex-col" style={{ height: `${CHART_HEIGHT_PX}px` }}>
              <div className="flex flex-1 items-end justify-center gap-1" style={{ height: `${positiveBudget}px` }}>
                {series.map((s) => {
                  const value = s.values[i] ?? 0;
                  const height = value > 0 && maxPositive > 0 ? Math.max(2, (value / maxPositive) * positiveBudget) : 0;
                  return (
                    <div
                      className={height > 0 ? `w-3 rounded-t-sm sm:w-4 ${SERIES_COLOR[s.color]}` : "w-3 sm:w-4"}
                      key={s.name}
                      style={{ height: `${height}px` }}
                    />
                  );
                })}
              </div>
              <div aria-hidden className="h-px w-full shrink-0 bg-muted-foreground/50" />
              <div className="flex justify-center gap-1" style={{ height: `${negativeBudget}px` }}>
                {series.map((s) => {
                  const value = s.values[i] ?? 0;
                  const height = value < 0 && maxNegative > 0 ? Math.max(2, (Math.abs(value) / maxNegative) * negativeBudget) : 0;
                  return (
                    <div
                      className={height > 0 ? `w-3 rounded-b-sm border-x-2 border-b-2 border-dashed border-current sm:w-4 ${SERIES_COLOR[s.color]} ${SERIES_TEXT_COLOR[s.color]}` : "w-3 sm:w-4"}
                      key={s.name}
                      style={{ height: `${height}px` }}
                    />
                  );
                })}
              </div>
            </div>
            <span className="text-xs text-muted-foreground">{monthLabel(month)}</span>
          </div>
        ))}
      </div>
      {/* Full text equivalent of the chart above -- every signed value, for anyone who can't read bars. */}
      <table className="sr-only">
        <caption>{ariaLabel}</caption>
        <thead><tr><th>Month</th>{series.map((s) => <th key={s.name}>{s.name}</th>)}</tr></thead>
        <tbody>
          {months.map((month, i) => (
            <tr key={month}>
              <td>{month}</td>
              {series.map((s) => <td key={s.name}>{s.formattedValues[i] ?? "$0.00"}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
