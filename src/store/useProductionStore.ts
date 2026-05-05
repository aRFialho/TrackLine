import { create } from "zustand";
import type { Employee, ProductionNotification, ProductionOrder, Sector, WorkSchedule } from "../types";
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
  bootstrap: () => Promise<void>;
  addSector: (name: string) => Promise<void>;
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

async function runMutation(
  set: (partial: Partial<StoreState>) => void,
  operation: () => Promise<BootstrapSnapshot>
): Promise<void> {
  set({ loading: true, error: undefined });
  suppressRealtimeUntil = Date.now() + 1800;
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
  bootstrap: async () => {
    set({ loading: true, error: undefined });
    try {
      const snapshot = await api.bootstrap();
      applySnapshot(set, snapshot);
      if (!disconnectRealtime) {
        disconnectRealtime = connectRealtime(() => {
          if (Date.now() < suppressRealtimeUntil) {
            return;
          }
          void useProductionStore.getState().bootstrap();
        });
      }
      set({ initialized: true });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Falha ao carregar dados iniciais.",
        initialized: true
      });
    } finally {
      set({ loading: false });
    }
  },
  addSector: async (name) => runMutation(set, () => api.addSector(name)),
  addEmployee: async (name, sectorIds) => runMutation(set, () => api.addEmployee(name, sectorIds)),
  updateEmployee: async (employeeId, name, sectorIds) => runMutation(set, () => api.updateEmployee(employeeId, name, sectorIds)),
  deleteEmployee: async (employeeId) => runMutation(set, () => api.deleteEmployee(employeeId)),
  updateSchedule: async (next) => runMutation(set, () => api.updateSchedule(next)),
  createOrder: async (payload) => runMutation(set, () => api.createOrder(payload)),
  deleteOrder: async (orderId) => runMutation(set, () => api.deleteOrder(orderId)),
  finalizeOrder: async (orderId) => runMutation(set, () => api.finalizeOrder(orderId)),
  setOperationDone: async ({ itemId, sectorId, employeeId, done }) => {
    set({ error: undefined });
    suppressRealtimeUntil = Date.now() + 1800;
    try {
      const snapshot = await api.setOperationDone({ itemId, sectorId, employeeId, done });
      applySnapshot(set, snapshot);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Falha ao atualizar operacao." });
    }
  }
}));
