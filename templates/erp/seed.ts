/**
 * Deterministic seed data for the ERP environment.
 *
 * Every record is hardcoded and internally consistent: quotations reference real
 * RFQs, receipts reference real purchase orders, invoiced quantities line up with
 * received quantities (except where a mismatch is intentional), and inventory
 * reservations match open sales orders.
 *
 * On-hand quantities include opening balances that predate the seeded movement
 * log, so the movement list is a recent history rather than a full reconstruction.
 */

import {
  type Budget,
  type Company,
  type Customer,
  type CustomerInvoice,
  type Department,
  type ErpState,
  type Expense,
  type Fulfillment,
  type GoodsReceipt,
  type InventoryMovement,
  type InventoryRecord,
  type Money,
  type Payment,
  type Product,
  type PurchaseOrder,
  type PurchaseRequisition,
  type Quotation,
  type ReceivingDiscrepancy,
  type Rfq,
  type SalesOrder,
  type ThreeWayMatch,
  type Approval,
  type AuditEvent,
  type User,
  type Vendor,
  type VendorInvoice,
  type Warehouse,
  indexById,
  inventoryId,
  money,
} from "./state.js";

/** Simulated clock. Nothing in this environment reads the real system time. */
export const SIMULATION_NOW = "2026-03-16T09:00:00.000Z";

const usd = (amount: number): Money => money(amount, "USD");

export const company: Company = {
  id: "CMP-001",
  name: "Meridian Industrial Supply",
  legalName: "Meridian Industrial Supply Co., Inc.",
  taxId: "US-84-2310977",
  baseCurrency: "USD",
  fiscalYear: "FY2026",
  fiscalYearStart: "2026-01-01T00:00:00.000Z",
  address: {
    line1: "4400 Corporate Parkway",
    city: "Columbus",
    region: "OH",
    postalCode: "43219",
    country: "US",
  },
};

export const departments: Department[] = [
  {
    id: "DEPT-PROC",
    code: "PROC",
    name: "Procurement",
    managerUserId: "USR-003",
    costCenter: "CC-1200",
  },
  {
    id: "DEPT-OPS",
    code: "OPS",
    name: "Warehouse Operations",
    managerUserId: "USR-005",
    costCenter: "CC-1400",
  },
  {
    id: "DEPT-FIN",
    code: "FIN",
    name: "Finance",
    managerUserId: "USR-008",
    costCenter: "CC-1100",
  },
  {
    id: "DEPT-SALES",
    code: "SALES",
    name: "Sales",
    managerUserId: "USR-010",
    costCenter: "CC-1600",
  },
  {
    id: "DEPT-IT",
    code: "IT",
    name: "Information Technology",
    managerUserId: "USR-001",
    costCenter: "CC-1800",
  },
  {
    id: "DEPT-FAC",
    code: "FAC",
    name: "Facilities",
    managerUserId: "USR-005",
    costCenter: "CC-1900",
  },
];

export const users: User[] = [
  {
    id: "USR-001",
    name: "Amara Okafor",
    email: "amara.okafor@meridian-industrial.example",
    role: "admin",
    departmentId: "DEPT-IT",
    approvalLimit: usd(50_000),
    isActive: true,
  },
  {
    id: "USR-002",
    name: "Daniel Reyes",
    email: "daniel.reyes@meridian-industrial.example",
    role: "procurement_officer",
    departmentId: "DEPT-PROC",
    approvalLimit: usd(25_000),
    isActive: true,
  },
  {
    id: "USR-003",
    name: "Priya Nair",
    email: "priya.nair@meridian-industrial.example",
    role: "procurement_manager",
    departmentId: "DEPT-PROC",
    approvalLimit: usd(150_000),
    isActive: true,
  },
  {
    id: "USR-004",
    name: "Tom Braddock",
    email: "tom.braddock@meridian-industrial.example",
    role: "warehouse_operator",
    departmentId: "DEPT-OPS",
    approvalLimit: null,
    isActive: true,
  },
  {
    id: "USR-005",
    name: "Helen Vasquez",
    email: "helen.vasquez@meridian-industrial.example",
    role: "warehouse_manager",
    departmentId: "DEPT-OPS",
    approvalLimit: usd(20_000),
    isActive: true,
  },
  {
    id: "USR-006",
    name: "Marcus Lindqvist",
    email: "marcus.lindqvist@meridian-industrial.example",
    role: "ap_clerk",
    departmentId: "DEPT-FIN",
    approvalLimit: usd(10_000),
    isActive: true,
  },
  {
    id: "USR-007",
    name: "Sofia Duarte",
    email: "sofia.duarte@meridian-industrial.example",
    role: "ap_manager",
    departmentId: "DEPT-FIN",
    approvalLimit: usd(100_000),
    isActive: true,
  },
  {
    id: "USR-008",
    name: "Ken Adeyemi",
    email: "ken.adeyemi@meridian-industrial.example",
    role: "finance_controller",
    departmentId: "DEPT-FIN",
    approvalLimit: usd(500_000),
    isActive: true,
  },
  {
    id: "USR-009",
    name: "Lucia Moretti",
    email: "lucia.moretti@meridian-industrial.example",
    role: "sales_rep",
    departmentId: "DEPT-SALES",
    approvalLimit: null,
    isActive: true,
  },
  {
    id: "USR-010",
    name: "Jonah Wexler",
    email: "jonah.wexler@meridian-industrial.example",
    role: "sales_manager",
    departmentId: "DEPT-SALES",
    approvalLimit: usd(50_000),
    isActive: true,
  },
  {
    id: "USR-011",
    name: "Rina Kapoor",
    email: "rina.kapoor@meridian-industrial.example",
    role: "requester",
    departmentId: "DEPT-FAC",
    approvalLimit: null,
    isActive: true,
  },
  {
    id: "USR-012",
    name: "Oscar Bell",
    email: "oscar.bell@meridian-industrial.example",
    role: "warehouse_operator",
    departmentId: "DEPT-OPS",
    approvalLimit: null,
    isActive: true,
  },
  {
    id: "USR-013",
    name: "Grace Yamamoto",
    email: "grace.yamamoto@meridian-industrial.example",
    role: "warehouse_manager",
    departmentId: "DEPT-OPS",
    approvalLimit: usd(20_000),
    isActive: true,
  },
];

function address(
  line1: string,
  city: string,
  region: string,
  postalCode: string,
): Vendor["address"] {
  return { line1, city, region, postalCode, country: "US" };
}

export const vendors: Vendor[] = [
  {
    id: "VEN-001",
    code: "KESSLER",
    name: "Kessler Bearing Works",
    status: "active",
    categories: ["bearings", "power transmission"],
    paymentTerms: "NET_30",
    currency: "USD",
    contact: {
      name: "Erik Kessler",
      email: "sales@kesslerbearing.example",
      phone: "+1-614-555-0142",
    },
    address: address("1820 Foundry Road", "Cleveland", "OH", "44103"),
    taxId: "US-34-7781209",
    rating: 4.6,
    leadTimeDays: 7,
    isPreferred: true,
    createdAt: "2021-04-12T00:00:00.000Z",
    statusReason: null,
  },
  {
    id: "VEN-002",
    code: "TRISTATE",
    name: "Tri-State Fasteners",
    status: "active",
    categories: ["fasteners"],
    paymentTerms: "NET_45",
    currency: "USD",
    contact: {
      name: "Denise Whitaker",
      email: "orders@tristatefasteners.example",
      phone: "+1-317-555-0118",
    },
    address: address("77 Industrial Loop", "Indianapolis", "IN", "46241"),
    taxId: "US-35-2298471",
    rating: 4.1,
    leadTimeDays: 5,
    isPreferred: false,
    createdAt: "2020-09-30T00:00:00.000Z",
    statusReason: null,
  },
  {
    id: "VEN-003",
    code: "HALVORSEN",
    name: "Halvorsen Hydraulics",
    status: "active",
    categories: ["hydraulics"],
    paymentTerms: "NET_30",
    currency: "USD",
    contact: {
      name: "Nils Halvorsen",
      email: "quotes@halvorsenhydraulics.example",
      phone: "+1-414-555-0177",
    },
    address: address("6 Baltic Way", "Milwaukee", "WI", "53204"),
    taxId: "US-39-5510923",
    rating: 4.4,
    leadTimeDays: 14,
    isPreferred: true,
    createdAt: "2019-06-03T00:00:00.000Z",
    statusReason: null,
  },
  {
    id: "VEN-004",
    code: "PACBELT",
    name: "Pacific Belt & Chain",
    status: "active",
    categories: ["power transmission"],
    paymentTerms: "NET_60",
    currency: "USD",
    contact: {
      name: "Marisol Vega",
      email: "info@pacificbeltchain.example",
      phone: "+1-503-555-0163",
    },
    address: address("2245 Willamette Drive", "Portland", "OR", "97209"),
    taxId: "US-93-4417765",
    rating: 3.9,
    leadTimeDays: 30,
    isPreferred: false,
    createdAt: "2022-01-19T00:00:00.000Z",
    statusReason: null,
  },
  {
    id: "VEN-005",
    code: "CASCADE",
    name: "Cascade Electrical Supply",
    status: "active",
    categories: ["electrical"],
    paymentTerms: "NET_30",
    currency: "USD",
    contact: {
      name: "Grant Ibarra",
      email: "sales@cascadeelectrical.example",
      phone: "+1-206-555-0190",
    },
    address: address("510 Harbor Street", "Tacoma", "WA", "98402"),
    taxId: "US-91-6628340",
    rating: 4.3,
    leadTimeDays: 10,
    isPreferred: false,
    createdAt: "2021-11-08T00:00:00.000Z",
    statusReason: null,
  },
  {
    id: "VEN-006",
    code: "OKONKWO",
    name: "Okonkwo Tooling Group",
    status: "active",
    categories: ["tools"],
    paymentTerms: "NET_15",
    currency: "USD",
    contact: {
      name: "Chidi Okonkwo",
      email: "orders@okonkwotooling.example",
      phone: "+1-313-555-0155",
    },
    address: address("930 Gratiot Avenue", "Detroit", "MI", "48207"),
    taxId: "US-38-9903112",
    rating: 4.7,
    leadTimeDays: 14,
    isPreferred: true,
    createdAt: "2020-02-27T00:00:00.000Z",
    statusReason: null,
  },
  {
    id: "VEN-007",
    code: "IRONLINE",
    name: "Ironline Abrasives",
    status: "inactive",
    categories: ["abrasives"],
    paymentTerms: "NET_30",
    currency: "USD",
    contact: {
      name: "Paula Grimes",
      email: "service@ironlineabrasives.example",
      phone: "+1-205-555-0136",
    },
    address: address("14 Slag Mill Road", "Birmingham", "AL", "35211"),
    taxId: "US-63-3320198",
    rating: 3.2,
    leadTimeDays: 7,
    isPreferred: false,
    createdAt: "2018-08-14T00:00:00.000Z",
    statusReason: "Dormant since 2025-10; no orders placed in two quarters.",
  },
  {
    id: "VEN-008",
    code: "BALTICSEAL",
    name: "Baltic Seal & Gasket",
    status: "blocked",
    categories: ["seals"],
    paymentTerms: "NET_30",
    currency: "USD",
    contact: {
      name: "Katrin Ozols",
      email: "support@balticseal.example",
      phone: "+1-773-555-0129",
    },
    address: address("3300 Kedzie Avenue", "Chicago", "IL", "60618"),
    taxId: "US-36-4478215",
    rating: 2.4,
    leadTimeDays: 10,
    isPreferred: false,
    createdAt: "2019-03-22T00:00:00.000Z",
    statusReason: "Blocked 2026-01-22 after three consecutive quality rejections.",
  },
  {
    id: "VEN-009",
    code: "SUMMIT",
    name: "Summit Safety Products",
    status: "active",
    categories: ["safety"],
    paymentTerms: "NET_30",
    currency: "USD",
    contact: {
      name: "Bianca Serrano",
      email: "sales@summitsafety.example",
      phone: "+1-720-555-0148",
    },
    address: address("880 Alpine Court", "Denver", "CO", "80216"),
    taxId: "US-84-1129056",
    rating: 4.5,
    leadTimeDays: 10,
    isPreferred: false,
    createdAt: "2022-05-16T00:00:00.000Z",
    statusReason: null,
  },
  {
    id: "VEN-010",
    code: "NORTHFIELD",
    name: "Northfield Lubricants",
    status: "active",
    categories: ["lubricants"],
    paymentTerms: "NET_45",
    currency: "USD",
    contact: {
      name: "Wesley Cho",
      email: "ar@northfieldlubricants.example",
      phone: "+1-612-555-0171",
    },
    address: address("41 Refinery Lane", "Saint Paul", "MN", "55107"),
    taxId: "US-41-7734920",
    rating: 4.0,
    leadTimeDays: 14,
    isPreferred: false,
    createdAt: "2021-07-01T00:00:00.000Z",
    statusReason: null,
  },
  {
    id: "VEN-011",
    code: "VANTAGE",
    name: "Vantage Packaging",
    status: "pending_approval",
    categories: ["packaging"],
    paymentTerms: "NET_30",
    currency: "USD",
    contact: {
      name: "Ingrid Solheim",
      email: "hello@vantagepackaging.example",
      phone: "+1-402-555-0184",
    },
    address: address("1205 Cornhusker Highway", "Lincoln", "NE", "68521"),
    taxId: "US-47-2218873",
    rating: 0,
    leadTimeDays: 12,
    isPreferred: false,
    createdAt: "2026-03-02T00:00:00.000Z",
    statusReason: "Awaiting supplier qualification and insurance certificate.",
  },
  {
    id: "VEN-012",
    code: "REDWOOD",
    name: "Redwood Conveyor Parts",
    status: "active",
    categories: ["power transmission", "conveyor"],
    paymentTerms: "NET_30",
    currency: "USD",
    contact: {
      name: "Alan Prentice",
      email: "service@redwoodconveyor.example",
      phone: "+1-916-555-0107",
    },
    address: address("62 Sierra Point Road", "Sacramento", "CA", "95826"),
    taxId: "US-68-5590447",
    rating: 3.8,
    leadTimeDays: 12,
    isPreferred: false,
    createdAt: "2023-10-05T00:00:00.000Z",
    statusReason: null,
  },
];

