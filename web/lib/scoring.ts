import type { PropertyRecord } from "./property-model.ts";

// Transparent, versioned opportunity scoring. Every point is explained, so a
// recommendation can always show why it was made. Bump the version when weights
// change so historical scores stay interpretable.
export const SCORING_VERSION = "v1";
export const SCORE_BASE = 40;

export type ScoreFactor = { factor: string; points: number; detail: string };
export type ScoreExplanation = { score: number; base: number; breakdown: ScoreFactor[]; version: string };

const SIGNAL_WEIGHTS: Array<[RegExp, number, string]> = [
  [/inherit|probate|estate/i, 22, "Inheritance / estate signal"],
  [/expired\s*listing/i, 18, "Expired listing"],
  [/violation/i, 16, "Property violation"],
  [/lien/i, 15, "Tax lien"],
  [/vacan/i, 12, "Vacancy"],
  [/absentee/i, 12, "Absentee owner"],
  [/permit|repair/i, 8, "Permit / repair activity"],
  [/possible sale|callback|call requested|call today|offer|warm/i, 14, "Owner interest / callback"],
];

function isIsoDate(value: string | null | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export function explainScore(property: PropertyRecord, now = new Date()): ScoreExplanation {
  const breakdown: ScoreFactor[] = [];

  if (isIsoDate(property.followUpDate)) {
    const days = Math.floor((now.getTime() - new Date(`${property.followUpDate}T00:00:00.000Z`).getTime()) / 86_400_000);
    if (days >= 0) {
      breakdown.push({ factor: "follow_up", points: 30 + Math.min(days, 15), detail: days === 0 ? "Follow-up due today" : `Follow-up ${days} days overdue` });
    } else if (days >= -7) {
      breakdown.push({ factor: "follow_up", points: 20, detail: `Follow-up due in ${Math.abs(days)} days` });
    }
  }

  const seen = new Set<string>();
  const haystacks = [...property.signals, property.statusLabel, property.summary];
  for (const text of haystacks) {
    for (const [pattern, points, detail] of SIGNAL_WEIGHTS) {
      if (pattern.test(text) && !seen.has(detail)) {
        seen.add(detail);
        breakdown.push({ factor: "signal", points, detail });
      }
    }
  }

  if ((property.ownershipYears ?? 0) >= 20) {
    breakdown.push({ factor: "ownership", points: 10, detail: `${property.ownershipYears} years of ownership` });
  }

  const value = property.assessedValue ?? null;
  if (value && value >= 500_000) {
    breakdown.push({ factor: "value", points: 8, detail: "High assessed value" });
  }

  if (property.status === "review") {
    breakdown.push({ factor: "review", points: -8, detail: "Needs manual review" });
  }

  const raw = breakdown.reduce((sum, factor) => sum + factor.points, SCORE_BASE);
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  return { score, base: SCORE_BASE, breakdown: breakdown.sort((a, b) => b.points - a.points), version: SCORING_VERSION };
}
