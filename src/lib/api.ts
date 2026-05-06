import type {
  BatchOperationMode,
  Employee,
  ProductionNotification,
  ProductionOrder,
  Sector,
  WorkSchedule
} from "../types";
import type { ImportedRow } from "./importers";

export type BootstrapSnapshot = {
  schedule: WorkSchedule;
  sectors: Sector[];
  employees: Employee[];
  orders: ProductionOrder[];
  notifications: ProductionNotification[];
};

export type AuthUser = {
  id: string;
  email: string;
  role: "admin" | "operator";
};

type AuthLoginResponse = {
  token: string;
  user: AuthUser;
};

export const AUTH_TOKEN_KEY = "trackline-auth-token";
export const AUTH_TOKEN_SESSION_KEY = "trackline-auth-token-session";

const desktopApiBaseUrl =
  typeof window !== "undefined" && typeof window.trackline?.apiBaseUrl === "string"
    ? window.trackline.apiBaseUrl
    : undefined;

const envApiUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
const envAndroidApiUrl = (import.meta.env.VITE_ANDROID_API_URL as string | undefined)?.trim();

const isNativePlatform =
  typeof window !== "undefined" && typeof window.Capacitor?.isNativePlatform === "function"
    ? window.Capacitor.isNativePlatform()
    : false;

const nativePlatform =
  typeof window !== "undefined" && typeof window.Capacitor?.getPlatform === "function"
    ? window.Capacitor.getPlatform()
    : undefined;

const looksLikeLocalhost = (value?: string) => !!value && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(value);
const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, "");

let baseUrl = desktopApiBaseUrl || envApiUrl || "http://localhost:8787";

if (isNativePlatform && nativePlatform === "android" && looksLikeLocalhost(baseUrl)) {
  // In Android emulator, localhost from WebView points to the device itself.
  // Use 10.0.2.2 to reach the host machine API when no remote URL is configured.
  baseUrl = envAndroidApiUrl || "http://10.0.2.2:8787";
}

baseUrl = normalizeBaseUrl(baseUrl);

export const getStoredToken = () =>
  localStorage.getItem(AUTH_TOKEN_KEY) ?? sessionStorage.getItem(AUTH_TOKEN_SESSION_KEY) ?? undefined;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getStoredToken();
  const authHeaders: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
      ...(init?.headers ?? {})
    },
    ...init
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({ message: "Falha na requisicao" }))) as { message?: string };
    throw new Error(payload.message || `Erro HTTP ${response.status}`);
  }

  return (await response.json()) as T;
}

export function connectRealtime(onRefresh: () => void): (() => void) | undefined {
  const token = getStoredToken();
  if (!token) {
    return undefined;
  }

  const url = `${baseUrl}/events?token=${encodeURIComponent(token)}`;
  const source = new EventSource(url);

  const refreshHandler = () => {
    onRefresh();
  };

  source.addEventListener("refresh", refreshHandler);

  source.onerror = () => {
    // browser will auto-retry; no-op to avoid noise
  };

  return () => {
    source.removeEventListener("refresh", refreshHandler);
    source.close();
  };
}

export const api = {
  login: (email: string, password: string) =>
    request<AuthLoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    }),
  me: () => request<AuthUser>("/auth/me"),
  bootstrap: () => request<BootstrapSnapshot>("/bootstrap"),
  addSector: (name: string) =>
    request<BootstrapSnapshot>("/sectors", {
      method: "POST",
      body: JSON.stringify({ name })
    }),
  addEmployee: (name: string, sectorIds: string[]) =>
    request<BootstrapSnapshot>("/employees", {
      method: "POST",
      body: JSON.stringify({ name, sectorIds })
    }),
  updateEmployee: (employeeId: string, name: string, sectorIds: string[]) =>
    request<BootstrapSnapshot>(`/employees/${employeeId}`, {
      method: "PUT",
      body: JSON.stringify({ name, sectorIds })
    }),
  deleteEmployee: (employeeId: string) =>
    request<BootstrapSnapshot>(`/employees/${employeeId}`, {
      method: "DELETE"
    }),
  updateSchedule: (schedule: WorkSchedule) =>
    request<BootstrapSnapshot>("/schedule", {
      method: "POST",
      body: JSON.stringify(schedule)
    }),
  createOrder: (payload: { number: string; name: string; rows: ImportedRow[] }) =>
    request<BootstrapSnapshot>("/orders/import", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  finalizeOrder: (orderId: string) =>
    request<BootstrapSnapshot>(`/orders/${orderId}/finalize`, {
      method: "POST"
    }),
  deleteOrder: (orderId: string) =>
    request<BootstrapSnapshot>(`/orders/${orderId}`, {
      method: "DELETE"
    }),
  setOperationDone: (payload: { itemId: string; sectorId: string; employeeId: string; done: boolean; reason?: string }) =>
    request<BootstrapSnapshot>("/operations/toggle", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  batchSetOperations: (payload: {
    orderId: string;
    sectorId: string;
    employeeId: string;
    mode: BatchOperationMode;
    itemId?: string;
    description?: string;
    quantity?: number;
  }) =>
    request<BootstrapSnapshot>("/operations/batch-toggle", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  reorderSectors: (sectorIds: string[]) =>
    request<BootstrapSnapshot>("/sectors/reorder", {
      method: "POST",
      body: JSON.stringify({ sectorIds })
    })
};