export const customers: Customer[] = [
  {
    id: "CUS-001",
    code: "GRANITEPEAK",
    name: "Granite Peak Manufacturing",
    status: "active",
    segment: "heavy manufacturing",
    creditLimit: usd(250_000),
    paymentTerms: "NET_30",
    currency: "USD",
    contact: {
      name: "Della Monroe",
      email: "purchasing@granitepeakmfg.example",
      phone: "+1-406-555-0112",
    },
    billingAddress: address("900 Quarry Road", "Billings", "MT", "59101"),
    shippingAddress: address("902 Quarry Road Dock 4", "Billings", "MT", "59101"),
    createdAt: "2020-05-11T00:00:00.000Z",
    statusReason: null,
  },
  {
    id: "CUS-002",
    code: "LAKESIDE",
    name: "Lakeside Food Processing",
    status: "active",
    segment: "food & beverage",
    creditLimit: usd(150_000),
    paymentTerms: "NET_45",
    currency: "USD",
    contact: {
      name: "Victor Almeida",
      email: "maintenance@lakesidefoods.example",
      phone: "+1-608-555-0125",
    },
    billingAddress: address("17 Shoreline Drive", "Madison", "WI", "53704"),
    shippingAddress: address("17 Shoreline Drive", "Madison", "WI", "53704"),
    createdAt: "2021-02-08T00:00:00.000Z",
    statusReason: null,
  },
  {
    id: "CUS-003",
    code: "CORVUS",
    name: "Corvus Aerospace Components",
    status: "active",
    segment: "aerospace",
    creditLimit: usd(500_000),
    paymentTerms: "NET_60",
    currency: "USD",
    contact: {
      name: "Imani Blackwood",
      email: "ap@corvusaero.example",
      phone: "+1-316-555-0193",
    },
    billingAddress: address("4501 Airframe Boulevard", "Wichita", "KS", "67209"),
    shippingAddress: address("4501 Airframe Boulevard", "Wichita", "KS", "67209"),
    createdAt: "2019-09-17T00:00:00.000Z",
    statusReason: null,
  },
  {
    id: "CUS-004",
    code: "SUNBELT",
    name: "Sunbelt Agricultural Co-op",
    status: "active",
    segment: "agriculture",
    creditLimit: usd(100_000),
    paymentTerms: "NET_30",
    currency: "USD",
    contact: {
      name: "Roy Castellanos",
      email: "orders@sunbeltcoop.example",
      phone: "+1-806-555-0138",
    },
    billingAddress: address("2200 Farm Road 40", "Lubbock", "TX", "79404"),
    shippingAddress: address("2200 Farm Road 40", "Lubbock", "TX", "79404"),
    createdAt: "2022-03-14T00:00:00.000Z",
    statusReason: null,
  },
  {
    id: "CUS-005",
    code: "RIDGEWAY",
    name: "Ridgeway Mining Services",
    status: "credit_hold",
    segment: "mining",
    creditLimit: usd(300_000),
    paymentTerms: "NET_30",
    currency: "USD",
    contact: {
      name: "Brett Halloran",
      email: "accounts@ridgewaymining.example",
      phone: "+1-775-555-0166",
    },
    billingAddress: address("55 Comstock Way", "Elko", "NV", "89801"),
    shippingAddress: address("55 Comstock Way", "Elko", "NV", "89801"),
    createdAt: "2020-11-02T00:00:00.000Z",
    statusReason: "Credit hold 2026-03-06: 62 days past due on prior balance.",
  },
  {
    id: "CUS-006",
    code: "DELTAMARINE",
    name: "Delta Marine Works",
    status: "active",
    segment: "marine",
    creditLimit: usd(120_000),
    paymentTerms: "NET_30",
    currency: "USD",
    contact: {
      name: "Yvonne Trahan",
      email: "purchasing@deltamarineworks.example",
      phone: "+1-504-555-0121",
    },
    billingAddress: address("88 Levee Street", "New Orleans", "LA", "70117"),
    shippingAddress: address("88 Levee Street", "New Orleans", "LA", "70117"),
    createdAt: "2021-08-23T00:00:00.000Z",
    statusReason: null,
  },
  {
    id: "CUS-007",
    code: "HALCYON",
    name: "Halcyon Paper Mills",
    status: "active",
    segment: "pulp & paper",
    creditLimit: usd(200_000),
    paymentTerms: "NET_45",
    currency: "USD",
    contact: {
      name: "Stefan Novak",
      email: "mro@halcyonpaper.example",
      phone: "+1-207-555-0150",
    },
    billingAddress: address("3 Kennebec Avenue", "Bangor", "ME", "04401"),
    shippingAddress: address("3 Kennebec Avenue", "Bangor", "ME", "04401"),
    createdAt: "2019-12-05T00:00:00.000Z",
    statusReason: null,
  },
  {
    id: "CUS-008",
    code: "VERTEX",
    name: "Vertex Automotive Systems",
    status: "active",
    segment: "automotive",
    creditLimit: usd(400_000),
    paymentTerms: "NET_30",
    currency: "USD",
    contact: {
      name: "Nadia Farouk",
      email: "supplychain@vertexauto.example",
      phone: "+1-248-555-0174",
    },
    billingAddress: address("1600 Assembly Drive", "Warren", "MI", "48089"),
    shippingAddress: address("1600 Assembly Drive Gate 2", "Warren", "MI", "48089"),
    createdAt: "2020-07-29T00:00:00.000Z",
    statusReason: null,
  },
  {
    id: "CUS-009",
    code: "BRIGHTLINE",
    name: "Brightline Rail Maintenance",
    status: "active",
    segment: "rail",
    creditLimit: usd(180_000),
    paymentTerms: "NET_30",
    currency: "USD",
    contact: {
      name: "Curtis Nakamura",
      email: "procurement@brightlinerail.example",
      phone: "+1-904-555-0187",
    },
    billingAddress: address("210 Union Yard Road", "Jacksonville", "FL", "32206"),
    shippingAddress: address("210 Union Yard Road", "Jacksonville", "FL", "32206"),
    createdAt: "2022-09-12T00:00:00.000Z",
    statusReason: null,
  },
  {
    id: "CUS-010",
    code: "COBALT",
    name: "Cobalt Robotics",
    status: "blocked",
    segment: "robotics",
    creditLimit: usd(50_000),
    paymentTerms: "NET_15",
    currency: "USD",
    contact: {
      name: "Priscilla Vance",
      email: "finance@cobaltrobotics.example",
      phone: "+1-408-555-0199",
    },
    billingAddress: address("75 Innovation Court", "San Jose", "CA", "95134"),
    shippingAddress: address("75 Innovation Court", "San Jose", "CA", "95134"),
    createdAt: "2023-04-18T00:00:00.000Z",
    statusReason: "Blocked 2026-01-09 after invoice written off as uncollectible.",
  },
  {
    id: "CUS-011",
    code: "PRAIRIEWIND",
    name: "Prairie Wind Energy",
    status: "active",
    segment: "renewable energy",
    creditLimit: usd(350_000),
    paymentTerms: "NET_60",
    currency: "USD",
    contact: {
      name: "Hollis Dunbar",
      email: "ap@prairiewindenergy.example",
      phone: "+1-515-555-0143",
    },
    billingAddress: address("9000 Turbine Road", "Des Moines", "IA", "50313"),
    shippingAddress: address("9000 Turbine Road", "Des Moines", "IA", "50313"),
    createdAt: "2021-06-21T00:00:00.000Z",
    statusReason: null,
  },
  {
    id: "CUS-012",
    code: "STONEBRIDGE",
    name: "Stonebridge Facilities Group",
    status: "inactive",
    segment: "facilities management",
    creditLimit: usd(75_000),
    paymentTerms: "NET_30",
    currency: "USD",
    contact: {
      name: "Marta Quintero",
      email: "orders@stonebridgefm.example",
      phone: "+1-215-555-0158",
    },
    billingAddress: address("640 Market Street", "Philadelphia", "PA", "19106"),
    shippingAddress: address("640 Market Street", "Philadelphia", "PA", "19106"),
    createdAt: "2020-01-30T00:00:00.000Z",
    statusReason: "Contract lapsed 2025-12-31; renewal under discussion.",
  },
];

function product(
  id: string,
  sku: string,
  name: string,
  category: string,
  uom: Product["uom"],
  standardCost: number,
  listPrice: number,
  reorderPoint: number,
  reorderQuantity: number,
  leadTimeDays: number,
  preferredVendorIds: string[],
  status: Product["status"] = "active",
): Product {
  return {
    id,
    sku,
    name,
    category,
    uom,
    standardCost: usd(standardCost),
    listPrice: usd(listPrice),
    status,
    reorderPoint,
    reorderQuantity,
    leadTimeDays,
    preferredVendorIds,
    isStocked: true,
  };
}

export const products: Product[] = [
  product("PRD-001", "BRG-6205", "Deep Groove Ball Bearing 6205-2RS", "bearings", "each", 4.25, 9.5, 200, 500, 7, ["VEN-001"]),
  product("PRD-002", "BRG-30206", "Tapered Roller Bearing 30206", "bearings", "each", 11.8, 24, 120, 300, 10, ["VEN-001"]),
  product("PRD-003", "BRG-6309", "Deep Groove Ball Bearing 6309-ZZ", "bearings", "each", 18.4, 37.5, 80, 200, 10, ["VEN-001"]),
  product("PRD-004", "FAS-M8X40", "Hex Bolt M8x40 Zinc (box of 100)", "fasteners", "box", 12, 22.5, 150, 400, 5, ["VEN-002"]),
  product("PRD-005", "FAS-M12X60", "Hex Bolt M12x60 Grade 8.8 (box of 50)", "fasteners", "box", 18.75, 34, 100, 250, 5, ["VEN-002"]),
  product("PRD-006", "FAS-NUT-M8", "Nylon Lock Nut M8 (box of 200)", "fasteners", "box", 9.1, 18, 120, 300, 5, ["VEN-002"]),
  product("PRD-007", "HYD-CYL-50", "Hydraulic Cylinder 50mm Bore", "hydraulics", "each", 245, 468, 15, 40, 21, ["VEN-003"]),
  product("PRD-008", "HYD-HOSE-12", "Hydraulic Hose 1/2in R2", "hydraulics", "metre", 6.75, 14.2, 300, 600, 14, ["VEN-003"]),
  product("PRD-009", "HYD-PUMP-A12", "Gear Pump A12 Series", "hydraulics", "each", 512, 940, 8, 20, 28, ["VEN-003"]),
  product("PRD-010", "BLT-V-A42", "V-Belt A42", "power transmission", "each", 7.1, 15, 200, 500, 7, ["VEN-004"]),
  product("PRD-011", "BLT-TIM-8M", "Timing Belt 8M-1600", "power transmission", "each", 34.5, 68, 60, 150, 14, ["VEN-004"]),
  product("PRD-012", "CHN-RC80", "Roller Chain RC80 (10ft)", "power transmission", "each", 88, 165, 40, 100, 14, ["VEN-004", "VEN-012"]),
  product("PRD-013", "ELE-CON-32", "Contactor 32A 3-Pole", "electrical", "each", 42, 86, 50, 120, 10, ["VEN-005"]),
  product("PRD-014", "ELE-VFD-5K", "Variable Frequency Drive 5kW", "electrical", "each", 615, 1150, 6, 15, 28, ["VEN-005"]),
  product("PRD-015", "ELE-CBL-4C", "Control Cable 4-Core", "electrical", "metre", 2.35, 5.1, 800, 2000, 7, ["VEN-005"]),
  product("PRD-016", "TOL-IMP-12", "Impact Wrench 1/2in", "tools", "each", 178, 329, 12, 30, 14, ["VEN-006"]),
  product("PRD-017", "TOL-TRQ-200", "Torque Wrench 200Nm", "tools", "each", 96.5, 189, 20, 50, 14, ["VEN-006"]),
  product("PRD-018", "ABR-DISC-125", "Grinding Disc 125mm (box of 25)", "abrasives", "box", 21, 42, 90, 240, 7, ["VEN-007"]),
  product("PRD-019", "SEL-ORING-K", "O-Ring Kit Nitrile 382pc", "seals", "each", 28, 59, 40, 100, 10, ["VEN-008"]),
  product("PRD-020", "SAF-GLV-CR5", "Cut-Resistant Gloves Level 5 (case of 60)", "safety", "case", 156, 285, 25, 60, 10, ["VEN-009"]),
  product("PRD-021", "LUB-GRS-EP2", "EP2 Lithium Grease 18kg", "lubricants", "each", 84, 155, 30, 80, 10, ["VEN-010"]),
  product("PRD-022", "LUB-HYD-46", "Hydraulic Oil ISO 46 (208L drum)", "lubricants", "each", 392, 690, 10, 24, 14, ["VEN-010"]),
];

export const warehouses: Warehouse[] = [
  {
    id: "WH-001",
    code: "NORTH",
    name: "Warehouse North",
    type: "distribution",
    address: address("4400 Corporate Parkway Dock A", "Columbus", "OH", "43219"),
    managerUserId: "USR-005",
    isActive: true,
  },
  {
    id: "WH-002",
    code: "SOUTH",
    name: "Warehouse South",
    type: "distribution",
    address: address("1900 Stemmons Freeway", "Dallas", "TX", "75207"),
    managerUserId: "USR-013",
    isActive: true,
  },
  {
    id: "WH-003",
    code: "WEST",
    name: "West Coast Hub",
    type: "distribution",
    address: address("300 Vista Industrial Way", "Reno", "NV", "89506"),
    managerUserId: "USR-013",
    isActive: true,
  },
  {
    id: "WH-004",
    code: "CENTRAL",
    name: "Central Overflow Store",
    type: "overflow",
    address: address("715 Rail Spur Road", "Kansas City", "MO", "64120"),
    managerUserId: "USR-005",
    isActive: true,
  },
];

