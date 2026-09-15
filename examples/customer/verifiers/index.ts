/**
 * The verifiers that grade a rollout.
 *
 * Each task names the verifier that grades it, by id. Register each verifier
 * here so the task's `verifierId` can resolve.
 */

import type { SiloVerifier } from "@burn0/silo";

import { ver001 } from "./VER-001.js";

export const verifiers: SiloVerifier[] = [ver001];
