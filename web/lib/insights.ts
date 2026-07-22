import type { PropertyRecord } from "./property-model.ts";

// Derives the neighborhood pulse from the real properties in the workspace
// instead of hardcoded demo numbers.
export type NeighborhoodSummary = {
  name: string;
  total: number;
  inherited: number;
  violations: number;
  liens: number;
  absentee: number;
  expired: number;
  opportunity: string;
  averageEquity: string;
};

function parseMoney(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.replace(/[, $]/g, "").match(/^(\d+(?:\.\d+)?)([km])?$/i);
  if (!match) return null;
  const base = Number(match[1]);
  const unit = match[2]?.toLowerCase();
  if (unit === "m") return base * 1_000_000;
  if (unit === "k") return base * 1_000;
  return base;
}

export function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${Math.round(value)}`;
}

function propertyValue(property: PropertyRecord): number | null {
  if (typeof property.assessedValue === "number" && property.assessedValue > 0) return property.assessedValue;
  return parseMoney(property.equity);
}

function matches(property: PropertyRecord, pattern: RegExp, status?: PropertyRecord["status"]): boolean {
  if (status && property.status === status) return true;
  return property.signals.some((signal) => pattern.test(signal)) || pattern.test(property.summary);
}

export function computeNeighborhoodStats(properties: PropertyRecord[]): NeighborhoodSummary {
  const values = properties.map(propertyValue).filter((value): value is number => value !== null);
  const total = values.reduce((sum, value) => sum + value, 0);
  const average = values.length ? total / values.length : 0;

  const neighborhoods = new Map<string, number>();
  for (const property of properties) {
    if (!property.neighborhood) continue;
    const key = property.neighborhood.split(",")[0].trim();
    neighborhoods.set(key, (neighborhoods.get(key) ?? 0) + 1);
  }
  const name = [...neighborhoods.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Your workspace";

  return {
    name,
    total: properties.length,
    inherited: properties.filter((property) => matches(property, /inherit|probate|estate/i, "inherited")).length,
    violations: properties.filter((property) => matches(property, /violation/i, "violation")).length,
    liens: properties.filter((property) => matches(property, /lien/i)).length,
    absentee: properties.filter((property) => matches(property, /absentee/i, "absentee")).length,
    expired: properties.filter((property) => matches(property, /expired/i, "expired")).length,
    opportunity: values.length ? formatUsd(total) : "—",
    averageEquity: values.length ? formatUsd(average) : "—",
  };
}

// Projects real lat/lon onto an SVG canvas. Latitude is inverted so north is up.
export type PlacedProperty = { property: PropertyRecord; x: number; y: number };

export function projectCoordinates(
  properties: PropertyRecord[],
  width: number,
  height: number,
  padding = 44,
): PlacedProperty[] {
  const withCoords = properties.filter(
    (property) => typeof property.latitude === "number" && typeof property.longitude === "number",
  );
  if (withCoords.length === 0) return [];

  const lats = withCoords.map((property) => property.latitude as number);
  const lons = withCoords.map((property) => property.longitude as number);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const latSpan = maxLat - minLat || 1e-6;
  const lonSpan = maxLon - minLon || 1e-6;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;

  return withCoords.map((property) => ({
    property,
    x: padding + ((property.longitude as number) - minLon) / lonSpan * innerW,
    y: padding + (maxLat - (property.latitude as number)) / latSpan * innerH,
  }));
}