function stock(
  productId: string,
  warehouseId: string,
  quantityOnHand: number,
  quantityReserved: number,
  quantityInbound: number,
  binLocation: string,
  reorderPoint: number | null = null,
): InventoryRecord {
  return {
    id: inventoryId(productId, warehouseId),
    productId,
    warehouseId,
    quantityOnHand,
    quantityReserved,
    quantityInbound,
    binLocation,
    reorderPoint,
    lastCountedAt: "2026-02-28T00:00:00.000Z",
  };
}

/**
 * `quantityReserved` matches open sales-order reservations and `quantityInbound`
 * matches outstanding quantities on purchase orders that have been sent to a
 * vendor. Draft, pending-approval and cancelled POs contribute no inbound stock.
 */
export const inventory: InventoryRecord[] = [
  stock("PRD-001", "WH-001", 1240, 0, 0, "A-01-02"),
  stock("PRD-002", "WH-001", 420, 0, 0, "A-01-06"),
  stock("PRD-003", "WH-001", 60, 0, 0, "A-02-01"),
  stock("PRD-004", "WH-001", 900, 0, 0, "B-01-04"),
  stock("PRD-005", "WH-001", 310, 0, 0, "B-01-08"),
  stock("PRD-006", "WH-001", 640, 0, 0, "B-02-02"),
  stock("PRD-007", "WH-001", 31, 0, 15, "C-01-01"),
  stock("PRD-008", "WH-001", 1150, 0, 0, "C-01-05"),
  stock("PRD-009", "WH-001", 14, 0, 0, "C-02-03"),
  stock("PRD-010", "WH-001", 620, 0, 0, "D-01-02"),
  stock("PRD-011", "WH-001", 180, 0, 0, "D-01-07"),
  stock("PRD-012", "WH-001", 22, 0, 0, "D-02-04"),
  stock("PRD-013", "WH-001", 140, 0, 0, "E-01-03"),
  stock("PRD-014", "WH-001", 9, 0, 0, "E-02-01"),
  stock("PRD-015", "WH-001", 2400, 0, 0, "E-03-06"),
  stock("PRD-016", "WH-001", 26, 0, 0, "F-01-02"),
  stock("PRD-017", "WH-001", 74, 0, 0, "F-01-05"),
  stock("PRD-018", "WH-001", 210, 0, 0, "F-02-08"),
  stock("PRD-019", "WH-001", 15, 0, 0, "G-01-01"),
  stock("PRD-020", "WH-001", 8, 0, 0, "G-01-04"),
  stock("PRD-021", "WH-001", 46, 0, 0, "H-01-02"),
  stock("PRD-022", "WH-001", 18, 0, 0, "H-01-06"),

  stock("PRD-001", "WH-002", 380, 0, 0, "A-01-01"),
  stock("PRD-002", "WH-002", 150, 0, 0, "A-01-04"),
  stock("PRD-003", "WH-002", 120, 0, 0, "A-02-02"),
  stock("PRD-004", "WH-002", 265, 40, 150, "B-01-03"),
  stock("PRD-005", "WH-002", 140, 0, 0, "B-01-07"),
  stock("PRD-006", "WH-002", 520, 0, 0, "B-02-01"),
  stock("PRD-008", "WH-002", 340, 0, 0, "C-01-04"),
  stock("PRD-010", "WH-002", 40, 0, 0, "D-01-01"),
  stock("PRD-012", "WH-002", 65, 0, 0, "D-02-03"),
  stock("PRD-013", "WH-002", 60, 0, 0, "E-01-02"),
  stock("PRD-015", "WH-002", 900, 0, 0, "E-03-04"),
  stock("PRD-017", "WH-002", 28, 0, 0, "F-01-06"),
  stock("PRD-018", "WH-002", 95, 0, 0, "F-02-05"),
  stock("PRD-020", "WH-002", 34, 0, 0, "G-01-03"),
  stock("PRD-021", "WH-002", 96, 0, 0, "H-01-01"),
  stock("PRD-022", "WH-002", 4, 0, 0, "H-01-05"),

  // The West Coast hub is smaller than the two main distribution centres, so it
  // overrides the product-level reorder points with its own lower thresholds.
  stock("PRD-001", "WH-003", 260, 0, 0, "A-01-03", 100),
  stock("PRD-003", "WH-003", 35, 0, 0, "A-02-04", 25),
  stock("PRD-007", "WH-003", 12, 0, 0, "C-01-02", 8),
  stock("PRD-008", "WH-003", 180, 0, 0, "C-01-06", 120),
  stock("PRD-013", "WH-003", 20, 0, 120, "E-01-05", 15),
  stock("PRD-014", "WH-003", 10, 8, 0, "E-02-02", 4),
  stock("PRD-015", "WH-003", 450, 0, 2000, "E-03-01", 300),
  stock("PRD-016", "WH-003", 11, 0, 0, "F-01-03", 15),
  stock("PRD-020", "WH-003", 19, 0, 0, "G-01-02", 12),
  stock("PRD-021", "WH-003", 22, 0, 0, "H-01-03", 15),

  // Overflow storage is not replenished directly, so nothing here is ever "low".
  stock("PRD-001", "WH-004", 500, 0, 0, "OVF-A-1", 0),
  stock("PRD-004", "WH-004", 240, 0, 0, "OVF-B-2", 0),
  stock("PRD-010", "WH-004", 300, 0, 0, "OVF-D-1", 0),
  stock("PRD-015", "WH-004", 1200, 0, 0, "OVF-E-3", 0),
  stock("PRD-018", "WH-004", 160, 0, 0, "OVF-F-2", 0),
  stock("PRD-022", "WH-004", 12, 0, 0, "OVF-H-1", 0),
];

export const requisitions: PurchaseRequisition[] = [
  {
    id: "PR-001",
    number: "PR-001",
    requesterUserId: "USR-004",
    departmentId: "DEPT-OPS",
    status: "converted",
    lines: [
      {
        id: "PR-001-L1",
        productId: "PRD-001",
        quantity: 500,
        estimatedUnitPrice: usd(4.25),
        neededBy: "2026-03-01T00:00:00.000Z",
      },
      {
        id: "PR-001-L2",
        productId: "PRD-002",
        quantity: 300,
        estimatedUnitPrice: usd(11.8),
        neededBy: "2026-03-01T00:00:00.000Z",
      },
    ],
    justification: "Bearing stock at Warehouse North is below reorder point.",
    estimatedTotal: usd(5665),
    budgetId: "BUD-002",
    createdAt: "2026-02-02T10:15:00.000Z",
    submittedAt: "2026-02-02T14:40:00.000Z",
    decidedAt: "2026-02-04T09:20:00.000Z",
    approvalId: "APR-001",
    rfqId: "RFQ-001",
    purchaseOrderId: "PO-201",
  },
  {
    id: "PR-002",
    number: "PR-002",
    requesterUserId: "USR-011",
    departmentId: "DEPT-FAC",
    status: "pending_approval",
    lines: [
      {
        id: "PR-002-L1",
        productId: "PRD-020",
        quantity: 25,
        estimatedUnitPrice: usd(156),
        neededBy: "2026-04-01T00:00:00.000Z",
      },
    ],
    justification: "Q2 PPE replenishment for the maintenance crews.",
    estimatedTotal: usd(3900),
    budgetId: "BUD-004",
    createdAt: "2026-03-10T08:05:00.000Z",
    submittedAt: "2026-03-10T08:30:00.000Z",
    decidedAt: null,
    approvalId: "APR-002",
    rfqId: null,
    purchaseOrderId: null,
  },
  {
    id: "PR-003",
    number: "PR-003",
    requesterUserId: "USR-004",
    departmentId: "DEPT-OPS",
    status: "approved",
    lines: [
      {
        id: "PR-003-L1",
        productId: "PRD-008",
        quantity: 600,
        estimatedUnitPrice: usd(6.75),
        neededBy: "2026-04-10T00:00:00.000Z",
      },
      {
        id: "PR-003-L2",
        productId: "PRD-010",
        quantity: 500,
        estimatedUnitPrice: usd(7.1),
        neededBy: "2026-04-10T00:00:00.000Z",
      },
    ],
    justification: "Hose and belt consumables for the spring maintenance window.",
    estimatedTotal: usd(7600),
    budgetId: "BUD-002",
    createdAt: "2026-02-24T11:00:00.000Z",
    submittedAt: "2026-02-24T11:25:00.000Z",
    decidedAt: "2026-02-25T15:10:00.000Z",
    approvalId: "APR-003",
    rfqId: "RFQ-002",
    purchaseOrderId: null,
  },
  {
    id: "PR-004",
    number: "PR-004",
    requesterUserId: "USR-001",
    departmentId: "DEPT-IT",
    status: "rejected",
    lines: [
      {
        id: "PR-004-L1",
        productId: "PRD-014",
        quantity: 10,
        estimatedUnitPrice: usd(615),
        neededBy: "2026-03-20T00:00:00.000Z",
      },
    ],
    justification: "Drive replacements for the conveyor control retrofit.",
    estimatedTotal: usd(6150),
    budgetId: "BUD-003",
    createdAt: "2026-02-18T09:45:00.000Z",
    submittedAt: "2026-02-18T10:00:00.000Z",
    decidedAt: "2026-02-19T13:35:00.000Z",
    approvalId: "APR-004",
    rfqId: null,
    purchaseOrderId: null,
  },
  {
    id: "PR-005",
    number: "PR-005",
    requesterUserId: "USR-009",
    departmentId: "DEPT-SALES",
    status: "draft",
    lines: [
      {
        id: "PR-005-L1",
        productId: "PRD-016",
        quantity: 5,
        estimatedUnitPrice: usd(178),
        neededBy: "2026-04-15T00:00:00.000Z",
      },
    ],
    justification: "Demo tools for the regional trade show.",
    estimatedTotal: usd(890),
    budgetId: "BUD-005",
    createdAt: "2026-03-13T16:20:00.000Z",
    submittedAt: null,
    decidedAt: null,
    approvalId: null,
    rfqId: null,
    purchaseOrderId: null,
  },
  {
    id: "PR-006",
    number: "PR-006",
    requesterUserId: "USR-005",
    departmentId: "DEPT-OPS",
    status: "pending_approval",
    lines: [
      {
        id: "PR-006-L1",
        productId: "PRD-014",
        quantity: 120,
        estimatedUnitPrice: usd(615),
        neededBy: "2026-05-01T00:00:00.000Z",
      },
      {
        id: "PR-006-L2",
        productId: "PRD-009",
        quantity: 200,
        estimatedUnitPrice: usd(512),
        neededBy: "2026-05-01T00:00:00.000Z",
      },
    ],
    justification: "Capital spares package for the Reno automation programme.",
    estimatedTotal: usd(176_200),
    budgetId: "BUD-002",
    createdAt: "2026-03-12T07:50:00.000Z",
    submittedAt: "2026-03-12T08:10:00.000Z",
    decidedAt: null,
    approvalId: "APR-005",
    rfqId: null,
    purchaseOrderId: null,
  },
];

function approval(
  id: string,
  entityType: Approval["entityType"],
  entityId: string,
  status: Approval["status"],
  requestedByUserId: string,
  assignedToUserId: string,
  amount: number | null,
  requestedAt: string,
  decidedAt: string | null,
  decidedByUserId: string | null,
  notes: string[] = [],
): Approval {
  return {
    id,
    entityType,
    entityId,
    status,
    requestedByUserId,
    assignedToUserId,
    amount: amount === null ? null : usd(amount),
    requestedAt,
    decidedAt,
    decidedByUserId,
    notes,
  };
}

