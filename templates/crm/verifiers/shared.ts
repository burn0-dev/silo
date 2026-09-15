/**
 * Helpers shared by the answer-producing verifiers.
 *
 * Reading a number out of free text is the one genuinely fuzzy part of grading
 * an answer, so it lives in one place rather than being re-invented per
 * verifier with slightly different rules.
 */

/** Every number in the text, with currency symbols and thousands separators removed. */
export function numbersIn(output: string): number[] {
  const matches = output.replace(/[$,]/g, "").match(/-?\d+(?:\.\d+)?/g);

  return matches ? matches.map(Number) : [];
}

/** The agent's closing figure: the last number it wrote. */
export function finalNumber(output: string): number | null {
  return numbersIn(output).at(-1) ?? null;
}

/** True when the output states `value` anywhere, within `tolerance`. */
export function statesNumber(output: string, value: number, tolerance = 0.01): boolean {
  return numbersIn(output).some((candidate) => Math.abs(candidate - value) <= tolerance);
}

/** Case-insensitive substring test, used to check a name was named. */
export function mentions(output: string, needle: string): boolean {
  return output.toLowerCase().includes(needle.toLowerCase());
}
