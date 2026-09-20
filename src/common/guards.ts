export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function numberInRange(
  value: number,
  min: number,
  max: number,
  inclusiveOnMin = true,
): boolean {
  const above = inclusiveOnMin ? value >= min : value > min;
  return above && value <= max;
}