export const approvals: Approval[] = [
  approval("APR-001", "requisition", "PR-001", "approved", "USR-004", "USR-003", 5665, "2026-02-02T14:40:00.000Z", "2026-02-04T09:20:00.000Z", "USR-003", ["Within MRO budget."]),
  approval("APR-002", "requisition", "PR-002", "pending", "USR-011", "USR-003", 3900, "2026-03-10T08:30:00.000Z", null, null, []),
  approval("APR-003", "requisition", "PR-003", "approved", "USR-004", "USR-003", 7600, "2026-02-24T11:25:00.000Z", "2026-02-25T15:10:00.000Z", "USR-003", ["Go to market for competitive quotes."]),
  approval("APR-004", "requisition", "PR-004", "rejected", "USR-001", "USR-008", 6150, "2026-02-18T10:00:00.000Z", "2026-02-19T13:35:00.000Z", "USR-008", ["Deferred to Q3; retrofit schedule moved."]),
  approval("APR-005", "requisition", "PR-006", "pending", "USR-005", "USR-003", 176_200, "2026-03-12T08:10:00.000Z", null, null, ["Exceeds procurement manager limit; needs controller sign-off."]),
  approval("APR-006", "purchase_order", "PO-201", "approved", "USR-002", "USR-003", 5907.6, "2026-02-13T13:05:00.000Z", "2026-02-14T08:40:00.000Z", "USR-003", []),
  approval("APR-007", "purchase_order", "PO-202", "approved", "USR-002", "USR-003", 14_731.2, "2026-02-20T10:20:00.000Z", "2026-02-21T09:05:00.000Z", "USR-003", []),
  approval("APR-008", "purchase_order", "PO-203", "approved", "USR-002", "USR-003", 8002.8, "2026-02-25T14:10:00.000Z", "2026-02-26T08:55:00.000Z", "USR-003", []),
  approval("APR-009", "purchase_order", "PO-204", "approved", "USR-002", "USR-003", 10_346.4, "2026-03-02T11:30:00.000Z", "2026-03-03T10:15:00.000Z", "USR-003", []),
  approval("APR-010", "purchase_order", "PO-205", "pending", "USR-002", "USR-003", 14_763.6, "2026-03-11T15:45:00.000Z", null, null, []),
  approval("APR-011", "purchase_order", "PO-206", "approved", "USR-002", "USR-003", 7084.8, "2026-02-27T09:10:00.000Z", "2026-02-28T08:30:00.000Z", "USR-003", []),
  approval("APR-012", "purchase_order", "PO-207", "approved", "USR-002", "USR-003", 4989.6, "2026-02-24T10:05:00.000Z", "2026-02-25T09:40:00.000Z", "USR-003", []),
  approval("APR-013", "purchase_order", "PO-208", "approved", "USR-002", "USR-003", 5637.6, "2026-03-13T09:25:00.000Z", "2026-03-14T08:15:00.000Z", "USR-003", []),
  approval("APR-014", "purchase_order", "PO-209", "approved", "USR-002", "USR-003", 5076, "2026-02-26T13:50:00.000Z", "2026-02-27T08:20:00.000Z", "USR-003", []),
  approval("APR-015", "vendor_invoice", "VINV-101", "approved", "USR-006", "USR-007", 5907.6, "2026-02-26T10:00:00.000Z", "2026-02-27T11:20:00.000Z", "USR-007", ["Three-way match clean."]),
  approval("APR-016", "vendor_invoice", "VINV-102", "approved", "USR-006", "USR-007", 10_775.16, "2026-03-11T09:30:00.000Z", "2026-03-12T10:05:00.000Z", "USR-007", ["Damaged hose credited by vendor."]),
  approval("APR-017", "vendor_invoice", "VINV-103", "pending", "USR-006", "USR-007", 7430.4, "2026-03-10T14:15:00.000Z", null, null, ["Blocked: unit price above purchase order price."]),
  approval("APR-018", "vendor_invoice", "VINV-104", "pending", "USR-006", "USR-007", 8002.8, "2026-03-10T15:00:00.000Z", null, null, ["Blocked: invoiced quantity exceeds received quantity."]),
  approval("APR-019", "vendor_invoice", "VINV-107", "approved", "USR-006", "USR-007", 5076, "2026-03-05T09:45:00.000Z", "2026-03-06T09:10:00.000Z", "USR-007", []),
  approval("APR-020", "vendor_invoice", "VINV-108", "approved", "USR-006", "USR-007", 2527.2, "2026-01-27T10:30:00.000Z", "2026-01-28T09:00:00.000Z", "USR-007", ["Non-PO freight invoice; coded to logistics."]),
  approval("APR-021", "payment", "PAY-002", "pending", "USR-006", "USR-008", 10_775.16, "2026-03-13T11:00:00.000Z", null, null, []),
  approval("APR-022", "expense", "EXP-001", "approved", "USR-002", "USR-008", 1240, "2026-02-06T08:20:00.000Z", "2026-02-09T10:45:00.000Z", "USR-008", []),
  approval("APR-023", "expense", "EXP-002", "pending", "USR-011", "USR-008", 480, "2026-03-12T13:40:00.000Z", null, null, []),
  approval("APR-024", "expense", "EXP-003", "approved", "USR-009", "USR-008", 865.5, "2026-03-04T16:05:00.000Z", "2026-03-05T09:30:00.000Z", "USR-008", []),
  approval("APR-025", "expense", "EXP-005", "rejected", "USR-006", "USR-008", 320, "2026-02-20T11:15:00.000Z", "2026-02-21T09:50:00.000Z", "USR-008", ["Duplicate of EXP-001 travel claim."]),
];

/** Sales tax applied to purchase orders, vendor invoices and customer invoices. */
export const TAX_RATE = 0.08;

export const rfqs: Rfq[] = [
  {
    id: "RFQ-001",
    number: "RFQ-001",
    title: "Bearing replenishment — Warehouse North",
    status: "awarded",
    requisitionId: "PR-001",
    lines: [
      { id: "RFQ-001-L1", productId: "PRD-001", quantity: 500 },
      { id: "RFQ-001-L2", productId: "PRD-002", quantity: 300 },
    ],
    invitedVendorIds: ["VEN-001", "VEN-006", "VEN-012"],
    issuedByUserId: "USR-002",
    createdAt: "2026-02-04T10:00:00.000Z",
    sentAt: "2026-02-05T09:00:00.000Z",
    responseDueDate: "2026-02-12T17:00:00.000Z",
    closedAt: "2026-02-13T09:30:00.000Z",
    awardedQuotationId: "QUO-001",
  },
  {
    id: "RFQ-002",
    number: "RFQ-002",
    title: "Hose and belt consumables — spring maintenance",
    status: "closed",
    requisitionId: "PR-003",
    lines: [
      { id: "RFQ-002-L1", productId: "PRD-008", quantity: 600 },
      { id: "RFQ-002-L2", productId: "PRD-010", quantity: 500 },
    ],
    invitedVendorIds: ["VEN-003", "VEN-004", "VEN-012"],
    issuedByUserId: "USR-002",
    createdAt: "2026-03-02T09:15:00.000Z",
    sentAt: "2026-03-03T08:45:00.000Z",
    responseDueDate: "2026-03-13T17:00:00.000Z",
    closedAt: "2026-03-14T10:00:00.000Z",
    awardedQuotationId: null,
  },
  {
    id: "RFQ-003",
    number: "RFQ-003",
    title: "Control panel components — Reno retrofit",
    status: "sent",
    requisitionId: null,
    lines: [
      { id: "RFQ-003-L1", productId: "PRD-013", quantity: 120 },
      { id: "RFQ-003-L2", productId: "PRD-015", quantity: 2000 },
    ],
    invitedVendorIds: ["VEN-005", "VEN-012"],
    issuedByUserId: "USR-002",
    createdAt: "2026-03-09T11:20:00.000Z",
    sentAt: "2026-03-10T09:00:00.000Z",
    responseDueDate: "2026-03-20T17:00:00.000Z",
    closedAt: null,
    awardedQuotationId: null,
  },
  {
    id: "RFQ-004",
    number: "RFQ-004",
    title: "Hydraulic oil restock — Warehouse South",
    status: "draft",
    requisitionId: null,
    lines: [{ id: "RFQ-004-L1", productId: "PRD-022", quantity: 24 }],
    invitedVendorIds: ["VEN-010"],
    issuedByUserId: "USR-002",
    createdAt: "2026-03-15T14:30:00.000Z",
    sentAt: null,
    responseDueDate: "2026-03-27T17:00:00.000Z",
    closedAt: null,
    awardedQuotationId: null,
  },
];

function quotation(
  id: string,
  rfqId: string,
  vendorId: string,
  status: Quotation["status"],
  lines: Array<[productId: string, quantity: number, unitPrice: number]>,
  leadTimeDays: number,
  validUntil: string,
  receivedAt: string,
  notes: string,
): Quotation {
  const quotationLines = lines.map(([productId, quantity, unitPrice], index) => ({
    id: `${id}-L${index + 1}`,
    productId,
    quantity,
    unitPrice: usd(unitPrice),
    lineTotal: usd(quantity * unitPrice),
  }));

  const subtotal = usd(
    quotationLines.reduce((total, line) => total + line.lineTotal.amount, 0),
  );

  return {
    id,
    number: id,
    rfqId,
    vendorId,
    status,
    lines: quotationLines,
    subtotal,
    totalAmount: subtotal,
    leadTimeDays,
    validUntil,
    receivedAt,
    notes,
  };
}

/**
 * RFQ-002 is the interesting one: QUO-005 is the cheapest but expired before the
 * simulated clock, so the cheapest *valid* quotation is QUO-006.
 */
export const quotations: Quotation[] = [
  quotation("QUO-001", "RFQ-001", "VEN-001", "accepted", [["PRD-001", 500, 4.1], ["PRD-002", 300, 11.4]], 7, "2026-03-31T00:00:00.000Z", "2026-02-10T11:00:00.000Z", "Awarded; stock held for immediate release."),
  quotation("QUO-002", "RFQ-001", "VEN-006", "rejected", [["PRD-001", 500, 4.35], ["PRD-002", 300, 11.9]], 10, "2026-03-15T00:00:00.000Z", "2026-02-09T15:20:00.000Z", "Higher unit pricing on both lines."),
  quotation("QUO-003", "RFQ-001", "VEN-012", "rejected", [["PRD-001", 500, 4.05], ["PRD-002", 300, 12.6]], 21, "2026-03-20T00:00:00.000Z", "2026-02-11T09:40:00.000Z", "Cheapest on PRD-001 but highest overall and longest lead time."),
  quotation("QUO-004", "RFQ-002", "VEN-003", "received", [["PRD-008", 600, 6.4], ["PRD-010", 500, 7.05]], 14, "2026-04-15T00:00:00.000Z", "2026-03-09T10:10:00.000Z", "Standard terms, stock on hand."),
  quotation("QUO-005", "RFQ-002", "VEN-004", "expired", [["PRD-008", 600, 6.25], ["PRD-010", 500, 6.9]], 30, "2026-03-14T00:00:00.000Z", "2026-03-08T16:45:00.000Z", "Lowest total but validity lapsed on 2026-03-14."),
  quotation("QUO-006", "RFQ-002", "VEN-012", "received", [["PRD-008", 600, 6.55], ["PRD-010", 500, 6.8]], 12, "2026-04-10T00:00:00.000Z", "2026-03-11T13:25:00.000Z", "Cheapest quotation still valid at the current date."),
  quotation("QUO-007", "RFQ-003", "VEN-005", "received", [["PRD-013", 120, 41], ["PRD-015", 2000, 2.28]], 10, "2026-04-20T00:00:00.000Z", "2026-03-13T10:50:00.000Z", "Awaiting second response from VEN-012."),
];

type PurchaseOrderLineSpec = {
  productId: string;
  description: string;
  ordered: number;
  unitPrice: number;
  expectedDate: string;
  received?: number;
  rejected?: number;
  invoiced?: number;
};

type PurchaseOrderSpec = {
  id: string;
  vendorId: string;
  status: PurchaseOrder["status"];
  warehouseId: string;
  lines: PurchaseOrderLineSpec[];
  paymentTerms: PurchaseOrder["paymentTerms"];
  createdByUserId: string;
  createdAt: string;
  expectedDeliveryDate: string;
  requisitionId?: string;
  quotationId?: string;
  budgetId?: string;
  approvalId?: string;
  approvedAt?: string;
  approvedByUserId?: string;
  sentAt?: string;
  closedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
};

function purchaseOrder(spec: PurchaseOrderSpec): PurchaseOrder {
  const lines = spec.lines.map((line, index) => ({
    id: `${spec.id}-L${index + 1}`,
    productId: line.productId,
    description: line.description,
    quantityOrdered: line.ordered,
    quantityReceived: line.received ?? 0,
    quantityRejected: line.rejected ?? 0,
    quantityInvoiced: line.invoiced ?? 0,
    unitPrice: usd(line.unitPrice),
    lineTotal: usd(line.ordered * line.unitPrice),
    expectedDate: line.expectedDate,
  }));

  const subtotal = usd(lines.reduce((total, line) => total + line.lineTotal.amount, 0));
  const taxAmount = usd(subtotal.amount * TAX_RATE);

  return {
    id: spec.id,
    number: spec.id,
    vendorId: spec.vendorId,
    status: spec.status,
    lines,
    warehouseId: spec.warehouseId,
    currency: "USD",
    subtotal,
    taxAmount,
    totalAmount: usd(subtotal.amount + taxAmount.amount),
    requisitionId: spec.requisitionId ?? null,
    quotationId: spec.quotationId ?? null,
    budgetId: spec.budgetId ?? null,
    paymentTerms: spec.paymentTerms,
    createdByUserId: spec.createdByUserId,
    createdAt: spec.createdAt,
    approvalId: spec.approvalId ?? null,
    approvedAt: spec.approvedAt ?? null,
    approvedByUserId: spec.approvedByUserId ?? null,
    sentAt: spec.sentAt ?? null,
    expectedDeliveryDate: spec.expectedDeliveryDate,
    closedAt: spec.closedAt ?? null,
    cancelledAt: spec.cancelledAt ?? null,
    cancelReason: spec.cancelReason ?? null,
  };
}

