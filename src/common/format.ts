export interface HighestValue {
  name?: string;
  value: number;
}

export function pickHighest(
  values: Partial<Record<string, number>>,
  names: readonly string[],
): HighestValue {
  let best: HighestValue = { value: 0 };
  for (const name of names) {
    const value = values[name];
    if (value !== undefined && value > best.value) best = { name, value };
  }
  return best;
}

export function fixed2(value: number | undefined): string {
  return (value ?? 0).toFixed(2);
}

export function shorten(text: string, max = 120): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
}
