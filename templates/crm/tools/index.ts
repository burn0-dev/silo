/**
 * The tools the agent may call.
 *
 * Registration is explicit. A file appearing in this directory does not become
 * an agent capability until its export is added to the array below.
 */

import type { CrmTool } from "./contract.js";
import { accountTools } from "./accounts.js";
import { activityTools } from "./activities.js";
import { clockTools } from "./clock.js";
import { contactTools } from "./contacts.js";
import { leadTools } from "./leads.js";
import { opportunityTools } from "./opportunities.js";
import { reportingTools } from "./reporting.js";
import { userTools } from "./users.js";

export * from "./contract.js";
export * from "./helpers.js";

export {
  accountTools,
  activityTools,
  clockTools,
  contactTools,
  leadTools,
  opportunityTools,
  reportingTools,
  userTools,
};

export const tools: CrmTool[] = [
  ...clockTools,
  ...userTools,
  ...accountTools,
  ...contactTools,
  ...leadTools,
  ...opportunityTools,
  ...activityTools,
  ...reportingTools,
];