export const purchaseOrders: PurchaseOrder[] = [
  purchaseOrder({
    id: "PO-201",
    vendorId: "VEN-001",
    status: "closed",
    warehouseId: "WH-001",
    paymentTerms: "NET_30",
    createdByUserId: "USR-002",
    createdAt: "2026-02-13T13:00:00.000Z",
    expectedDeliveryDate: "2026-02-24T00:00:00.000Z",
    requisitionId: "PR-001",
    quotationId: "QUO-001",
    budgetId: "BUD-002",
    approvalId: "APR-006",
    approvedAt: "2026-02-14T08:40:00.000Z",
    approvedByUserId: "USR-003",
    sentAt: "2026-02-14T09:15:00.000Z",
    closedAt: "2026-03-06T16:00:00.000Z",
    lines: [
      { productId: "PRD-001", description: "Deep Groove Ball Bearing 6205-2RS", ordered: 500, unitPrice: 4.1, received: 500, invoiced: 500, expectedDate: "2026-02-24T00:00:00.000Z" },
      { productId: "PRD-002", description: "Tapered Roller Bearing 30206", ordered: 300, unitPrice: 11.4, received: 300, invoiced: 300, expectedDate: "2026-02-24T00:00:00.000Z" },
    ],
  }),
  purchaseOrder({
    id: "PO-202",
    vendorId: "VEN-003",
    status: "partially_received",
    warehouseId: "WH-001",
    paymentTerms: "NET_30",
    createdByUserId: "USR-002",
    createdAt: "2026-02-20T10:15:00.000Z",
    expectedDeliveryDate: "2026-03-10T00:00:00.000Z",
    budgetId: "BUD-002",
    approvalId: "APR-007",
    approvedAt: "2026-02-21T09:05:00.000Z",
    approvedByUserId: "USR-003",
    sentAt: "2026-02-21T09:50:00.000Z",
    lines: [
      { productId: "PRD-007", description: "Hydraulic Cylinder 50mm Bore", ordered: 40, unitPrice: 242, received: 25, invoiced: 25, expectedDate: "2026-03-10T00:00:00.000Z" },
      { productId: "PRD-008", description: "Hydraulic Hose 1/2in R2", ordered: 600, unitPrice: 6.6, received: 595, rejected: 5, invoiced: 595, expectedDate: "2026-03-10T00:00:00.000Z" },
    ],
  }),
  purchaseOrder({
    id: "PO-203",
    vendorId: "VEN-002",
    status: "partially_received",
    warehouseId: "WH-002",
    paymentTerms: "NET_45",
    createdByUserId: "USR-002",
    createdAt: "2026-02-25T14:05:00.000Z",
    expectedDeliveryDate: "2026-03-08T00:00:00.000Z",
    budgetId: "BUD-002",
    approvalId: "APR-008",
    approvedAt: "2026-02-26T08:55:00.000Z",
    approvedByUserId: "USR-003",
    sentAt: "2026-02-26T09:30:00.000Z",
    lines: [
      { productId: "PRD-004", description: "Hex Bolt M8x40 Zinc (box of 100)", ordered: 400, unitPrice: 11.7, received: 250, invoiced: 400, expectedDate: "2026-03-08T00:00:00.000Z" },
      { productId: "PRD-006", description: "Nylon Lock Nut M8 (box of 200)", ordered: 300, unitPrice: 9.1, received: 300, invoiced: 300, expectedDate: "2026-03-08T00:00:00.000Z" },
    ],
  }),
  purchaseOrder({
    id: "PO-204",
    vendorId: "VEN-005",
    status: "sent",
    warehouseId: "WH-003",
    paymentTerms: "NET_30",
    createdByUserId: "USR-002",
    createdAt: "2026-03-02T11:25:00.000Z",
    expectedDeliveryDate: "2026-03-24T00:00:00.000Z",
    budgetId: "BUD-002",
    approvalId: "APR-009",
    approvedAt: "2026-03-03T10:15:00.000Z",
    approvedByUserId: "USR-003",
    sentAt: "2026-03-03T11:00:00.000Z",
    lines: [
      { productId: "PRD-013", description: "Contactor 32A 3-Pole", ordered: 120, unitPrice: 41.5, expectedDate: "2026-03-24T00:00:00.000Z" },
      { productId: "PRD-015", description: "Control Cable 4-Core", ordered: 2000, unitPrice: 2.3, expectedDate: "2026-03-24T00:00:00.000Z" },
    ],
  }),
  purchaseOrder({
    id: "PO-205",
    vendorId: "VEN-004",
    status: "pending_approval",
    warehouseId: "WH-001",
    paymentTerms: "NET_60",
    createdByUserId: "USR-002",
    createdAt: "2026-03-11T15:40:00.000Z",
    expectedDeliveryDate: "2026-04-10T00:00:00.000Z",
    budgetId: "BUD-001",
    approvalId: "APR-010",
    lines: [
      { productId: "PRD-011", description: "Timing Belt 8M-1600", ordered: 150, unitPrice: 33.8, expectedDate: "2026-04-10T00:00:00.000Z" },
      { productId: "PRD-012", description: "Roller Chain RC80 (10ft)", ordered: 100, unitPrice: 86, expectedDate: "2026-04-10T00:00:00.000Z" },
    ],
  }),
  purchaseOrder({
    id: "PO-206",
    vendorId: "VEN-010",
    status: "received",
    warehouseId: "WH-002",
    paymentTerms: "NET_45",
    createdByUserId: "USR-002",
    createdAt: "2026-02-27T09:05:00.000Z",
    expectedDeliveryDate: "2026-03-09T00:00:00.000Z",
    budgetId: "BUD-002",
    approvalId: "APR-011",
    approvedAt: "2026-02-28T08:30:00.000Z",
    approvedByUserId: "USR-003",
    sentAt: "2026-02-28T09:00:00.000Z",
    lines: [
      { productId: "PRD-021", description: "EP2 Lithium Grease 18kg", ordered: 80, unitPrice: 82, received: 80, invoiced: 80, expectedDate: "2026-03-09T00:00:00.000Z" },
    ],
  }),
  purchaseOrder({
    id: "PO-207",
    vendorId: "VEN-009",
    status: "cancelled",
    warehouseId: "WH-001",
    paymentTerms: "NET_30",
    createdByUserId: "USR-002",
    createdAt: "2026-02-24T10:00:00.000Z",
    expectedDeliveryDate: "2026-03-12T00:00:00.000Z",
    budgetId: "BUD-004",
    approvalId: "APR-012",
    approvedAt: "2026-02-25T09:40:00.000Z",
    approvedByUserId: "USR-003",
    sentAt: "2026-02-25T10:10:00.000Z",
    cancelledAt: "2026-03-05T11:30:00.000Z",
    cancelReason: "Facilities withdrew the requirement; stock covered by transfer.",
    lines: [
      { productId: "PRD-020", description: "Cut-Resistant Gloves Level 5 (case of 60)", ordered: 30, unitPrice: 154, invoiced: 30, expectedDate: "2026-03-12T00:00:00.000Z" },
    ],
  }),
  purchaseOrder({
    id: "PO-208",
    vendorId: "VEN-006",
    status: "approved",
    warehouseId: "WH-001",
    paymentTerms: "NET_15",
    createdByUserId: "USR-002",
    createdAt: "2026-03-13T09:20:00.000Z",
    expectedDeliveryDate: "2026-03-30T00:00:00.000Z",
    budgetId: "BUD-001",
    approvalId: "APR-013",
    approvedAt: "2026-03-14T08:15:00.000Z",
    approvedByUserId: "USR-003",
    lines: [
      { productId: "PRD-016", description: "Impact Wrench 1/2in", ordered: 30, unitPrice: 174, expectedDate: "2026-03-30T00:00:00.000Z" },
    ],
  }),
  purchaseOrder({
    id: "PO-209",
    vendorId: "VEN-006",
    status: "received",
    warehouseId: "WH-001",
    paymentTerms: "NET_15",
    createdByUserId: "USR-002",
    createdAt: "2026-02-26T13:45:00.000Z",
    expectedDeliveryDate: "2026-03-04T00:00:00.000Z",
    budgetId: "BUD-001",
    approvalId: "APR-014",
    approvedAt: "2026-02-27T08:20:00.000Z",
    approvedByUserId: "USR-003",
    sentAt: "2026-02-27T08:55:00.000Z",
    lines: [
      { productId: "PRD-017", description: "Torque Wrench 200Nm", ordered: 50, unitPrice: 94, received: 50, invoiced: 50, expectedDate: "2026-03-04T00:00:00.000Z" },
    ],
  }),
];

export const goodsReceipts: GoodsReceipt[] = [
  {
    id: "GR-001",
    number: "GR-001",
    purchaseOrderId: "PO-201",
    warehouseId: "WH-001",
    status: "posted",
    lines: [
      { id: "GR-001-L1", purchaseOrderLineId: "PO-201-L1", productId: "PRD-001", quantityReceived: 500, quantityRejected: 0, note: "" },
      { id: "GR-001-L2", purchaseOrderLineId: "PO-201-L2", productId: "PRD-002", quantityReceived: 300, quantityRejected: 0, note: "" },
    ],
    deliveryNote: "KBW-DN-77412",
    receivedByUserId: "USR-004",
    receivedAt: "2026-02-23T13:20:00.000Z",
    postedAt: "2026-02-23T13:45:00.000Z",
    cancelledAt: null,
  },
  {
    id: "GR-002",
    number: "GR-002",
    purchaseOrderId: "PO-202",
    warehouseId: "WH-001",
    status: "posted",
    lines: [
      { id: "GR-002-L1", purchaseOrderLineId: "PO-202-L1", productId: "PRD-007", quantityReceived: 25, quantityRejected: 0, note: "Balance of 15 cylinders still outstanding." },
      { id: "GR-002-L2", purchaseOrderLineId: "PO-202-L2", productId: "PRD-008", quantityReceived: 595, quantityRejected: 5, note: "Five metres crushed in transit." },
    ],
    deliveryNote: "HAL-DN-20881",
    receivedByUserId: "USR-004",
    receivedAt: "2026-03-09T10:05:00.000Z",
    postedAt: "2026-03-09T10:40:00.000Z",
    cancelledAt: null,
  },
  {
    id: "GR-003",
    number: "GR-003",
    purchaseOrderId: "PO-203",
    warehouseId: "WH-002",
    status: "posted",
    lines: [
      { id: "GR-003-L1", purchaseOrderLineId: "PO-203-L1", productId: "PRD-004", quantityReceived: 250, quantityRejected: 0, note: "Short shipment; 150 boxes backordered." },
      { id: "GR-003-L2", purchaseOrderLineId: "PO-203-L2", productId: "PRD-006", quantityReceived: 300, quantityRejected: 0, note: "" },
    ],
    deliveryNote: "TSF-DN-51240",
    receivedByUserId: "USR-012",
    receivedAt: "2026-03-07T09:15:00.000Z",
    postedAt: "2026-03-07T09:50:00.000Z",
    cancelledAt: null,
  },
  {
    id: "GR-004",
    number: "GR-004",
    purchaseOrderId: "PO-206",
    warehouseId: "WH-002",
    status: "posted",
    lines: [
      { id: "GR-004-L1", purchaseOrderLineId: "PO-206-L1", productId: "PRD-021", quantityReceived: 80, quantityRejected: 0, note: "" },
    ],
    deliveryNote: "NFL-DN-33107",
    receivedByUserId: "USR-012",
    receivedAt: "2026-03-08T14:30:00.000Z",
    postedAt: "2026-03-08T15:00:00.000Z",
    cancelledAt: null,
  },
  {
    id: "GR-005",
    number: "GR-005",
    purchaseOrderId: "PO-206",
    warehouseId: "WH-002",
    status: "cancelled",
    lines: [
      { id: "GR-005-L1", purchaseOrderLineId: "PO-206-L1", productId: "PRD-021", quantityReceived: 80, quantityRejected: 0, note: "Duplicate entry of GR-004." },
    ],
    deliveryNote: "NFL-DN-33107",
    receivedByUserId: "USR-012",
    receivedAt: "2026-03-08T15:20:00.000Z",
    postedAt: null,
    cancelledAt: "2026-03-08T15:35:00.000Z",
  },
  {
    id: "GR-006",
    number: "GR-006",
    purchaseOrderId: "PO-209",
    warehouseId: "WH-001",
    status: "posted",
    lines: [
      { id: "GR-006-L1", purchaseOrderLineId: "PO-209-L1", productId: "PRD-017", quantityReceived: 50, quantityRejected: 0, note: "" },
    ],
    deliveryNote: "OKT-DN-90233",
    receivedByUserId: "USR-004",
    receivedAt: "2026-03-03T11:10:00.000Z",
    postedAt: "2026-03-03T11:30:00.000Z",
    cancelledAt: null,
  },
];

export const receivingDiscrepancies: ReceivingDiscrepancy[] = [
  {
    id: "DISC-001",
    goodsReceiptId: "GR-003",
    purchaseOrderId: "PO-203",
    purchaseOrderLineId: "PO-203-L1",
    productId: "PRD-004",
    type: "shortage",
    quantityExpected: 400,
    quantityReceived: 250,
    status: "open",
    reportedByUserId: "USR-012",
    reportedAt: "2026-03-07T09:55:00.000Z",
    resolvedAt: null,
    resolution: null,
  },
  {
    id: "DISC-002",
    goodsReceiptId: "GR-002",
    purchaseOrderId: "PO-202",
    purchaseOrderLineId: "PO-202-L2",
    productId: "PRD-008",
    type: "damage",
    quantityExpected: 600,
    quantityReceived: 595,
    status: "resolved",
    reportedByUserId: "USR-004",
    reportedAt: "2026-03-09T10:45:00.000Z",
    resolvedAt: "2026-03-11T09:20:00.000Z",
    resolution: "Vendor credited the 5 damaged metres on invoice VINV-102.",
  },
];

type VendorInvoiceSpec = {
  id: string;
  vendorInvoiceNumber: string;
  vendorId: string;
  status: VendorInvoice["status"];
  lines: Array<{
    purchaseOrderLineId: string | null;
    productId: string | null;
    description: string;
    quantity: number;
    unitPrice: number;
  }>;
  invoiceDate: string;
  dueDate: string;
  receivedAt: string;
  amountPaid?: number;
  purchaseOrderId?: string;
  goodsReceiptIds?: string[];
  matchId?: string;
  approvalId?: string;
  approvedAt?: string;
  approvedByUserId?: string;
  disputeReason?: string;
  paidAt?: string;
};

function vendorInvoice(spec: VendorInvoiceSpec): VendorInvoice {
  const lines = spec.lines.map((line, index) => ({
    id: `${spec.id}-L${index + 1}`,
    purchaseOrderLineId: line.purchaseOrderLineId,
    productId: line.productId,
    description: line.description,
    quantity: line.quantity,
    unitPrice: usd(line.unitPrice),
    lineTotal: usd(line.quantity * line.unitPrice),
  }));

  const subtotal = usd(lines.reduce((total, line) => total + line.lineTotal.amount, 0));
  const taxAmount = usd(subtotal.amount * TAX_RATE);

  return {
    id: spec.id,
    number: spec.id,
    vendorInvoiceNumber: spec.vendorInvoiceNumber,
    vendorId: spec.vendorId,
    purchaseOrderId: spec.purchaseOrderId ?? null,
    goodsReceiptIds: spec.goodsReceiptIds ?? [],
    status: spec.status,
    lines,
    subtotal,
    taxAmount,
    totalAmount: usd(subtotal.amount + taxAmount.amount),
    amountPaid: usd(spec.amountPaid ?? 0),
    invoiceDate: spec.invoiceDate,
    dueDate: spec.dueDate,
    receivedAt: spec.receivedAt,
    matchId: spec.matchId ?? null,
    approvalId: spec.approvalId ?? null,
    approvedAt: spec.approvedAt ?? null,
    approvedByUserId: spec.approvedByUserId ?? null,
    disputeReason: spec.disputeReason ?? null,
    paidAt: spec.paidAt ?? null,
  };
}

