import { create } from "zustand";
import type {
  BatchOperationMode,
  Employee,
  ProductionNotification,
  ProductionOrder,
  Sector,
  WorkSchedule
} from "../types";
import type { ImportedRow } from "../lib/importers";
import { api, connectRealtime, type BootstrapSnapshot } from "../lib/api";

type StoreState = {
  sectors: Sector[];
  employees: Employee[];
  orders: ProductionOrder[];
  notifications: ProductionNotification[];
  schedule: WorkSchedule;
  selectedOrderId?: string;
  initialized: boolean;
  loading: boolean;
  error?: string;
  setSelectedOrder: (orderId?: string) => void;
  resetStore: () => void;
  bootstrap: (options?: { silent?: boolean }) => Promise<void>;
  addSector: (name: string) => Promise<void>;
  reorderSectors: (sectorIds: string[]) => Promise<void>;
  addEmployee: (name: string, sectorIds: string[]) => Promise<void>;
  updateEmployee: (employeeId: string, name: string, sectorIds: string[]) => Promise<void>;
  deleteEmployee: (employeeId: string) => Promise<void>;
  updateSchedule: (next: WorkSchedule) => Promise<void>;
  createOrder: (payload: { number: string; name: string; rows: ImportedRow[] }) => Promise<void>;
  deleteOrder: (orderId: string) => Promise<void>;
  finalizeOrder: (orderId: string) => Promise<void>;
  setOperationDone: (payload: {
    orderId: string;
    itemId: string;
    sectorId: string;
    employeeId: string;
    done: boolean;
    reason?: string;
  }) => Promise<void>;
  batchSetOperations: (payload: {
    orderId: string;
    sectorId: string;
    employeeId: string;
    mode: BatchOperationMode;
    itemId?: string;
    description?: string;
    quantity?: number;
  }) => Promise<void>;
};

const defaultSchedule: WorkSchedule = {
  workStart: "08:00",
  workEnd: "18:00",
  lunchStart: "12:00",
  lunchEnd: "13:00"
};

let disconnectRealtime: (() => void) | undefined;
let suppressRealtimeUntil = 0;
let realtimeBootstrapInFlight = false;
let realtimeBootstrapQueued = false;

const applySnapshot = (set: (partial: Partial<StoreState>) => void, snapshot: BootstrapSnapshot) => {
  set({
    schedule: snapshot.schedule,
    sectors: snapshot.sectors,
    employees: snapshot.employees,
    orders: snapshot.orders,
    notifications: snapshot.notifications,
    error: undefined
  });
};

const qtyEpsilon = 0.00001;

const cloneOrders = (orders: ProductionOrder[]): ProductionOrder[] =>
  orders.map((order) => ({
    ...order,
    items: order.items.map((item) => ({
      ...item,
      operations: item.operations.map((operation) => ({ ...operation }))
    }))
  }));

const recomputeOrderStatus = (order: ProductionOrder) => {
  const allDone = order.items
    .flatMap((item) => item.operations)
    .every((operation) => operation.status === "CONCLUIDA");
  order.status = allDone ? "FINALIZADA" : "ABERTA";
  if (!allDone) {
    order.finishedAt = undefined;
  }
};

