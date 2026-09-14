/**
 * The verifiers that grade a rollout.
 *
 * A verifier inspects the final state against the initial one and decides what
 * passed. Each task names the verifier that grades it, by id.
 */

import type { SiloVerifier } from "@burn0/silo";

export const verifiers: SiloVerifier[] = [];