export const vendorInvoices: VendorInvoice[] = [
  vendorInvoice({
    id: "VINV-101",
    vendorInvoiceNumber: "KBW-2026-0451",
    vendorId: "VEN-001",
    status: "paid",
    purchaseOrderId: "PO-201",
    goodsReceiptIds: ["GR-001"],
    amountPaid: 5907.6,
    invoiceDate: "2026-02-24T00:00:00.000Z",
    dueDate: "2026-03-26T00:00:00.000Z",
    receivedAt: "2026-02-25T09:00:00.000Z",
    matchId: "MATCH-001",
    approvalId: "APR-015",
    approvedAt: "2026-02-27T11:20:00.000Z",
    approvedByUserId: "USR-007",
    paidAt: "2026-03-06T14:00:00.000Z",
    lines: [
      { purchaseOrderLineId: "PO-201-L1", productId: "PRD-001", description: "Deep Groove Ball Bearing 6205-2RS", quantity: 500, unitPrice: 4.1 },
      { purchaseOrderLineId: "PO-201-L2", productId: "PRD-002", description: "Tapered Roller Bearing 30206", quantity: 300, unitPrice: 11.4 },
    ],
  }),
  vendorInvoice({
    id: "VINV-102",
    vendorInvoiceNumber: "HAL-88231",
    vendorId: "VEN-003",
    status: "approved",
    purchaseOrderId: "PO-202",
    goodsReceiptIds: ["GR-002"],
    invoiceDate: "2026-03-10T00:00:00.000Z",
    dueDate: "2026-04-09T00:00:00.000Z",
    receivedAt: "2026-03-11T08:30:00.000Z",
    matchId: "MATCH-002",
    approvalId: "APR-016",
    approvedAt: "2026-03-12T10:05:00.000Z",
    approvedByUserId: "USR-007",
    lines: [
      { purchaseOrderLineId: "PO-202-L1", productId: "PRD-007", description: "Hydraulic Cylinder 50mm Bore", quantity: 25, unitPrice: 242 },
      { purchaseOrderLineId: "PO-202-L2", productId: "PRD-008", description: "Hydraulic Hose 1/2in R2", quantity: 595, unitPrice: 6.6 },
    ],
  }),
  vendorInvoice({
    id: "VINV-103",
    vendorInvoiceNumber: "NFL-2026-117",
    vendorId: "VEN-010",
    status: "pending_approval",
    purchaseOrderId: "PO-206",
    goodsReceiptIds: ["GR-004"],
    invoiceDate: "2026-03-09T00:00:00.000Z",
    dueDate: "2026-04-23T00:00:00.000Z",
    receivedAt: "2026-03-10T09:40:00.000Z",
    matchId: "MATCH-003",
    approvalId: "APR-017",
    lines: [
      { purchaseOrderLineId: "PO-206-L1", productId: "PRD-021", description: "EP2 Lithium Grease 18kg", quantity: 80, unitPrice: 86 },
    ],
  }),
  vendorInvoice({
    id: "VINV-104",
    vendorInvoiceNumber: "TSF-INV-6620",
    vendorId: "VEN-002",
    status: "pending_approval",
    purchaseOrderId: "PO-203",
    goodsReceiptIds: ["GR-003"],
    invoiceDate: "2026-03-09T00:00:00.000Z",
    dueDate: "2026-04-23T00:00:00.000Z",
    receivedAt: "2026-03-10T10:20:00.000Z",
    matchId: "MATCH-004",
    approvalId: "APR-018",
    lines: [
      { purchaseOrderLineId: "PO-203-L1", productId: "PRD-004", description: "Hex Bolt M8x40 Zinc (box of 100)", quantity: 400, unitPrice: 11.7 },
      { purchaseOrderLineId: "PO-203-L2", productId: "PRD-006", description: "Nylon Lock Nut M8 (box of 200)", quantity: 300, unitPrice: 9.1 },
    ],
  }),
  vendorInvoice({
    id: "VINV-105",
    vendorInvoiceNumber: "RCP-4471",
    vendorId: "VEN-012",
    status: "disputed",
    invoiceDate: "2026-03-05T00:00:00.000Z",
    dueDate: "2026-04-04T00:00:00.000Z",
    receivedAt: "2026-03-06T11:15:00.000Z",
    matchId: "MATCH-005",
    disputeReason: "No purchase order or goods receipt on file for this delivery.",
    lines: [
      { purchaseOrderLineId: null, productId: null, description: "Emergency conveyor roller replacement — Warehouse North", quantity: 1, unitPrice: 1450 },
    ],
  }),
  vendorInvoice({
    id: "VINV-106",
    vendorInvoiceNumber: "SSP-2026-0312",
    vendorId: "VEN-009",
    status: "pending_match",
    purchaseOrderId: "PO-207",
    invoiceDate: "2026-03-02T00:00:00.000Z",
    dueDate: "2026-04-01T00:00:00.000Z",
    receivedAt: "2026-03-03T10:00:00.000Z",
    lines: [
      { purchaseOrderLineId: "PO-207-L1", productId: "PRD-020", description: "Cut-Resistant Gloves Level 5 (case of 60)", quantity: 30, unitPrice: 154 },
    ],
  }),
  vendorInvoice({
    id: "VINV-107",
    vendorInvoiceNumber: "OKT-19945",
    vendorId: "VEN-006",
    status: "approved",
    purchaseOrderId: "PO-209",
    goodsReceiptIds: ["GR-006"],
    invoiceDate: "2026-03-04T00:00:00.000Z",
    dueDate: "2026-03-19T00:00:00.000Z",
    receivedAt: "2026-03-05T08:50:00.000Z",
    matchId: "MATCH-006",
    approvalId: "APR-019",
    approvedAt: "2026-03-06T09:10:00.000Z",
    approvedByUserId: "USR-007",
    lines: [
      { purchaseOrderLineId: "PO-209-L1", productId: "PRD-017", description: "Torque Wrench 200Nm", quantity: 50, unitPrice: 94 },
    ],
  }),
  vendorInvoice({
    id: "VINV-108",
    vendorInvoiceNumber: "TSF-FRT-2211",
    vendorId: "VEN-002",
    status: "approved",
    invoiceDate: "2026-01-20T00:00:00.000Z",
    dueDate: "2026-03-06T00:00:00.000Z",
    receivedAt: "2026-01-26T09:30:00.000Z",
    approvalId: "APR-020",
    approvedAt: "2026-01-28T09:00:00.000Z",
    approvedByUserId: "USR-007",
    lines: [
      { purchaseOrderLineId: null, productId: null, description: "Freight and handling — February inbound shipments", quantity: 1, unitPrice: 2340 },
    ],
  }),
];

const standardTolerance = { pricePercent: 2, quantityPercent: 0 };

export const threeWayMatches: ThreeWayMatch[] = [
  {
    id: "MATCH-001",
    vendorInvoiceId: "VINV-101",
    purchaseOrderId: "PO-201",
    goodsReceiptIds: ["GR-001"],
    status: "matched",
    discrepancies: [],
    tolerance: standardTolerance,
    runAt: "2026-02-26T10:05:00.000Z",
    runByUserId: "USR-006",
  },
  {
    id: "MATCH-002",
    vendorInvoiceId: "VINV-102",
    purchaseOrderId: "PO-202",
    goodsReceiptIds: ["GR-002"],
    status: "matched",
    discrepancies: [],
    tolerance: standardTolerance,
    runAt: "2026-03-11T09:25:00.000Z",
    runByUserId: "USR-006",
  },
  {
    id: "MATCH-003",
    vendorInvoiceId: "VINV-103",
    purchaseOrderId: "PO-206",
    goodsReceiptIds: ["GR-004"],
    status: "failed",
    discrepancies: [
      {
        type: "price",
        purchaseOrderLineId: "PO-206-L1",
        productId: "PRD-021",
        expected: 82,
        actual: 86,
        message: "Invoiced unit price 86.00 exceeds purchase order price 82.00 by 4.88%.",
      },
    ],
    tolerance: standardTolerance,
    runAt: "2026-03-10T14:10:00.000Z",
    runByUserId: "USR-006",
  },
  {
    id: "MATCH-004",
    vendorInvoiceId: "VINV-104",
    purchaseOrderId: "PO-203",
    goodsReceiptIds: ["GR-003"],
    status: "failed",
    discrepancies: [
      {
        type: "quantity",
        purchaseOrderLineId: "PO-203-L1",
        productId: "PRD-004",
        expected: 250,
        actual: 400,
        message: "Invoiced quantity 400 exceeds received quantity 250 on PO-203.",
      },
    ],
    tolerance: standardTolerance,
    runAt: "2026-03-10T14:55:00.000Z",
    runByUserId: "USR-006",
  },
  {
    id: "MATCH-005",
    vendorInvoiceId: "VINV-105",
    purchaseOrderId: null,
    goodsReceiptIds: [],
    status: "failed",
    discrepancies: [
      {
        type: "missing_purchase_order",
        purchaseOrderLineId: null,
        productId: null,
        expected: 0,
        actual: 1566,
        message: "No purchase order or goods receipt could be matched to this invoice.",
      },
    ],
    tolerance: standardTolerance,
    runAt: "2026-03-06T11:30:00.000Z",
    runByUserId: "USR-006",
  },
  {
    id: "MATCH-006",
    vendorInvoiceId: "VINV-107",
    purchaseOrderId: "PO-209",
    goodsReceiptIds: ["GR-006"],
    status: "matched",
    discrepancies: [],
    tolerance: standardTolerance,
    runAt: "2026-03-05T09:40:00.000Z",
    runByUserId: "USR-006",
  },
];

type SalesOrderSpec = {
  id: string;
  customerId: string;
  status: SalesOrder["status"];
  lines: Array<{
    productId: string;
    ordered: number;
    unitPrice: number;
    warehouseId: string;
    reserved?: number;
    fulfilled?: number;
  }>;
  customerPoNumber: string;
  orderDate: string;
  requestedDeliveryDate: string;
  createdByUserId: string;
  confirmedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  closedAt?: string;
};

function salesOrder(spec: SalesOrderSpec): SalesOrder {
  const lines = spec.lines.map((line, index) => ({
    id: `${spec.id}-L${index + 1}`,
    productId: line.productId,
    quantityOrdered: line.ordered,
    quantityReserved: line.reserved ?? 0,
    quantityFulfilled: line.fulfilled ?? 0,
    unitPrice: usd(line.unitPrice),
    lineTotal: usd(line.ordered * line.unitPrice),
    warehouseId: line.warehouseId,
  }));

  const subtotal = usd(lines.reduce((total, line) => total + line.lineTotal.amount, 0));
  const taxAmount = usd(subtotal.amount * TAX_RATE);

  return {
    id: spec.id,
    number: spec.id,
    customerId: spec.customerId,
    status: spec.status,
    lines,
    currency: "USD",
    subtotal,
    taxAmount,
    totalAmount: usd(subtotal.amount + taxAmount.amount),
    customerPoNumber: spec.customerPoNumber,
    orderDate: spec.orderDate,
    requestedDeliveryDate: spec.requestedDeliveryDate,
    createdByUserId: spec.createdByUserId,
    confirmedAt: spec.confirmedAt ?? null,
    cancelledAt: spec.cancelledAt ?? null,
    cancelReason: spec.cancelReason ?? null,
    closedAt: spec.closedAt ?? null,
  };
}

export const salesOrders: SalesOrder[] = [
  salesOrder({
    id: "SO-301",
    customerId: "CUS-001",
    status: "closed",
    customerPoNumber: "GPM-PO-8841",
    orderDate: "2026-02-14T09:00:00.000Z",
    requestedDeliveryDate: "2026-02-20T00:00:00.000Z",
    createdByUserId: "USR-009",
    confirmedAt: "2026-02-14T10:30:00.000Z",
    closedAt: "2026-03-02T16:00:00.000Z",
    lines: [
      { productId: "PRD-001", ordered: 200, unitPrice: 9.5, warehouseId: "WH-001", fulfilled: 200 },
      { productId: "PRD-010", ordered: 150, unitPrice: 15, warehouseId: "WH-001", fulfilled: 150 },
    ],
  }),
  salesOrder({
    id: "SO-302",
    customerId: "CUS-002",
    status: "partially_fulfilled",
    customerPoNumber: "LFP-4471",
    orderDate: "2026-03-04T08:45:00.000Z",
    requestedDeliveryDate: "2026-03-18T00:00:00.000Z",
    createdByUserId: "USR-009",
    confirmedAt: "2026-03-04T09:30:00.000Z",
    lines: [
      { productId: "PRD-004", ordered: 100, unitPrice: 22.5, warehouseId: "WH-002", reserved: 40, fulfilled: 60 },
      { productId: "PRD-006", ordered: 80, unitPrice: 18, warehouseId: "WH-002", fulfilled: 80 },
    ],
  }),
  salesOrder({
    id: "SO-303",
    customerId: "CUS-003",
    status: "confirmed",
    customerPoNumber: "CORV-PO-20266",
    orderDate: "2026-03-12T11:15:00.000Z",
    requestedDeliveryDate: "2026-03-26T00:00:00.000Z",
    createdByUserId: "USR-009",
    confirmedAt: "2026-03-12T13:40:00.000Z",
    lines: [
      { productId: "PRD-014", ordered: 8, unitPrice: 1150, warehouseId: "WH-003", reserved: 8 },
    ],
  }),
  salesOrder({
    id: "SO-304",
    customerId: "CUS-004",
    status: "draft",
    customerPoNumber: "SUN-2026-0412",
    orderDate: "2026-03-15T15:20:00.000Z",
    requestedDeliveryDate: "2026-04-02T00:00:00.000Z",
    createdByUserId: "USR-009",
    lines: [
      { productId: "PRD-021", ordered: 20, unitPrice: 155, warehouseId: "WH-002" },
    ],
  }),
  salesOrder({
    id: "SO-305",
    customerId: "CUS-005",
    status: "confirmed",
    customerPoNumber: "RMS-PO-7730",
    orderDate: "2026-03-09T10:05:00.000Z",
    requestedDeliveryDate: "2026-03-23T00:00:00.000Z",
    createdByUserId: "USR-010",
    confirmedAt: "2026-03-09T10:45:00.000Z",
    lines: [
      { productId: "PRD-012", ordered: 40, unitPrice: 165, warehouseId: "WH-001" },
    ],
  }),
  salesOrder({
    id: "SO-306",
    customerId: "CUS-007",
    status: "fulfilled",
    customerPoNumber: "HPM-99120",
    orderDate: "2026-03-02T09:30:00.000Z",
    requestedDeliveryDate: "2026-03-10T00:00:00.000Z",
    createdByUserId: "USR-009",
    confirmedAt: "2026-03-02T10:00:00.000Z",
    lines: [
      { productId: "PRD-018", ordered: 120, unitPrice: 42, warehouseId: "WH-001", fulfilled: 120 },
    ],
  }),
  salesOrder({
    id: "SO-307",
    customerId: "CUS-008",
    status: "confirmed",
    customerPoNumber: "VTX-PO-55218",
    orderDate: "2026-03-13T14:00:00.000Z",
    requestedDeliveryDate: "2026-03-27T00:00:00.000Z",
    createdByUserId: "USR-009",
    confirmedAt: "2026-03-13T14:35:00.000Z",
    lines: [
      { productId: "PRD-003", ordered: 150, unitPrice: 37.5, warehouseId: "WH-001" },
    ],
  }),
  salesOrder({
    id: "SO-308",
    customerId: "CUS-009",
    status: "cancelled",
    customerPoNumber: "BRM-PO-3390",
    orderDate: "2026-03-06T13:10:00.000Z",
    requestedDeliveryDate: "2026-03-20T00:00:00.000Z",
    createdByUserId: "USR-009",
    confirmedAt: "2026-03-06T13:50:00.000Z",
    cancelledAt: "2026-03-10T09:15:00.000Z",
    cancelReason: "Customer consolidated the requirement into a later order.",
    lines: [
      { productId: "PRD-011", ordered: 40, unitPrice: 68, warehouseId: "WH-001" },
    ],
  }),
];

