import { availableQuantity, nextId } from "../state.js";
import {
  S,
  defineTool,
  pagingProperties,
  paginate,
  readNumber,
  readOptionalString,
  readString,
  schema,
  toolError,
} from "./contract.js";
import {
  actor,
  applyStockChange,
  audit,
  ensureInventory,
  inventorySummary,
  requireInventory,
  requireProduct,
  requireWarehouse,
} from "./helpers.js";

export const inventoryTools = [
  defineTool({
    name: "list_warehouses",
    description: "List warehouses.",
    inputSchema: schema({ activeOnly: S.boolean("Only active warehouses.") }),
    run(state, input) {
      const activeOnly = input["activeOnly"] === true;

      return Object.values(state.warehouses)
        .filter((warehouse) => (activeOnly ? warehouse.isActive : true))
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((warehouse) => ({
          id: warehouse.id,
          code: warehouse.code,
          name: warehouse.name,
          type: warehouse.type,
          city: warehouse.address.city,
          managerUserId: warehouse.managerUserId,
          isActive: warehouse.isActive,
        }));
    },
  }),

  defineTool({
    name: "get_warehouse",
    description: "Get one warehouse with a summary of what it holds.",
    inputSchema: schema({ warehouseId: S.string("Warehouse ID, e.g. 'WH-001'.") }, [
      "warehouseId",
    ]),
    run(state, input) {
      const warehouse = requireWarehouse(state, readString(input, "warehouseId"));

      const records = Object.values(state.inventory).filter(
        (record) => record.warehouseId === warehouse.id,
      );

      return {
        ...warehouse,
        distinctProducts: records.length,
        totalUnitsOnHand: records.reduce((total, record) => total + record.quantityOnHand, 0),
        totalUnitsReserved: records.reduce((total, record) => total + record.quantityReserved, 0),
      };
    },
  }),

  defineTool({
    name: "list_inventory",
    description:
      "List inventory records, optionally filtered by product, warehouse or low-stock status.",
    inputSchema: schema({
      productId: S.string("Only records for this product."),
      warehouseId: S.string("Only records at this warehouse."),
      lowStockOnly: S.boolean("Only records at or below their reorder point."),
      ...pagingProperties,
    }),
    run(state, input) {
      const productId = readOptionalString(input, "productId");
      const warehouseId = readOptionalString(input, "warehouseId");
      const lowStockOnly = input["lowStockOnly"] === true;

      if (productId) requireProduct(state, productId);
      if (warehouseId) requireWarehouse(state, warehouseId);

      const records = Object.values(state.inventory)
        .filter((record) => (productId ? record.productId === productId : true))
        .filter((record) => (warehouseId ? record.warehouseId === warehouseId : true))
        .filter((record) => {
          if (!lowStockOnly) return true;
          const product = state.products[record.productId];
          const reorderPoint = record.reorderPoint ?? product?.reorderPoint ?? 0;
          return record.quantityOnHand < reorderPoint;
        })
        .sort((a, b) => a.id.localeCompare(b.id));

      const page = paginate(records, input);

      return {
        ...page,
        results: page.results.map((record) => inventorySummary(state, record)),
      };
    },
  }),

  defineTool({
    name: "get_inventory",
    description: "Get the inventory record for one product at one warehouse.",
    inputSchema: schema(
      {
        productId: S.string("Product ID."),
        warehouseId: S.string("Warehouse ID."),
      },
      ["productId", "warehouseId"],
    ),
    run(state, input) {
      const record = requireInventory(
        state,
        readString(input, "productId"),
        readString(input, "warehouseId"),
      );

      return inventorySummary(state, record);
    },
  }),

  defineTool({
    name: "get_available_quantity",
    description:
      "Available (on hand minus reserved) quantity for a product, at one warehouse or across all of them.",
    inputSchema: schema(
      {
        productId: S.string("Product ID."),
        warehouseId: S.string("Optional warehouse ID; omit to total across warehouses."),
      },
      ["productId"],
    ),
    run(state, input) {
      const product = requireProduct(state, readString(input, "productId"));
      const warehouseId = readOptionalString(input, "warehouseId");

      if (warehouseId) {
        const record = requireInventory(state, product.id, warehouseId);

        return {
          productId: product.id,
          warehouseId,
          quantityOnHand: record.quantityOnHand,
          quantityReserved: record.quantityReserved,
          quantityAvailable: availableQuantity(record),
        };
      }

      const records = Object.values(state.inventory).filter(
        (record) => record.productId === product.id,
      );

      return {
        productId: product.id,
        quantityOnHand: records.reduce((total, record) => total + record.quantityOnHand, 0),
        quantityReserved: records.reduce((total, record) => total + record.quantityReserved, 0),
        quantityAvailable: records.reduce((total, record) => total + availableQuantity(record), 0),
        warehouses: records
          .map((record) => ({
            warehouseId: record.warehouseId,
            quantityAvailable: availableQuantity(record),
          }))
          .sort((a, b) => a.warehouseId.localeCompare(b.warehouseId)),
      };
    },
  }),

  defineTool({
    name: "list_low_stock",
    description:
      "Products at or below their reorder point, with the shortfall and suggested reorder quantity.",
    inputSchema: schema({
      warehouseId: S.string("Only check this warehouse."),
      ...pagingProperties,
    }),
    run(state, input) {
      const warehouseId = readOptionalString(input, "warehouseId");
      if (warehouseId) requireWarehouse(state, warehouseId);

      const rows = Object.values(state.inventory)
        .filter((record) => (warehouseId ? record.warehouseId === warehouseId : true))
        .flatMap((record) => {
          const product = state.products[record.productId];
          if (!product) return [];

          const reorderPoint = record.reorderPoint ?? product.reorderPoint;
          if (record.quantityOnHand >= reorderPoint) return [];

          return [
            {
              productId: record.productId,
              sku: product.sku,
              name: product.name,
              warehouseId: record.warehouseId,
              quantityOnHand: record.quantityOnHand,
              quantityAvailable: availableQuantity(record),
              quantityInbound: record.quantityInbound,
              reorderPoint,
              shortfall: reorderPoint - record.quantityOnHand,
              suggestedOrderQuantity: product.reorderQuantity,
              preferredVendorIds: product.preferredVendorIds,
            },
          ];
        })
        .sort((a, b) => b.shortfall - a.shortfall);

      return paginate(rows, input);
    },
  }),

  defineTool({
    name: "adjust_inventory",
    description:
      "Correct on-hand stock by a signed delta, for example after a cycle count or write-off.",
    inputSchema: schema(
      {
        productId: S.string("Product ID."),
        warehouseId: S.string("Warehouse ID."),
        quantityDelta: S.integer("Signed adjustment; negative reduces stock."),
        reason: S.string("Why the adjustment is being made."),
        actorUserId: S.string("User performing the action."),
      },
      ["productId", "warehouseId", "quantityDelta", "reason", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const productId = readString(input, "productId");
      const warehouseId = readString(input, "warehouseId");
      const quantityDelta = readNumber(input, "quantityDelta", { integer: true });
      const reason = readString(input, "reason");

      if (quantityDelta === 0) {
        throw toolError("invalid_input", "\"quantityDelta\" must not be zero.");
      }

      requireProduct(state, productId);
      requireWarehouse(state, warehouseId);

      const adjustmentId = nextId(state, "ADJ");

      const { record, movement } = applyStockChange(state, {
        productId,
        warehouseId,
        quantityDelta,
        reservedDelta: 0,
        type: "adjustment",
        referenceType: "adjustment",
        referenceId: adjustmentId,
        actorUserId: user.id,
        note: reason,
      });

      audit(
        state,
        user.id,
        "inventory.adjusted",
        "inventory",
        record.id,
        `Adjusted ${productId} at ${warehouseId} by ${quantityDelta}: ${reason}`,
        [{ field: "quantityOnHand", from: record.quantityOnHand - quantityDelta, to: record.quantityOnHand }],
      );

      return { adjustmentId, movementId: movement.id, inventory: inventorySummary(state, record) };
    },
  }),

  defineTool({
    name: "transfer_inventory",
    description:
      "Move stock between warehouses. Only unreserved stock can be transferred.",
    inputSchema: schema(
      {
        productId: S.string("Product ID."),
        fromWarehouseId: S.string("Source warehouse ID."),
        toWarehouseId: S.string("Destination warehouse ID."),
        quantity: S.integer("Units to move.", { minimum: 1 }),
        reason: S.string("Why the stock is being moved."),
        actorUserId: S.string("User performing the action."),
      },
      ["productId", "fromWarehouseId", "toWarehouseId", "quantity", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const productId = readString(input, "productId");
      const fromWarehouseId = readString(input, "fromWarehouseId");
      const toWarehouseId = readString(input, "toWarehouseId");
      const quantity = readNumber(input, "quantity", { min: 1, integer: true });
      const reason = readOptionalString(input, "reason") ?? "Stock transfer";

      if (fromWarehouseId === toWarehouseId) {
        throw toolError("invalid_input", "Source and destination warehouses must differ.");
      }

      requireProduct(state, productId);
      requireWarehouse(state, fromWarehouseId);
      const destination = requireWarehouse(state, toWarehouseId);

      if (!destination.isActive) {
        throw toolError("not_allowed", `Warehouse ${destination.id} is not active.`);
      }

      const source = requireInventory(state, productId, fromWarehouseId);

      if (availableQuantity(source) < quantity) {
        throw toolError(
          "insufficient_stock",
          `Only ${availableQuantity(source)} units of ${productId} are available at ${fromWarehouseId} (${source.quantityReserved} reserved).`,
          { available: availableQuantity(source), requested: quantity },
        );
      }

      const transferId = nextId(state, "TRF");

      applyStockChange(state, {
        productId,
        warehouseId: fromWarehouseId,
        quantityDelta: -quantity,
        reservedDelta: 0,
        type: "transfer_out",
        referenceType: "transfer",
        referenceId: transferId,
        actorUserId: user.id,
        note: reason,
      });

      const { record: destinationRecord } = applyStockChange(state, {
        productId,
        warehouseId: toWarehouseId,
        quantityDelta: quantity,
        reservedDelta: 0,
        type: "transfer_in",
        referenceType: "transfer",
        referenceId: transferId,
        actorUserId: user.id,
        note: reason,
      });

      audit(
        state,
        user.id,
        "inventory.transferred",
        "inventory",
        destinationRecord.id,
        `Transferred ${quantity} of ${productId} from ${fromWarehouseId} to ${toWarehouseId}`,
      );

      return {
        transferId,
        productId,
        quantity,
        from: inventorySummary(state, requireInventory(state, productId, fromWarehouseId)),
        to: inventorySummary(state, destinationRecord),
      };
    },
  }),

  defineTool({
    name: "reserve_inventory",
    description:
      "Reserve available stock at a warehouse. Reserved units stay on hand but cannot be transferred or reserved again.",
    inputSchema: schema(
      {
        productId: S.string("Product ID."),
        warehouseId: S.string("Warehouse ID."),
        quantity: S.integer("Units to reserve.", { minimum: 1 }),
        referenceId: S.string("Sales order or other reference this reservation is for."),
        actorUserId: S.string("User performing the action."),
      },
      ["productId", "warehouseId", "quantity", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const productId = readString(input, "productId");
      const warehouseId = readString(input, "warehouseId");
      const quantity = readNumber(input, "quantity", { min: 1, integer: true });
      const referenceId = readOptionalString(input, "referenceId") ?? null;

      const { record } = applyStockChange(state, {
        productId,
        warehouseId,
        quantityDelta: 0,
        reservedDelta: quantity,
        type: "reservation",
        referenceType: referenceId ? "sales_order" : "manual",
        referenceId,
        actorUserId: user.id,
        note: `Reserved ${quantity} units`,
      });

      return inventorySummary(state, record);
    },
  }),

  defineTool({
    name: "release_reservation",
    description: "Release previously reserved stock back to available.",
    inputSchema: schema(
      {
        productId: S.string("Product ID."),
        warehouseId: S.string("Warehouse ID."),
        quantity: S.integer("Units to release.", { minimum: 1 }),
        referenceId: S.string("Reference the reservation was made against."),
        actorUserId: S.string("User performing the action."),
      },
      ["productId", "warehouseId", "quantity", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const productId = readString(input, "productId");
      const warehouseId = readString(input, "warehouseId");
      const quantity = readNumber(input, "quantity", { min: 1, integer: true });
      const referenceId = readOptionalString(input, "referenceId") ?? null;

      const { record } = applyStockChange(state, {
        productId,
        warehouseId,
        quantityDelta: 0,
        reservedDelta: -quantity,
        type: "release",
        referenceType: referenceId ? "sales_order" : "manual",
        referenceId,
        actorUserId: user.id,
        note: `Released ${quantity} reserved units`,
      });

      return inventorySummary(state, record);
    },
  }),

  defineTool({
    name: "count_inventory",
    description:
      "Record a physical count. Sets on-hand to the counted quantity and posts the difference as an adjustment.",
    inputSchema: schema(
      {
        productId: S.string("Product ID."),
        warehouseId: S.string("Warehouse ID."),
        countedQuantity: S.integer("Units physically counted.", { minimum: 0 }),
        actorUserId: S.string("User performing the count."),
      },
      ["productId", "warehouseId", "countedQuantity", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const productId = readString(input, "productId");
      const warehouseId = readString(input, "warehouseId");
      const countedQuantity = readNumber(input, "countedQuantity", { min: 0, integer: true });

      const record = ensureInventory(state, productId, warehouseId);
      const variance = countedQuantity - record.quantityOnHand;

      if (countedQuantity < record.quantityReserved) {
        throw toolError(
          "invalid_state",
          `Counted quantity ${countedQuantity} is below the ${record.quantityReserved} units already reserved.`,
          { reserved: record.quantityReserved },
        );
      }

      if (variance !== 0) {
        applyStockChange(state, {
          productId,
          warehouseId,
          quantityDelta: variance,
          reservedDelta: 0,
          type: "adjustment",
          referenceType: "adjustment",
          referenceId: nextId(state, "ADJ"),
          actorUserId: user.id,
          note: "Physical count variance",
        });
      }

      record.lastCountedAt = state.now;

      audit(
        state,
        user.id,
        "inventory.counted",
        "inventory",
        record.id,
        `Counted ${productId} at ${warehouseId}: variance ${variance}`,
      );

      return { variance, inventory: inventorySummary(state, record) };
    },
  }),

  defineTool({
    name: "list_inventory_movements",
    description:
      "List stock movements, most recent first, optionally filtered by product, warehouse, type or reference.",
    inputSchema: schema({
      productId: S.string("Only movements for this product."),
      warehouseId: S.string("Only movements at this warehouse."),
      type: S.string("Only movements of this type, e.g. 'receipt' or 'issue'."),
      referenceId: S.string("Only movements linked to this reference."),
      ...pagingProperties,
    }),
    run(state, input) {
      const productId = readOptionalString(input, "productId");
      const warehouseId = readOptionalString(input, "warehouseId");
      const type = readOptionalString(input, "type");
      const referenceId = readOptionalString(input, "referenceId");

      const movements = Object.values(state.inventoryMovements)
        .filter((movement) => (productId ? movement.productId === productId : true))
        .filter((movement) => (warehouseId ? movement.warehouseId === warehouseId : true))
        .filter((movement) => (type ? movement.type === type : true))
        .filter((movement) => (referenceId ? movement.referenceId === referenceId : true))
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

      return paginate(movements, input);
    },
  }),

  defineTool({
    name: "get_inventory_movement",
    description: "Get one stock movement by ID.",
    inputSchema: schema({ movementId: S.string("Movement ID, e.g. 'MOV-001'.") }, [
      "movementId",
    ]),
    run(state, input) {
      const id = readString(input, "movementId");
      const movement = state.inventoryMovements[id];

      if (!movement) {
        throw toolError("not_found", `Inventory movement "${id}" was not found.`);
      }

      return movement;
    },
  }),

  defineTool({
    name: "find_warehouses_with_stock",
    description:
      "Find warehouses that can cover a required quantity of a product, ordered by available stock. Use this before fulfilling an order that one site cannot cover alone.",
    inputSchema: schema(
      {
        productId: S.string("Product ID."),
        quantity: S.integer("Quantity required.", { minimum: 1 }),
      },
      ["productId", "quantity"],
    ),
    run(state, input) {
      const product = requireProduct(state, readString(input, "productId"));
      const quantity = readNumber(input, "quantity", { min: 1, integer: true });

      const rows = Object.values(state.inventory)
        .filter((record) => record.productId === product.id && availableQuantity(record) > 0)
        .map((record) => ({
          warehouseId: record.warehouseId,
          warehouseName: state.warehouses[record.warehouseId]?.name ?? record.warehouseId,
          quantityAvailable: availableQuantity(record),
          coversRequirement: availableQuantity(record) >= quantity,
        }))
        .sort((a, b) => b.quantityAvailable - a.quantityAvailable);

      const totalAvailable = rows.reduce((total, row) => total + row.quantityAvailable, 0);

      return {
        productId: product.id,
        quantityRequired: quantity,
        totalAvailable,
        singleWarehouseOption: rows.find((row) => row.coversRequirement)?.warehouseId ?? null,
        requiresSplitAcrossWarehouses:
          totalAvailable >= quantity && !rows.some((row) => row.coversRequirement),
        warehouses: rows,
      };
    },
  }),
];
