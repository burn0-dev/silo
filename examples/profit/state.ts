/**
 * Environment state.
 *
 * `totalProfit` is the domain truth for this world. Both the tools and the
 * verifier derive from it, so nobody hardcodes the answer.
 */

export type State = {
  profit1: number;
  profit2: number;
};

export function totalProfit(state: State): number {
  return state.profit1 + state.profit2;
}