const applyOptimisticOperationChange = (state: StoreState, payload: {
  itemId: string;
  sectorId: string;
  employeeId: string;
  done: boolean;
  requestedQuantity?: number;
}) => {
  const nextOrders = cloneOrders(state.orders);
  const nowIso = new Date().toISOString();

  for (const order of nextOrders) {
    const item = order.items.find((candidate) => candidate.id === payload.itemId);
    if (!item) {
      continue;
    }

    const currentIndex = item.operations.findIndex((operation) => operation.sectorId === payload.sectorId);
    if (currentIndex < 0) {
      continue;
    }

    const currentOperation = item.operations[currentIndex];
    const availableQuantity = Math.max(0, currentOperation.releasedQuantity - currentOperation.completedQuantity);

    if (!payload.done) {
      currentOperation.employeeId = undefined;
      currentOperation.status = "PENDENTE";
      currentOperation.startedAt = undefined;
      currentOperation.finishedAt = undefined;
      currentOperation.usefulMinutes = undefined;
      currentOperation.completedQuantity = 0;
      for (let i = currentIndex + 1; i < item.operations.length; i += 1) {
        item.operations[i].employeeId = undefined;
        item.operations[i].status = "PENDENTE";
        item.operations[i].startedAt = undefined;
        item.operations[i].finishedAt = undefined;
        item.operations[i].usefulMinutes = undefined;
        item.operations[i].releasedQuantity = 0;
        item.operations[i].completedQuantity = 0;
      }
      recomputeOrderStatus(order);
      return nextOrders;
    }

    const qtyToProcess = Math.max(
      0,
      Math.min(availableQuantity, payload.requestedQuantity ?? availableQuantity)
    );
    if (qtyToProcess <= qtyEpsilon) {
      return nextOrders;
    }

    currentOperation.employeeId = payload.employeeId || currentOperation.employeeId;
    currentOperation.startedAt = currentOperation.startedAt ?? nowIso;
    currentOperation.completedQuantity += qtyToProcess;
    if (currentOperation.completedQuantity >= currentOperation.releasedQuantity - qtyEpsilon) {
      currentOperation.status = "CONCLUIDA";
      currentOperation.finishedAt = nowIso;
    } else {
      currentOperation.status = "PENDENTE";
      currentOperation.finishedAt = undefined;
    }

    if (currentIndex + 1 < item.operations.length) {
      const nextOperation = item.operations[currentIndex + 1];
      nextOperation.releasedQuantity += qtyToProcess;
      nextOperation.releasedAt = nowIso;
    }

    recomputeOrderStatus(order);
    return nextOrders;
  }

  return nextOrders;
};

const applyOptimisticBatchLotChange = (
  state: StoreState,
  payload: { orderId: string; sectorId: string; employeeId: string; description: string; requestedQuantity: number }
) => {
  const nextOrders = cloneOrders(state.orders);
  const nowIso = new Date().toISOString();
  const targetOrder = nextOrders.find((order) => order.id === payload.orderId);
  if (!targetOrder) {
    return nextOrders;
  }

  let remaining = payload.requestedQuantity;
  const lotItems = targetOrder.items.filter((item) => item.description === payload.description);
  for (const item of lotItems) {
    if (remaining <= qtyEpsilon) {
      break;
    }

    const currentIndex = item.operations.findIndex((operation) => operation.sectorId === payload.sectorId);
    if (currentIndex < 0) {
      continue;
    }

    const currentOperation = item.operations[currentIndex];
    const availableQuantity = Math.max(0, currentOperation.releasedQuantity - currentOperation.completedQuantity);
    if (availableQuantity <= qtyEpsilon) {
      continue;
    }

    const qtyToProcess = Math.min(availableQuantity, remaining);
    currentOperation.employeeId = payload.employeeId || currentOperation.employeeId;
    currentOperation.startedAt = currentOperation.startedAt ?? nowIso;
    currentOperation.completedQuantity += qtyToProcess;
    if (currentOperation.completedQuantity >= currentOperation.releasedQuantity - qtyEpsilon) {
      currentOperation.status = "CONCLUIDA";
      currentOperation.finishedAt = nowIso;
    } else {
      currentOperation.status = "PENDENTE";
      currentOperation.finishedAt = undefined;
    }

    if (currentIndex + 1 < item.operations.length) {
      const nextOperation = item.operations[currentIndex + 1];
      nextOperation.releasedQuantity += qtyToProcess;
      nextOperation.releasedAt = nowIso;
    }

    remaining -= qtyToProcess;
  }

  recomputeOrderStatus(targetOrder);
  return nextOrders;
};

async function runMutation(
  set: (partial: Partial<StoreState>) => void,
  operation: () => Promise<BootstrapSnapshot>
): Promise<void> {
  set({ loading: true, error: undefined });
  suppressRealtimeUntil = Date.now() + 300;
  try {
    const snapshot = await operation();
    applySnapshot(set, snapshot);
  } catch (error) {
    set({ error: error instanceof Error ? error.message : "Falha de comunicacao com API." });
  } finally {
    set({ loading: false });
  }
}

