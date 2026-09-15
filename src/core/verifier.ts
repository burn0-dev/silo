/**
 * Authoring of deterministic verifiers.
 *
 * A verifier author returns a list of checks; Silo turns that into a score.
 * Keeping the arithmetic here means every environment grades the same way.
 */

import type {
  SiloVerifier,
  VerifierCheck,
  VerifierContext,
  VerifierOutcome,
} from "./types.js";

/** A check that defines success. Failing one fails the task. */
export function check(label: string, passed: boolean, detail = ""): VerifierCheck {
  return { label, passed, detail, required: true };
}

/** Corroborating evidence: moves the reward but cannot fail the task alone. */
export function optional(label: string, passed: boolean, detail = ""): VerifierCheck {
  return { label, passed, detail, required: false };
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function score(verifierId: string, taskId: string, checks: VerifierCheck[]): VerifierOutcome {
  const required = checks.filter((entry) => entry.required);

  if (required.length === 0) {
    throw new Error(
      `${verifierId} returned no required checks; a task cannot be graded on optional evidence alone.`,
    );
  }

  const failedRequired = required.filter((entry) => !entry.passed);
  const passedCount = checks.filter((entry) => entry.passed).length;

  return {
    verifierId,
    taskId,
    passed: failedRequired.length === 0,
    reward: checks.length === 0 ? 0 : round2(passedCount / checks.length),
    requiredPassed: required.length - failedRequired.length,
    requiredTotal: required.length,
    failedRequired: failedRequired.map((entry) => entry.label),
    checks,
  };
}

export type VerifierSpec<State> = {
  id: string;
  taskId: string;
  name: string;
  /**
   * Inspect the world the rollout left behind, against the one it started from.
   *
   * `context` is optional to declare: a verifier that only cares about state
   * takes two parameters and ignores it. Reach for it when the task asks a
   * question rather than demanding a change — and derive the expected answer
   * from the world rather than hardcoding it.
   */
  check: (
    finalState: State,
    initialState: State,
    context: VerifierContext,
  ) => VerifierCheck[];
};

export function defineVerifier<State>(spec: VerifierSpec<State>): SiloVerifier {
  return {
    id: spec.id,
    taskId: spec.taskId,
    name: spec.name,
    check(finalState, initialState, context) {
      return score(
        spec.id,
        spec.taskId,
        spec.check(finalState as State, initialState as State, context),
      );
    },
  };
}