export const fulfillments: Fulfillment[] = [
  {
    id: "FUL-001",
    number: "FUL-001",
    salesOrderId: "SO-301",
    warehouseId: "WH-001",
    status: "delivered",
    lines: [
      { id: "FUL-001-L1", salesOrderLineId: "SO-301-L1", productId: "PRD-001", quantity: 200 },
      { id: "FUL-001-L2", salesOrderLineId: "SO-301-L2", productId: "PRD-010", quantity: 150 },
    ],
    carrier: "Midwest Freightways",
    trackingNumber: "MFW-4410882",
    shippedByUserId: "USR-004",
    shippedAt: "2026-02-18T15:00:00.000Z",
    deliveredAt: "2026-02-20T11:30:00.000Z",
  },
  {
    id: "FUL-002",
    number: "FUL-002",
    salesOrderId: "SO-302",
    warehouseId: "WH-002",
    status: "shipped",
    lines: [
      { id: "FUL-002-L1", salesOrderLineId: "SO-302-L1", productId: "PRD-004", quantity: 60 },
      { id: "FUL-002-L2", salesOrderLineId: "SO-302-L2", productId: "PRD-006", quantity: 80 },
    ],
    carrier: "Lone Star Logistics",
    trackingNumber: "LSL-7729104",
    shippedByUserId: "USR-012",
    shippedAt: "2026-03-11T16:20:00.000Z",
    deliveredAt: null,
  },
  {
    id: "FUL-003",
    number: "FUL-003",
    salesOrderId: "SO-306",
    warehouseId: "WH-001",
    status: "delivered",
    lines: [
      { id: "FUL-003-L1", salesOrderLineId: "SO-306-L1", productId: "PRD-018", quantity: 120 },
    ],
    carrier: "Midwest Freightways",
    trackingNumber: "MFW-4419337",
    shippedByUserId: "USR-004",
    shippedAt: "2026-03-05T14:10:00.000Z",
    deliveredAt: "2026-03-07T10:05:00.000Z",
  },
];

type CustomerInvoiceSpec = {
  id: string;
  customerId: string;
  status: CustomerInvoice["status"];
  lines: Array<{
    salesOrderLineId: string | null;
    productId: string;
    description: string;
    quantity: number;
    unitPrice: number;
  }>;
  issueDate: string;
  dueDate: string;
  amountPaid?: number;
  salesOrderId?: string;
  fulfillmentIds?: string[];
  paidAt?: string;
};

function customerInvoice(spec: CustomerInvoiceSpec): CustomerInvoice {
  const lines = spec.lines.map((line, index) => ({
    id: `${spec.id}-L${index + 1}`,
    salesOrderLineId: line.salesOrderLineId,
    productId: line.productId,
    description: line.description,
    quantity: line.quantity,
    unitPrice: usd(line.unitPrice),
    lineTotal: usd(line.quantity * line.unitPrice),
  }));

  const subtotal = usd(lines.reduce((total, line) => total + line.lineTotal.amount, 0));
  const taxAmount = usd(subtotal.amount * TAX_RATE);

  return {
    id: spec.id,
    number: spec.id,
    customerId: spec.customerId,
    salesOrderId: spec.salesOrderId ?? null,
    fulfillmentIds: spec.fulfillmentIds ?? [],
    status: spec.status,
    lines,
    subtotal,
    taxAmount,
    totalAmount: usd(subtotal.amount + taxAmount.amount),
    amountPaid: usd(spec.amountPaid ?? 0),
    issueDate: spec.issueDate,
    dueDate: spec.dueDate,
    paidAt: spec.paidAt ?? null,
  };
}

/**
 * SO-306 is deliberately shipped but not invoiced, and CINV-403/CINV-407 are the
 * overdue receivables above $10,000.
 */
export const customerInvoices: CustomerInvoice[] = [
  customerInvoice({
    id: "CINV-401",
    customerId: "CUS-001",
    status: "paid",
    salesOrderId: "SO-301",
    fulfillmentIds: ["FUL-001"],
    amountPaid: 4482,
    issueDate: "2026-02-20T00:00:00.000Z",
    dueDate: "2026-03-22T00:00:00.000Z",
    paidAt: "2026-03-02T13:00:00.000Z",
    lines: [
      { salesOrderLineId: "SO-301-L1", productId: "PRD-001", description: "Deep Groove Ball Bearing 6205-2RS", quantity: 200, unitPrice: 9.5 },
      { salesOrderLineId: "SO-301-L2", productId: "PRD-010", description: "V-Belt A42", quantity: 150, unitPrice: 15 },
    ],
  }),
  customerInvoice({
    id: "CINV-402",
    customerId: "CUS-002",
    status: "partially_paid",
    salesOrderId: "SO-302",
    fulfillmentIds: ["FUL-002"],
    amountPaid: 1500,
    issueDate: "2026-03-11T00:00:00.000Z",
    dueDate: "2026-04-25T00:00:00.000Z",
    lines: [
      { salesOrderLineId: "SO-302-L1", productId: "PRD-004", description: "Hex Bolt M8x40 Zinc (box of 100)", quantity: 60, unitPrice: 22.5 },
      { salesOrderLineId: "SO-302-L2", productId: "PRD-006", description: "Nylon Lock Nut M8 (box of 200)", quantity: 80, unitPrice: 18 },
    ],
  }),
  customerInvoice({
    id: "CINV-403",
    customerId: "CUS-003",
    status: "issued",
    issueDate: "2026-01-05T00:00:00.000Z",
    dueDate: "2026-03-06T00:00:00.000Z",
    lines: [
      { salesOrderLineId: null, productId: "PRD-009", description: "Gear Pump A12 Series", quantity: 30, unitPrice: 940 },
      { salesOrderLineId: null, productId: "PRD-007", description: "Hydraulic Cylinder 50mm Bore", quantity: 30, unitPrice: 468 },
    ],
  }),
  customerInvoice({
    id: "CINV-404",
    customerId: "CUS-004",
    status: "issued",
    issueDate: "2026-01-28T00:00:00.000Z",
    dueDate: "2026-02-27T00:00:00.000Z",
    lines: [
      { salesOrderLineId: null, productId: "PRD-018", description: "Grinding Disc 125mm (box of 25)", quantity: 60, unitPrice: 42 },
    ],
  }),
  customerInvoice({
    id: "CINV-405",
    customerId: "CUS-008",
    status: "issued",
    issueDate: "2026-03-10T00:00:00.000Z",
    dueDate: "2026-04-09T00:00:00.000Z",
    lines: [
      { salesOrderLineId: null, productId: "PRD-003", description: "Deep Groove Ball Bearing 6309-ZZ", quantity: 300, unitPrice: 37.5 },
    ],
  }),
  customerInvoice({
    id: "CINV-406",
    customerId: "CUS-010",
    status: "written_off",
    issueDate: "2025-11-14T00:00:00.000Z",
    dueDate: "2025-12-14T00:00:00.000Z",
    lines: [
      { salesOrderLineId: null, productId: "PRD-016", description: "Impact Wrench 1/2in", quantity: 20, unitPrice: 329 },
    ],
  }),
  customerInvoice({
    id: "CINV-407",
    customerId: "CUS-011",
    status: "issued",
    issueDate: "2026-01-15T00:00:00.000Z",
    dueDate: "2026-03-01T00:00:00.000Z",
    lines: [
      { salesOrderLineId: null, productId: "PRD-014", description: "Variable Frequency Drive 5kW", quantity: 12, unitPrice: 1150 },
    ],
  }),
];

export const payments: Payment[] = [
  {
    id: "PAY-001",
    number: "PAY-001",
    direction: "outbound",
    vendorId: "VEN-001",
    customerId: null,
    allocations: [{ invoiceId: "VINV-101", amount: usd(5907.6) }],
    amount: usd(5907.6),
    method: "bank_transfer",
    status: "completed",
    reference: "ACH-20260306-0041",
    scheduledDate: "2026-03-05T00:00:00.000Z",
    processedAt: "2026-03-06T14:00:00.000Z",
    failureReason: null,
    createdByUserId: "USR-006",
    approvalId: null,
    approvedByUserId: "USR-007",
    createdAt: "2026-03-04T10:20:00.000Z",
  },
  {
    id: "PAY-002",
    number: "PAY-002",
    direction: "outbound",
    vendorId: "VEN-003",
    customerId: null,
    allocations: [{ invoiceId: "VINV-102", amount: usd(10_775.16) }],
    amount: usd(10_775.16),
    method: "bank_transfer",
    status: "pending_approval",
    reference: "ACH-20260320-0052",
    scheduledDate: "2026-03-20T00:00:00.000Z",
    processedAt: null,
    failureReason: null,
    createdByUserId: "USR-006",
    approvalId: "APR-021",
    approvedByUserId: null,
    createdAt: "2026-03-13T11:00:00.000Z",
  },
  {
    id: "PAY-003",
    number: "PAY-003",
    direction: "outbound",
    vendorId: "VEN-002",
    customerId: null,
    allocations: [{ invoiceId: "VINV-108", amount: usd(2527.2) }],
    amount: usd(2527.2),
    method: "ach",
    status: "failed",
    reference: "ACH-20260304-0033",
    scheduledDate: "2026-03-04T00:00:00.000Z",
    processedAt: "2026-03-04T16:45:00.000Z",
    failureReason: "Vendor bank account rejected the transfer; remittance details outdated.",
    createdByUserId: "USR-006",
    approvalId: null,
    approvedByUserId: "USR-007",
    createdAt: "2026-03-03T09:15:00.000Z",
  },
  {
    id: "PAY-004",
    number: "PAY-004",
    direction: "inbound",
    vendorId: null,
    customerId: "CUS-001",
    allocations: [{ invoiceId: "CINV-401", amount: usd(4482) }],
    amount: usd(4482),
    method: "bank_transfer",
    status: "completed",
    reference: "RCPT-20260302-0011",
    scheduledDate: "2026-03-02T00:00:00.000Z",
    processedAt: "2026-03-02T13:00:00.000Z",
    failureReason: null,
    createdByUserId: "USR-006",
    approvalId: null,
    approvedByUserId: null,
    createdAt: "2026-03-02T12:40:00.000Z",
  },
  {
    id: "PAY-005",
    number: "PAY-005",
    direction: "inbound",
    vendorId: null,
    customerId: "CUS-002",
    allocations: [{ invoiceId: "CINV-402", amount: usd(1500) }],
    amount: usd(1500),
    method: "check",
    status: "completed",
    reference: "CHK-448201",
    scheduledDate: "2026-03-13T00:00:00.000Z",
    processedAt: "2026-03-13T15:30:00.000Z",
    failureReason: null,
    createdByUserId: "USR-006",
    approvalId: null,
    approvedByUserId: null,
    createdAt: "2026-03-13T15:10:00.000Z",
  },
  {
    id: "PAY-006",
    number: "PAY-006",
    direction: "outbound",
    vendorId: null,
    customerId: null,
    allocations: [],
    amount: usd(1240),
    method: "ach",
    status: "completed",
    reference: "REIMB-EXP-001",
    scheduledDate: "2026-02-12T00:00:00.000Z",
    processedAt: "2026-02-12T11:00:00.000Z",
    failureReason: null,
    createdByUserId: "USR-006",
    approvalId: null,
    approvedByUserId: "USR-008",
    createdAt: "2026-02-10T09:30:00.000Z",
  },
];

