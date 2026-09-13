import {
  type Product,
  type ProductStatus,
  type UnitOfMeasure,
  availableQuantity,
  money,
  nextId,
} from "../state.js";
import {
  S,
  defineTool,
  matchesText,
  pagingProperties,
  paginate,
  readEnum,
  readNumber,
  readOptionalEnum,
  readOptionalNumber,
  readOptionalString,
  readString,
  schema,
  toolError,
} from "./contract.js";
import {
  actor,
  audit,
  productSummary,
  requireProduct,
  requireVendor,
} from "./helpers.js";

const productStatuses: readonly ProductStatus[] = ["active", "discontinued", "draft"];

const unitsOfMeasure: readonly UnitOfMeasure[] = [
  "each",
  "box",
  "case",
  "kg",
  "litre",
  "metre",
];

export const productTools = [
  defineTool({
    name: "list_products",
    description: "List catalogue products, optionally filtered by category or status.",
    inputSchema: schema({
      category: S.string("Only products in this category."),
      status: S.enumeration("Only products with this status.", productStatuses),
      ...pagingProperties,
    }),
    run(state, input) {
      const category = readOptionalString(input, "category");
      const status = readOptionalEnum(input, "status", productStatuses);

      const products = Object.values(state.products)
        .filter((product) => (category ? matchesText(product.category, category) : true))
        .filter((product) => (status ? product.status === status : true))
        .sort((a, b) => a.id.localeCompare(b.id));

      const page = paginate(products, input);

      return { ...page, results: page.results.map(productSummary) };
    },
  }),

  defineTool({
    name: "search_products",
    description: "Search products by SKU, name or category.",
    inputSchema: schema(
      { query: S.string("Free-text search term."), ...pagingProperties },
      ["query"],
    ),
    run(state, input) {
      const query = readString(input, "query");

      const products = Object.values(state.products)
        .filter(
          (product) =>
            matchesText(product.sku, query) ||
            matchesText(product.name, query) ||
            matchesText(product.category, query),
        )
        .sort((a, b) => a.id.localeCompare(b.id));

      const page = paginate(products, input);

      return { ...page, results: page.results.map(productSummary) };
    },
  }),

  defineTool({
    name: "get_product",
    description: "Get the full record for one product.",
    inputSchema: schema({ productId: S.string("Product ID, e.g. 'PRD-001'.") }, [
      "productId",
    ]),
    run(state, input) {
      return requireProduct(state, readString(input, "productId"));
    },
  }),

  defineTool({
    name: "create_product",
    description: "Add a product to the catalogue.",
    inputSchema: schema(
      {
        sku: S.string("Stock keeping unit."),
        name: S.string("Product name."),
        category: S.string("Product category."),
        uom: S.enumeration("Unit of measure.", unitsOfMeasure),
        standardCost: S.number("Standard purchase cost.", { minimum: 0 }),
        listPrice: S.number("Default selling price.", { minimum: 0 }),
        reorderPoint: S.integer("Default reorder point.", { minimum: 0 }),
        reorderQuantity: S.integer("Default reorder quantity.", { minimum: 0 }),
        leadTimeDays: S.integer("Replenishment lead time in days.", { minimum: 0 }),
        actorUserId: S.string("User performing the action."),
      },
      ["sku", "name", "category", "uom", "standardCost", "listPrice", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const sku = readString(input, "sku");

      const duplicate = Object.values(state.products).find(
        (product) => product.sku.toLowerCase() === sku.toLowerCase(),
      );

      if (duplicate) {
        throw toolError("conflict", `SKU "${sku}" already exists as ${duplicate.id}.`, {
          productId: duplicate.id,
        });
      }

      const product: Product = {
        id: nextId(state, "PRD"),
        sku,
        name: readString(input, "name"),
        category: readString(input, "category"),
        uom: readEnum(input, "uom", unitsOfMeasure),
        standardCost: money(readNumber(input, "standardCost", { min: 0 }), state.company.baseCurrency),
        listPrice: money(readNumber(input, "listPrice", { min: 0 }), state.company.baseCurrency),
        status: "active",
        reorderPoint: readOptionalNumber(input, "reorderPoint", { min: 0, integer: true }) ?? 0,
        reorderQuantity: readOptionalNumber(input, "reorderQuantity", { min: 0, integer: true }) ?? 0,
        leadTimeDays: readOptionalNumber(input, "leadTimeDays", { min: 0, integer: true }) ?? 14,
        preferredVendorIds: [],
        isStocked: true,
      };

      state.products[product.id] = product;

      audit(state, user.id, "product.created", "product", product.id, `Created product ${product.sku}`);

      return product;
    },
  }),

  defineTool({
    name: "update_product",
    description:
      "Update product pricing, reorder policy, lead time or preferred vendors.",
    inputSchema: schema(
      {
        productId: S.string("Product ID."),
        listPrice: S.number("New selling price.", { minimum: 0 }),
        standardCost: S.number("New standard cost.", { minimum: 0 }),
        reorderPoint: S.integer("New reorder point.", { minimum: 0 }),
        reorderQuantity: S.integer("New reorder quantity.", { minimum: 0 }),
        leadTimeDays: S.integer("New lead time in days.", { minimum: 0 }),
        preferredVendorIds: S.array("Replacement list of preferred vendor IDs.", S.string("Vendor ID.")),
        actorUserId: S.string("User performing the action."),
      },
      ["productId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const product = requireProduct(state, readString(input, "productId"));
      const changes: Array<{ field: string; from: unknown; to: unknown }> = [];

      const listPrice = readOptionalNumber(input, "listPrice", { min: 0 });
      if (listPrice !== undefined) {
        changes.push({ field: "listPrice", from: product.listPrice.amount, to: listPrice });
        product.listPrice = money(listPrice, product.listPrice.currency);
      }

      const standardCost = readOptionalNumber(input, "standardCost", { min: 0 });
      if (standardCost !== undefined) {
        changes.push({ field: "standardCost", from: product.standardCost.amount, to: standardCost });
        product.standardCost = money(standardCost, product.standardCost.currency);
      }

      const reorderPoint = readOptionalNumber(input, "reorderPoint", { min: 0, integer: true });
      if (reorderPoint !== undefined) {
        changes.push({ field: "reorderPoint", from: product.reorderPoint, to: reorderPoint });
        product.reorderPoint = reorderPoint;
      }

      const reorderQuantity = readOptionalNumber(input, "reorderQuantity", { min: 0, integer: true });
      if (reorderQuantity !== undefined) {
        changes.push({ field: "reorderQuantity", from: product.reorderQuantity, to: reorderQuantity });
        product.reorderQuantity = reorderQuantity;
      }

      const leadTimeDays = readOptionalNumber(input, "leadTimeDays", { min: 0, integer: true });
      if (leadTimeDays !== undefined) {
        changes.push({ field: "leadTimeDays", from: product.leadTimeDays, to: leadTimeDays });
        product.leadTimeDays = leadTimeDays;
      }

      if (Array.isArray(input["preferredVendorIds"])) {
        const vendorIds = (input["preferredVendorIds"] as unknown[]).map((value) => String(value));
        for (const vendorId of vendorIds) requireVendor(state, vendorId);
        changes.push({ field: "preferredVendorIds", from: product.preferredVendorIds, to: vendorIds });
        product.preferredVendorIds = vendorIds;
      }

      if (changes.length === 0) {
        throw toolError("invalid_input", "No product fields were supplied to update.");
      }

      audit(state, user.id, "product.updated", "product", product.id, `Updated ${product.sku}`, changes);

      return product;
    },
  }),

  defineTool({
    name: "discontinue_product",
    description:
      "Discontinue a product. Fails if the product still has open purchase or sales order lines.",
    inputSchema: schema(
      {
        productId: S.string("Product ID."),
        actorUserId: S.string("User performing the action."),
      },
      ["productId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const product = requireProduct(state, readString(input, "productId"));

      if (product.status === "discontinued") {
        throw toolError("invalid_state", `Product ${product.id} is already discontinued.`);
      }

      const openPurchaseLines = Object.values(state.purchaseOrders)
        .filter((order) => ["sent", "approved", "partially_received", "pending_approval"].includes(order.status))
        .flatMap((order) => order.lines.map((line) => ({ order, line })))
        .filter(({ line }) => line.productId === product.id && line.quantityReceived < line.quantityOrdered);

      const openSalesLines = Object.values(state.salesOrders)
        .filter((order) => ["confirmed", "partially_fulfilled", "draft"].includes(order.status))
        .flatMap((order) => order.lines.map((line) => ({ order, line })))
        .filter(({ line }) => line.productId === product.id && line.quantityFulfilled < line.quantityOrdered);

      if (openPurchaseLines.length > 0 || openSalesLines.length > 0) {
        throw toolError(
          "invalid_state",
          `Product ${product.id} still has ${openPurchaseLines.length} open purchase line(s) and ${openSalesLines.length} open sales line(s).`,
          {
            purchaseOrders: openPurchaseLines.map(({ order }) => order.id),
            salesOrders: openSalesLines.map(({ order }) => order.id),
          },
        );
      }

      product.status = "discontinued";

      audit(state, user.id, "product.discontinued", "product", product.id, `Discontinued ${product.sku}`, [
        { field: "status", from: "active", to: "discontinued" },
      ]);

      return product;
    },
  }),

  defineTool({
    name: "get_product_availability",
    description:
      "Stock position for one product across every warehouse, with totals and reorder status.",
    inputSchema: schema({ productId: S.string("Product ID.") }, ["productId"]),
    run(state, input) {
      const product = requireProduct(state, readString(input, "productId"));

      const records = Object.values(state.inventory)
        .filter((record) => record.productId === product.id)
        .sort((a, b) => a.warehouseId.localeCompare(b.warehouseId));

      const byWarehouse = records.map((record) => ({
        warehouseId: record.warehouseId,
        warehouseName: state.warehouses[record.warehouseId]?.name ?? record.warehouseId,
        quantityOnHand: record.quantityOnHand,
        quantityReserved: record.quantityReserved,
        quantityAvailable: availableQuantity(record),
        quantityInbound: record.quantityInbound,
        reorderPoint: record.reorderPoint ?? product.reorderPoint,
        belowReorderPoint: record.quantityOnHand < (record.reorderPoint ?? product.reorderPoint),
      }));

      return {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        uom: product.uom,
        totalOnHand: byWarehouse.reduce((total, row) => total + row.quantityOnHand, 0),
        totalAvailable: byWarehouse.reduce((total, row) => total + row.quantityAvailable, 0),
        totalInbound: byWarehouse.reduce((total, row) => total + row.quantityInbound, 0),
        byWarehouse,
      };
    },
  }),

  defineTool({
    name: "get_product_pricing",
    description:
      "Pricing view for a product: list price, standard cost, margin, and the most recent purchase price per vendor.",
    inputSchema: schema({ productId: S.string("Product ID.") }, ["productId"]),
    run(state, input) {
      const product = requireProduct(state, readString(input, "productId"));

      const vendorPrices = new Map<string, { unitPrice: number; purchaseOrderId: string; date: string }>();

      for (const order of Object.values(state.purchaseOrders)) {
        if (order.status === "cancelled" || order.status === "draft") continue;

        for (const line of order.lines) {
          if (line.productId !== product.id) continue;

          const existing = vendorPrices.get(order.vendorId);
          if (!existing || existing.date < order.createdAt) {
            vendorPrices.set(order.vendorId, {
              unitPrice: line.unitPrice.amount,
              purchaseOrderId: order.id,
              date: order.createdAt,
            });
          }
        }
      }

      const margin = product.listPrice.amount - product.standardCost.amount;

      return {
        productId: product.id,
        sku: product.sku,
        listPrice: product.listPrice,
        standardCost: product.standardCost,
        marginAmount: money(margin, product.listPrice.currency),
        marginPercent:
          product.listPrice.amount === 0
            ? 0
            : Math.round((margin / product.listPrice.amount) * 1000) / 10,
        preferredVendorIds: product.preferredVendorIds,
        lastPurchasePriceByVendor: [...vendorPrices.entries()]
          .map(([vendorId, value]) => ({ vendorId, ...value }))
          .sort((a, b) => a.vendorId.localeCompare(b.vendorId)),
      };
    },
  }),
];
