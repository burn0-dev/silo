/**
 * ERP tasks.
 *
 * Every task references data that exists in the seed, and every task names a
 * verifier that inspects the final state. Nothing is graded on what the agent
 * says it did.
 */

export type TaskDifficulty = "easy" | "medium" | "hard";

export type ErpTask = {
  id: string;
  title: string;
  instruction: string;
  difficulty: TaskDifficulty;
  verifierId: string;
  /** Entities the task is about; useful for filtering and for building traces. */
  entities: string[];
};

export const erpTasks: ErpTask[] = [
  // --- easy ---------------------------------------------------------------
  {
    id: "TASK-001",
    title: "Update vendor payment terms",
    instruction:
      "Tri-State Fasteners (VEN-002) has renegotiated its contract. Change their payment terms to NET_30. Act as Priya Nair (USR-003).",
    difficulty: "easy",
    verifierId: "VER-001",
    entities: ["VEN-002"],
  },
  {
    id: "TASK-002",
    title: "Block a vendor after quality failures",
    instruction:
      "Ironline Abrasives (VEN-007) has failed a third quality audit. Block them so no further purchase orders can be raised, recording the reason. Act as Priya Nair (USR-003).",
    difficulty: "easy",
    verifierId: "VER-002",
    entities: ["VEN-007"],
  },
  {
    id: "TASK-003",
    title: "Find the large overdue receivables",
    instruction:
      "Finance wants to chase big debts. Identify every customer invoice that is overdue as of today with a total above $10,000, and place the customer with the single largest overdue balance on credit hold, noting that it is for non-payment. Act as Ken Adeyemi (USR-008).",
    difficulty: "easy",
    verifierId: "VER-003",
    entities: ["CINV-403", "CINV-407", "CUS-003"],
  },
  {
    id: "TASK-004",
    title: "Check stock availability before promising a delivery",
    instruction:
      "A customer wants 40 units of Roller Chain RC80 (PRD-012) from Warehouse North (WH-001). Check whether that is available today. If it is not, adjust nothing — instead raise a purchase requisition for the reorder quantity against the Operations MRO budget (BUD-002), requested by Tom Braddock (USR-004) for the Warehouse Operations department (DEPT-OPS).",
    difficulty: "easy",
    verifierId: "VER-004",
    entities: ["PRD-012", "WH-001", "BUD-002"],
  },

  // --- medium -------------------------------------------------------------
  {
    id: "TASK-005",
    title: "Approve a requisition only if the budget allows",
    instruction:
      "Requisition PR-002 is waiting on Priya Nair (USR-003). Approve it only if the Facilities supplies budget can cover it. If the budget cannot cover it, reject the requisition instead and state the budget shortfall in the rejection reason. Act as Priya Nair (USR-003).",
    difficulty: "medium",
    verifierId: "VER-005",
    entities: ["PR-002", "BUD-004"],
  },
  {
    id: "TASK-006",
    title: "Rebalance stock to a warehouse below its reorder point",
    instruction:
      "V-Belt A42 (PRD-010) at Warehouse South (WH-002) has fallen below its reorder point. Move 200 units from Warehouse North (WH-001), which is well stocked, so that Warehouse South is back above its reorder point. Act as Helen Vasquez (USR-005).",
    difficulty: "medium",
    verifierId: "VER-006",
    entities: ["PRD-010", "WH-001", "WH-002"],
  },
  {
    id: "TASK-007",
    title: "Receive the outstanding balance of a partial delivery",
    instruction:
      "Purchase order PO-202 was only partly delivered: 25 of 40 hydraulic cylinders arrived. The remaining 15 have now turned up at Warehouse North in good condition. Receive them and confirm the purchase order is now fully received. Act as Tom Braddock (USR-004).",
    difficulty: "medium",
    verifierId: "VER-007",
    entities: ["PO-202", "PRD-007", "WH-001"],
  },
  {
    id: "TASK-008",
    title: "Pay the approved invoice that falls due this week",
    instruction:
      "Exactly one approved vendor invoice falls due within the next 7 days. Find it and pay it in full by bank transfer, taking the payment all the way through to completion so the invoice shows as paid. Marcus Lindqvist (USR-006) raises payments and Sofia Duarte (USR-007) approves them.",
    difficulty: "medium",
    verifierId: "VER-008",
    entities: ["VINV-107", "VEN-006"],
  },
  {
    id: "TASK-009",
    title: "Cancel an unapproved purchase order",
    instruction:
      "Purchase order PO-205 was raised in error and has not been approved. Cancel it, recording that it was a duplicate request. Act as Daniel Reyes (USR-002).",
    difficulty: "medium",
    verifierId: "VER-009",
    entities: ["PO-205"],
  },
  {
    id: "TASK-010",
    title: "Invoice a shipment that was never billed",
    instruction:
      "Sales order SO-306 for Halcyon Paper Mills was shipped and delivered but never invoiced. Raise the customer invoice for what actually shipped and issue it. Act as Lucia Moretti (USR-009).",
    difficulty: "medium",
    verifierId: "VER-010",
    entities: ["SO-306", "CUS-007"],
  },

  // --- hard ---------------------------------------------------------------
  {
    id: "TASK-011",
    title: "Award the best valid quotation and raise the order",
    instruction:
      "RFQ-002 is closed with three quotations. Award the cheapest quotation that is still valid today, then raise a purchase order to that vendor for the quoted lines, delivering into Warehouse North (WH-001) and charging the Operations MRO budget (BUD-002). Take the order through approval so it is approved, but do not send it yet. Daniel Reyes (USR-002) is the buyer and Priya Nair (USR-003) approves.",
    difficulty: "hard",
    verifierId: "VER-011",
    entities: ["RFQ-002", "QUO-005", "QUO-006", "BUD-002"],
  },
  {
    id: "TASK-012",
    title: "Work out why an invoice cannot be approved, and fix it",
    instruction:
      "Accounts payable cannot approve invoice VINV-104 from Tri-State Fasteners. Work out why. The vendor has confirmed that only 250 boxes were ever shipped and has agreed to credit the difference. Correct the invoice so it reflects what was actually received, re-run the match, and get the invoice approved. Marcus Lindqvist (USR-006) handles the invoice; Sofia Duarte (USR-007) approves.",
    difficulty: "hard",
    verifierId: "VER-012",
    entities: ["VINV-104", "PO-203", "GR-003", "DISC-001"],
  },
  {
    id: "TASK-013",
    title: "Resolve a price mismatch on a grease invoice",
    instruction:
      "Invoice VINV-103 from Northfield Lubricants is blocked. Establish the cause. Procurement has confirmed the purchase order price of $82.00 per drum is the agreed price and the vendor billed the wrong rate. Correct the invoice to the agreed price, re-match it, and approve it. Marcus Lindqvist (USR-006) handles the invoice; Sofia Duarte (USR-007) approves.",
    difficulty: "hard",
    verifierId: "VER-013",
    entities: ["VINV-103", "PO-206"],
  },
  {
    id: "TASK-014",
    title: "Fulfil an order that no single warehouse can cover",
    instruction:
      "Sales order SO-307 needs 150 units of bearing PRD-003 for Vertex Automotive Systems, but no single warehouse holds that many. Ship the order in full using stock from more than one warehouse, without moving stock between warehouses first. Act as Tom Braddock (USR-004).",
    difficulty: "hard",
    verifierId: "VER-014",
    entities: ["SO-307", "PRD-003", "WH-001", "WH-002"],
  },
  {
    id: "TASK-015",
    title: "Escalate a requisition that exceeds an approval limit",
    instruction:
      "Requisition PR-006 for the Reno automation programme is sitting with Priya Nair (USR-003), but it is above her approval limit. Route it to someone who is authorised to approve that amount, then have them approve it. Do not change the requisition's value.",
    difficulty: "hard",
    verifierId: "VER-015",
    entities: ["PR-006", "APR-005", "USR-003", "USR-008"],
  },
  {
    id: "TASK-016",
    title: "Recover a failed vendor payment",
    instruction:
      "The payment against invoice VINV-108 failed because Tri-State Fasteners' bank details were out of date, and the invoice is now overdue. Their finance contact has confirmed new details. Record the corrected contact email as ar@tristatefasteners.example, then put through a fresh payment for the full outstanding amount and complete it so the invoice is settled. Marcus Lindqvist (USR-006) raises payments and Sofia Duarte (USR-007) approves them.",
    difficulty: "hard",
    verifierId: "VER-016",
    entities: ["VINV-108", "PAY-003", "VEN-002"],
  },
  {
    id: "TASK-017",
    title: "Complete a procure-to-pay cycle end to end",
    instruction:
      "Facilities need 20 cases of cut-resistant gloves (PRD-020) into Warehouse North. Run the whole cycle: raise a requisition for Rina Kapoor (USR-011) in Facilities against budget BUD-004, get it approved, raise a purchase order on Summit Safety Products (VEN-009) at $154.00 per case, approve and send it, receive the goods in full, register the vendor's invoice for exactly what was received at the agreed price, match it, approve it and pay it so the invoice ends up paid. If the Facilities budget cannot cover the requisition, increase the budget allocation first and say so. Daniel Reyes (USR-002) buys, Priya Nair (USR-003) approves procurement, Tom Braddock (USR-004) receives, Marcus Lindqvist (USR-006) handles AP and Sofia Duarte (USR-007) approves payments. Ken Adeyemi (USR-008) can change budgets.",
    difficulty: "hard",
    verifierId: "VER-017",
    entities: ["PRD-020", "VEN-009", "BUD-004", "WH-001"],
  },
  {
    id: "TASK-018",
    title: "Reconcile a cancelled order that was still invoiced",
    instruction:
      "Purchase order PO-207 was cancelled, but invoice VINV-106 from Summit Safety Products is still on file against it. Confirm nothing was ever received against that order, then close the invoice out correctly so it cannot be paid, and record what you did. Act as Marcus Lindqvist (USR-006).",
    difficulty: "hard",
    verifierId: "VER-018",
    entities: ["PO-207", "VINV-106"],
  },
];

export function getTask(id: string): ErpTask | undefined {
  return erpTasks.find((task) => task.id === id);
}

export function tasksByDifficulty(difficulty: TaskDifficulty): ErpTask[] {
  return erpTasks.filter((task) => task.difficulty === difficulty);
}
