import { create } from "zustand";
import { api, AUTH_TOKEN_KEY, AUTH_TOKEN_SESSION_KEY, type AuthUser } from "../lib/api";
import { useProductionStore } from "./useProductionStore";

type AuthState = {
  token?: string;
  user?: AuthUser;
  initialized: boolean;
  loading: boolean;
  error?: string;
  rememberMe: boolean;
  bootstrap: () => Promise<void>;
  login: (email: string, password: string, rememberMe: boolean) => Promise<void>;
  logout: () => void;
};

const loadToken = () =>
  localStorage.getItem(AUTH_TOKEN_KEY) ?? sessionStorage.getItem(AUTH_TOKEN_SESSION_KEY) ?? undefined;

export const useAuthStore = create<AuthState>()((set, get) => ({
  token: loadToken(),
  user: undefined,
  initialized: false,
  loading: false,
  rememberMe: Boolean(localStorage.getItem(AUTH_TOKEN_KEY)),
  bootstrap: async () => {
    const token = get().token ?? loadToken();
    if (!token) {
      set({ initialized: true, loading: false, user: undefined, token: undefined });
      return;
    }

    set({ loading: true, error: undefined, token });
    try {
      const user = await api.me();
      set({ user, initialized: true });
    } catch (_error) {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      sessionStorage.removeItem(AUTH_TOKEN_SESSION_KEY);
      set({ token: undefined, user: undefined, initialized: true, error: "Sessao expirada." });
    } finally {
      set({ loading: false });
    }
  },
  login: async (email, password, rememberMe) => {
    set({ loading: true, error: undefined });
    try {
      const result = await api.login(email, password);
      if (rememberMe) {
        localStorage.setItem(AUTH_TOKEN_KEY, result.token);
        sessionStorage.removeItem(AUTH_TOKEN_SESSION_KEY);
      } else {
        sessionStorage.setItem(AUTH_TOKEN_SESSION_KEY, result.token);
        localStorage.removeItem(AUTH_TOKEN_KEY);
      }
      set({
        token: result.token,
        user: result.user,
        initialized: true,
        rememberMe
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Falha no login."
      });
      throw error;
    } finally {
      set({ loading: false });
    }
  },
  logout: () => {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    sessionStorage.removeItem(AUTH_TOKEN_SESSION_KEY);
    useProductionStore.getState().resetStore();
    set({ token: undefined, user: undefined, error: undefined });
  }
}));
