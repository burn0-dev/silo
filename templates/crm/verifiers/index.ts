/**
 * The verifiers that grade a rollout.
 *
 * Each task names the verifier that grades it, by id. Register each verifier
 * here so the task's `verifierId` can resolve.
 */

import type { SiloVerifier } from "@burn0/silo";

import { ver001 } from "./VER-001.js";
import { ver002 } from "./VER-002.js";
import { ver003 } from "./VER-003.js";
import { ver004 } from "./VER-004.js";
import { ver005 } from "./VER-005.js";
import { ver006 } from "./VER-006.js";

export const verifiers: SiloVerifier[] = [ver001, ver002, ver003, ver004, ver005, ver006];
