/**
 * Grades TASK-005.
 *
 * Comments live inside the work item rather than in a top-level collection, so
 * this grades the nested array directly: one more entry than the world started
 * with, naming the dependency that is holding the bug up.
 */

import { check, defineVerifier, optional } from "@burn0/silo";

import type { State } from "../state.js";
import { workItemByTitle } from "./shared.js";

export const ver005 = defineVerifier<State>({
  id: "VER-005",
  taskId: "TASK-005",
  name: "Blocker recorded as a comment on the bug",
  check(final, initial) {
    const target = workItemByTitle(initial, "Duplicate invoice emails");
    const blocker = workItemByTitle(initial, "Email service upgrade");

    const before = target?.comments.length ?? 0;
    const after = target ? (final.workItems[target.id]?.comments.length ?? 0) : 0;
    const added = target ? (final.workItems[target.id]?.comments.slice(before) ?? []) : [];

    const namesBlocker =
      !!blocker && added.some((comment) => comment.body.includes(blocker.id));

    return [
      check(
        "A comment was added to the duplicate invoice emails bug",
        after === before + 1,
        `${before} comment(s) before, ${after} after`,
      ),
      check(
        "The comment names the work item that is holding it up",
        namesBlocker,
        blocker ? `looking for ${blocker.id}` : "blocker not found",
      ),
      optional(
        "The existing comments were left alone",
        target
          ? JSON.stringify(final.workItems[target.id]?.comments.slice(0, before) ?? []) ===
            JSON.stringify(target.comments)
          : false,
        "prior comments untouched",
      ),
      optional(
        "No other work item gained a comment",
        Object.values(initial.workItems)
          .filter((item) => item.id !== target?.id)
          .every(
            (item) => (final.workItems[item.id]?.comments.length ?? 0) === item.comments.length,
          ),
        "comments added in one place only",
      ),
    ];
  },
});
