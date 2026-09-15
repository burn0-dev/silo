/**
 * The tools the agent may call.
 *
 * Registration is explicit. A file appearing in this directory does not become
 * an agent capability until its export is added to the array below.
 */

import type { ProjectTool } from "./contract.js";
import { clockTools } from "./clock.js";
import { memberTools } from "./members.js";
import { projectTools } from "./projects.js";
import { reportingTools } from "./reporting.js";
import { sprintTools } from "./sprints.js";
import { timeTools } from "./time.js";
import { workItemTools } from "./work-items.js";

export * from "./contract.js";
export * from "./helpers.js";

export {
  clockTools,
  memberTools,
  projectTools,
  reportingTools,
  sprintTools,
  timeTools,
  workItemTools,
};

export const tools: ProjectTool[] = [
  ...clockTools,
  ...memberTools,
  ...projectTools,
  ...sprintTools,
  ...workItemTools,
  ...timeTools,
  ...reportingTools,
];