export const useProductionStore = create<StoreState>()((set) => ({
  sectors: [],
  employees: [],
  orders: [],
  notifications: [],
  schedule: defaultSchedule,
  initialized: false,
  loading: false,
  setSelectedOrder: (orderId) => set({ selectedOrderId: orderId }),
  resetStore: () => {
    if (disconnectRealtime) {
      disconnectRealtime();
      disconnectRealtime = undefined;
    }
    set({
      sectors: [],
      employees: [],
      orders: [],
      notifications: [],
      schedule: defaultSchedule,
      selectedOrderId: undefined,
      initialized: false,
      loading: false,
      error: undefined
    });
  },
  bootstrap: async (options) => {
    const silent = Boolean(options?.silent);
    if (realtimeBootstrapInFlight) {
      realtimeBootstrapQueued = true;
      return;
    }
    realtimeBootstrapInFlight = true;
    if (silent) {
      set({ error: undefined });
    } else {
      set({ loading: true, error: undefined });
    }
    try {
      const snapshot = await api.bootstrap();
      applySnapshot(set, snapshot);
      if (!disconnectRealtime) {
        disconnectRealtime = connectRealtime(() => {
          if (Date.now() < suppressRealtimeUntil) {
            return;
          }
          void useProductionStore.getState().bootstrap({ silent: true });
        });
      }
      set({ initialized: true });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Falha ao carregar dados iniciais.",
        initialized: true
      });
    } finally {
      realtimeBootstrapInFlight = false;
      if (!silent) {
        set({ loading: false });
      }
      if (realtimeBootstrapQueued) {
        realtimeBootstrapQueued = false;
        void useProductionStore.getState().bootstrap({ silent: true });
      }
    }
  },
  addSector: async (name) => runMutation(set, () => api.addSector(name)),
  reorderSectors: async (sectorIds) => runMutation(set, () => api.reorderSectors(sectorIds)),
  addEmployee: async (name, sectorIds) => runMutation(set, () => api.addEmployee(name, sectorIds)),
  updateEmployee: async (employeeId, name, sectorIds) => runMutation(set, () => api.updateEmployee(employeeId, name, sectorIds)),
  deleteEmployee: async (employeeId) => runMutation(set, () => api.deleteEmployee(employeeId)),
  updateSchedule: async (next) => runMutation(set, () => api.updateSchedule(next)),
  createOrder: async (payload) => runMutation(set, () => api.createOrder(payload)),
  deleteOrder: async (orderId) => runMutation(set, () => api.deleteOrder(orderId)),
  finalizeOrder: async (orderId) => runMutation(set, () => api.finalizeOrder(orderId)),
  setOperationDone: async ({ itemId, sectorId, employeeId, done, reason }) => {
    const previousOrders = useProductionStore.getState().orders;
    set((state) => ({
      error: undefined,
      orders: applyOptimisticOperationChange(state, {
        itemId,
        sectorId,
        employeeId,
        done
      })
    }));
    set({ error: undefined });
    suppressRealtimeUntil = Date.now() + 300;
    try {
      const snapshot = await api.setOperationDone({ itemId, sectorId, employeeId, done, reason });
      applySnapshot(set, snapshot);
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Falha ao atualizar operacao.",
        orders: previousOrders
      });
      void useProductionStore.getState().bootstrap();
    }
  },
  batchSetOperations: async ({ orderId, sectorId, employeeId, mode, itemId, description, quantity }) => {
    const previousOrders = useProductionStore.getState().orders;
    if (mode === "CUSTOM_QUANTITY" && description && quantity) {
      set((state) => ({
        error: undefined,
        orders: applyOptimisticBatchLotChange(state, {
          orderId,
          sectorId,
          employeeId,
          description,
          requestedQuantity: quantity
        })
      }));
    } else if (itemId) {
      set((state) => ({
        error: undefined,
        orders: applyOptimisticOperationChange(state, {
          itemId,
          sectorId,
          employeeId,
          done: true,
          requestedQuantity: mode === "CUSTOM_QUANTITY" ? quantity : undefined
        })
      }));
    }
    set({ error: undefined });
    suppressRealtimeUntil = Date.now() + 300;
    try {
      const snapshot = await api.batchSetOperations({ orderId, sectorId, employeeId, mode, itemId, description, quantity });
      applySnapshot(set, snapshot);
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Falha ao executar baixa em lote.",
        orders: previousOrders
      });
      void useProductionStore.getState().bootstrap();
    }
  }
}));
