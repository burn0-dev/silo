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
import { ver007 } from "./VER-007.js";
import { ver008 } from "./VER-008.js";
import { ver009 } from "./VER-009.js";
import { ver010 } from "./VER-010.js";
import { ver011 } from "./VER-011.js";
import { ver012 } from "./VER-012.js";
import { ver013 } from "./VER-013.js";
import { ver014 } from "./VER-014.js";
import { ver015 } from "./VER-015.js";

export const verifiers: SiloVerifier[] = [
  ver001,
  ver002,
  ver003,
  ver004,
  ver005,
  ver006,
  ver007,
  ver008,
  ver009,
  ver010,
  ver011,
  ver012,
  ver013,
  ver014,
  ver015,
];
