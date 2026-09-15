/**
 * Environment state.
 *
 * The shape of your simulated world, plus pure helpers that read it.
 *
 * Keep the name `State` as you grow this: every scaffolded tool and verifier
 * imports it by that name, so evolving the type in place costs no renames.
 *
 *   export type State = {
 *     products: Record<string, Product>;
 *   };
 */

export type State = Record<string, unknown>;