export const expenses: Expense[] = [
  {
    id: "EXP-001",
    number: "EXP-001",
    employeeUserId: "USR-002",
    departmentId: "DEPT-PROC",
    category: "travel",
    description: "Vendor audit trip — Kessler Bearing Works, Cleveland",
    amount: usd(1240),
    status: "paid",
    incurredAt: "2026-02-05T00:00:00.000Z",
    submittedAt: "2026-02-06T08:20:00.000Z",
    approvalId: "APR-022",
    budgetId: "BUD-001",
    paymentId: "PAY-006",
    hasReceipt: true,
  },
  {
    id: "EXP-002",
    number: "EXP-002",
    employeeUserId: "USR-011",
    departmentId: "DEPT-FAC",
    category: "maintenance",
    description: "Emergency HVAC filter purchase — Columbus site",
    amount: usd(480),
    status: "submitted",
    incurredAt: "2026-03-11T00:00:00.000Z",
    submittedAt: "2026-03-12T13:40:00.000Z",
    approvalId: "APR-023",
    budgetId: "BUD-004",
    paymentId: null,
    hasReceipt: true,
  },
  {
    id: "EXP-003",
    number: "EXP-003",
    employeeUserId: "USR-009",
    departmentId: "DEPT-SALES",
    category: "travel",
    description: "Customer site visit — Granite Peak Manufacturing",
    amount: usd(865.5),
    status: "approved",
    incurredAt: "2026-03-03T00:00:00.000Z",
    submittedAt: "2026-03-04T16:05:00.000Z",
    approvalId: "APR-024",
    budgetId: "BUD-005",
    paymentId: null,
    hasReceipt: true,
  },
  {
    id: "EXP-004",
    number: "EXP-004",
    employeeUserId: "USR-004",
    departmentId: "DEPT-OPS",
    category: "training",
    description: "Forklift certification renewal",
    amount: usd(1150),
    status: "draft",
    incurredAt: "2026-03-14T00:00:00.000Z",
    submittedAt: null,
    approvalId: null,
    budgetId: "BUD-002",
    paymentId: null,
    hasReceipt: false,
  },
  {
    id: "EXP-005",
    number: "EXP-005",
    employeeUserId: "USR-006",
    departmentId: "DEPT-FIN",
    category: "travel",
    description: "Mileage claim — duplicate submission",
    amount: usd(320),
    status: "rejected",
    incurredAt: "2026-02-05T00:00:00.000Z",
    submittedAt: "2026-02-20T11:15:00.000Z",
    approvalId: "APR-025",
    budgetId: "BUD-006",
    paymentId: null,
    hasReceipt: false,
  },
];

function budget(
  id: string,
  name: string,
  departmentId: string,
  category: string,
  allocated: number,
  committed: number,
  spent: number,
  status: Budget["status"] = "active",
): Budget {
  return {
    id,
    name,
    departmentId,
    fiscalYear: "FY2026",
    category,
    allocatedAmount: usd(allocated),
    committedAmount: usd(committed),
    spentAmount: usd(spent),
    currency: "USD",
    status,
  };
}

/**
 * BUD-004 is deliberately tight: $2,400 available against PR-002's $3,900
 * request, so a budget check has to fail before that requisition can be approved.
 */
export const budgets: Budget[] = [
  budget("BUD-001", "Procurement — Indirect", "DEPT-PROC", "indirect", 60_000, 20_401.2, 12_840),
  budget("BUD-002", "Operations — MRO", "DEPT-OPS", "mro", 450_000, 25_077.6, 41_297.76),
  budget("BUD-003", "IT — Equipment", "DEPT-IT", "equipment", 90_000, 0, 34_500),
  budget("BUD-004", "Facilities — Supplies", "DEPT-FAC", "supplies", 24_000, 3120, 18_480),
  budget("BUD-005", "Sales — Travel & Entertainment", "DEPT-SALES", "travel", 75_000, 865.5, 22_315.5),
  budget("BUD-006", "Finance — Operating", "DEPT-FIN", "operating", 40_000, 0, 9120),
];

function movement(
  id: string,
  type: InventoryMovement["type"],
  productId: string,
  warehouseId: string,
  quantityDelta: number,
  reservedDelta: number,
  referenceType: InventoryMovement["referenceType"],
  referenceId: string | null,
  occurredAt: string,
  actorUserId: string,
  note = "",
): InventoryMovement {
  return {
    id,
    type,
    productId,
    warehouseId,
    quantityDelta,
    reservedDelta,
    referenceType,
    referenceId,
    occurredAt,
    actorUserId,
    note,
  };
}

/**
 * Recent movement history. On-hand balances also include opening stock that
 * predates this log, so the movements do not sum to the current quantities.
 */
export const inventoryMovements: InventoryMovement[] = [
  movement("MOV-001", "issue", "PRD-001", "WH-001", -200, 0, "fulfillment", "FUL-001", "2026-02-18T15:00:00.000Z", "USR-004", "Shipment to Granite Peak Manufacturing"),
  movement("MOV-002", "issue", "PRD-010", "WH-001", -150, 0, "fulfillment", "FUL-001", "2026-02-18T15:00:00.000Z", "USR-004", "Shipment to Granite Peak Manufacturing"),
  movement("MOV-003", "receipt", "PRD-001", "WH-001", 500, 0, "goods_receipt", "GR-001", "2026-02-23T13:45:00.000Z", "USR-004", ""),
  movement("MOV-004", "receipt", "PRD-002", "WH-001", 300, 0, "goods_receipt", "GR-001", "2026-02-23T13:45:00.000Z", "USR-004", ""),
  movement("MOV-005", "transfer_out", "PRD-010", "WH-001", -100, 0, "transfer", "TRF-001", "2026-02-27T10:00:00.000Z", "USR-005", "Rebalance to Central Overflow Store"),
  movement("MOV-006", "transfer_in", "PRD-010", "WH-004", 100, 0, "transfer", "TRF-001", "2026-02-27T10:00:00.000Z", "USR-005", "Rebalance from Warehouse North"),
  movement("MOV-007", "adjustment", "PRD-019", "WH-001", -3, 0, "adjustment", "ADJ-001", "2026-03-02T09:00:00.000Z", "USR-005", "Cycle count shrinkage"),
  movement("MOV-008", "reservation", "PRD-004", "WH-002", 0, 100, "sales_order", "SO-302", "2026-03-04T09:30:00.000Z", "USR-009", "Reserved for Lakeside Food Processing"),
  movement("MOV-009", "issue", "PRD-018", "WH-001", -120, 0, "fulfillment", "FUL-003", "2026-03-05T14:10:00.000Z", "USR-004", "Shipment to Halcyon Paper Mills"),
  movement("MOV-010", "receipt", "PRD-004", "WH-002", 250, 0, "goods_receipt", "GR-003", "2026-03-07T09:50:00.000Z", "USR-012", "Short shipment against PO-203"),
  movement("MOV-011", "receipt", "PRD-006", "WH-002", 300, 0, "goods_receipt", "GR-003", "2026-03-07T09:50:00.000Z", "USR-012", ""),
  movement("MOV-012", "receipt", "PRD-021", "WH-002", 80, 0, "goods_receipt", "GR-004", "2026-03-08T15:00:00.000Z", "USR-012", ""),
  movement("MOV-013", "receipt", "PRD-007", "WH-001", 25, 0, "goods_receipt", "GR-002", "2026-03-09T10:40:00.000Z", "USR-004", "Partial delivery against PO-202"),
  movement("MOV-014", "receipt", "PRD-008", "WH-001", 595, 0, "goods_receipt", "GR-002", "2026-03-09T10:40:00.000Z", "USR-004", "5 metres rejected as damaged"),
  movement("MOV-015", "reservation", "PRD-012", "WH-001", 0, 40, "sales_order", "SO-305", "2026-03-09T10:45:00.000Z", "USR-010", "Reserved for Ridgeway Mining Services"),
  movement("MOV-016", "issue", "PRD-004", "WH-002", -60, -60, "fulfillment", "FUL-002", "2026-03-11T16:20:00.000Z", "USR-012", "Partial shipment against SO-302"),
  movement("MOV-017", "issue", "PRD-006", "WH-002", -80, 0, "fulfillment", "FUL-002", "2026-03-11T16:20:00.000Z", "USR-012", ""),
  movement("MOV-018", "reservation", "PRD-014", "WH-003", 0, 8, "sales_order", "SO-303", "2026-03-12T13:40:00.000Z", "USR-009", "Reserved for Corvus Aerospace Components"),
  movement("MOV-019", "receipt", "PRD-017", "WH-001", 50, 0, "goods_receipt", "GR-006", "2026-03-03T11:30:00.000Z", "USR-004", ""),
  movement("MOV-020", "release", "PRD-012", "WH-001", 0, -40, "sales_order", "SO-305", "2026-03-13T09:00:00.000Z", "USR-010", "Reservation released — customer placed on credit hold"),
];

function audit(
  id: string,
  at: string,
  actorUserId: string,
  action: string,
  entityType: AuditEvent["entityType"],
  entityId: string,
  summary: string,
): AuditEvent {
  return { id, at, actorUserId, action, entityType, entityId, summary, changes: [] };
}

export const auditLog: AuditEvent[] = [
  audit("AUD-0001", "2026-02-04T09:20:00.000Z", "USR-003", "requisition.approved", "requisition", "PR-001", "Approved requisition PR-001 for $5,665.00"),
  audit("AUD-0002", "2026-02-13T09:30:00.000Z", "USR-002", "quotation.accepted", "quotation", "QUO-001", "Accepted quotation QUO-001 from Kessler Bearing Works"),
  audit("AUD-0003", "2026-02-14T08:40:00.000Z", "USR-003", "purchase_order.approved", "purchase_order", "PO-201", "Approved purchase order PO-201 for $5,907.60"),
  audit("AUD-0004", "2026-02-19T13:35:00.000Z", "USR-008", "requisition.rejected", "requisition", "PR-004", "Rejected requisition PR-004 — deferred to Q3"),
  audit("AUD-0005", "2026-02-23T13:45:00.000Z", "USR-004", "goods_receipt.posted", "goods_receipt", "GR-001", "Posted goods receipt GR-001 against PO-201"),
  audit("AUD-0006", "2026-02-27T11:20:00.000Z", "USR-007", "vendor_invoice.approved", "vendor_invoice", "VINV-101", "Approved vendor invoice VINV-101 after clean three-way match"),
  audit("AUD-0007", "2026-03-02T13:00:00.000Z", "USR-006", "payment.completed", "payment", "PAY-004", "Recorded customer receipt of $4,482.00 against CINV-401"),
  audit("AUD-0008", "2026-03-04T16:45:00.000Z", "USR-006", "payment.failed", "payment", "PAY-003", "Payment PAY-003 failed — vendor bank details rejected"),
  audit("AUD-0009", "2026-03-05T11:30:00.000Z", "USR-002", "purchase_order.cancelled", "purchase_order", "PO-207", "Cancelled PO-207 — requirement withdrawn by Facilities"),
  audit("AUD-0010", "2026-03-06T09:10:00.000Z", "USR-007", "vendor_invoice.approved", "vendor_invoice", "VINV-107", "Approved vendor invoice VINV-107 for $5,076.00"),
  audit("AUD-0011", "2026-03-06T14:00:00.000Z", "USR-006", "payment.completed", "payment", "PAY-001", "Paid vendor invoice VINV-101 in full"),
  audit("AUD-0012", "2026-03-06T15:10:00.000Z", "USR-008", "customer.status_changed", "customer", "CUS-005", "Placed Ridgeway Mining Services on credit hold"),
  audit("AUD-0013", "2026-03-07T09:55:00.000Z", "USR-012", "discrepancy.reported", "discrepancy", "DISC-001", "Reported shortage on GR-003 — 250 of 400 boxes received"),
  audit("AUD-0014", "2026-03-08T15:35:00.000Z", "USR-012", "goods_receipt.cancelled", "goods_receipt", "GR-005", "Cancelled duplicate goods receipt GR-005"),
  audit("AUD-0015", "2026-03-10T14:55:00.000Z", "USR-006", "three_way_match.failed", "three_way_match", "MATCH-004", "Three-way match failed for VINV-104 — quantity variance on PO-203"),
  audit("AUD-0016", "2026-03-10T14:10:00.000Z", "USR-006", "three_way_match.failed", "three_way_match", "MATCH-003", "Three-way match failed for VINV-103 — price variance on PO-206"),
  audit("AUD-0017", "2026-03-11T09:20:00.000Z", "USR-004", "discrepancy.resolved", "discrepancy", "DISC-002", "Resolved damage discrepancy DISC-002 with vendor credit"),
  audit("AUD-0018", "2026-03-11T16:20:00.000Z", "USR-012", "fulfillment.shipped", "fulfillment", "FUL-002", "Shipped partial fulfillment FUL-002 against SO-302"),
  audit("AUD-0019", "2026-03-13T09:00:00.000Z", "USR-010", "sales_order.reservation_released", "sales_order", "SO-305", "Released 40 units of PRD-012 — customer on credit hold"),
  audit("AUD-0020", "2026-03-14T08:15:00.000Z", "USR-003", "purchase_order.approved", "purchase_order", "PO-208", "Approved purchase order PO-208 for $5,637.60"),
];

/**
 * Last-used sequence numbers. `nextId` increments these, so IDs minted by tools
 * continue the seeded series (the next purchase order is PO-210).
 */
export const sequences: Record<string, number> = {
  USR: 13,
  VEN: 12,
  CUS: 12,
  PRD: 22,
  WH: 4,
  PR: 6,
  APR: 25,
  RFQ: 4,
  QUO: 7,
  PO: 209,
  GR: 6,
  DISC: 2,
  VINV: 108,
  MATCH: 6,
  PAY: 6,
  SO: 308,
  FUL: 3,
  CINV: 407,
  EXP: 5,
  BUD: 6,
  MOV: 20,
  AUD: 20,
  TRF: 1,
  ADJ: 1,
};

/**
 * Builds a fresh ERP state. Every call returns an independent deep copy so that
 * mutations made during one task never leak into the next.
 */
export function createErpState(): ErpState {
  return structuredClone({
    now: SIMULATION_NOW,
    company,
    departments: indexById(departments),
    users: indexById(users),
    vendors: indexById(vendors),
    customers: indexById(customers),
    products: indexById(products),
    warehouses: indexById(warehouses),
    inventory: indexById(inventory),
    inventoryMovements: indexById(inventoryMovements),
    requisitions: indexById(requisitions),
    approvals: indexById(approvals),
    rfqs: indexById(rfqs),
    quotations: indexById(quotations),
    purchaseOrders: indexById(purchaseOrders),
    goodsReceipts: indexById(goodsReceipts),
    receivingDiscrepancies: indexById(receivingDiscrepancies),
    vendorInvoices: indexById(vendorInvoices),
    threeWayMatches: indexById(threeWayMatches),
    payments: indexById(payments),
    salesOrders: indexById(salesOrders),
    fulfillments: indexById(fulfillments),
    customerInvoices: indexById(customerInvoices),
    expenses: indexById(expenses),
    budgets: indexById(budgets),
    auditLog,
    sequences,
  });
}
