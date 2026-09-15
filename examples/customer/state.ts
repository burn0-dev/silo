/**
 * Environment state.
 *
 * The shape of the simulated world, plus pure helpers that read it. No data
 * lives here and nothing here builds a world — that is `environment.ts`.
 */

export type CustomerStatus = "active" | "blocked";

export type Customer = {
  id: string;
  name: string;
  status: CustomerStatus;
  statusReason: string | null;
};

export type State = {
  customers: Record<string, Customer>;
};

export const isBlocked = (customer: Customer): boolean => customer.status === "blocked";
