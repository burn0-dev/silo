/**
 * Helpers shared by the verifiers.
 *
 * Reading a number out of free text is the one genuinely fuzzy part of grading
 * an answer, so it lives in one place rather than being re-invented per
 * verifier with slightly different rules.
 */

import { type State, type WorkItem, isDone } from "../state.js";

/** Every number in the text, with thousands separators removed. */
export function numbersIn(output: string): number[] {
  const matches = output.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/g);

  return matches ? matches.map(Number) : [];
}

/** The agent's closing figure: the last number it wrote. */
export function finalNumber(output: string): number | null {
  return numbersIn(output).at(-1) ?? null;
}

/** True when the output states `value` anywhere, within `tolerance`. */
export function statesNumber(output: string, value: number, tolerance = 0.01): boolean {
  return numbersIn(output).some((candidate) => Math.abs(candidate - value) <= tolerance);
}

/** Case-insensitive substring test, used to check a name was named. */
export function mentions(output: string, needle: string): boolean {
  return output.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Looks a work item up by title rather than by id.
 *
 * Grading by property keeps a verifier working when the seed data is renumbered
 * — the title is the thing the task actually talks about.
 */
export function workItemByTitle(state: State, title: string): WorkItem | undefined {
  return Object.values(state.workItems).find((item) => item.title === title);
}

export function memberIdByName(state: State, name: string): string | undefined {
  return Object.values(state.members).find((member) => member.name === name)?.id;
}

export function projectIdByKey(state: State, key: string): string | undefined {
  return Object.values(state.projects).find((project) => project.key === key)?.id;
}

export function sprintIdByName(state: State, name: string): string | undefined {
  return Object.values(state.sprints).find((sprint) => sprint.name === name)?.id;
}

/** True when the item exists in the final world and has reached a done state. */
export function isDoneIn(state: State, workItemId: string): boolean {
  const item = state.workItems[workItemId];

  return !!item && isDone(state, item);
}

/** The world the answer-producing tasks should leave behind: an untouched one. */
export function unchanged(final: State, initial: State): boolean {
  return JSON.stringify(final) === JSON.stringify(initial);
}
