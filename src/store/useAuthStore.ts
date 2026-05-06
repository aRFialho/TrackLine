import { create } from "zustand";
import { api, AUTH_TOKEN_KEY, AUTH_TOKEN_SESSION_KEY, type AuthUser } from "../lib/api";
import { useProductionStore } from "./useProductionStore";

const AUTH_USER_KEY = "trackline-auth-user";

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

const loadStoredUser = () => {
  const raw = localStorage.getItem(AUTH_USER_KEY) ?? sessionStorage.getItem(AUTH_USER_KEY);
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as AuthUser;
  } catch (_error) {
    localStorage.removeItem(AUTH_USER_KEY);
    sessionStorage.removeItem(AUTH_USER_KEY);
    return undefined;
  }
};

const persistUser = (user: AuthUser, rememberMe: boolean) => {
  if (rememberMe) {
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
    sessionStorage.removeItem(AUTH_USER_KEY);
    return;
  }
  sessionStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  localStorage.removeItem(AUTH_USER_KEY);
};

export const useAuthStore = create<AuthState>()((set, get) => ({
  token: loadToken(),
  user: loadStoredUser(),
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
      persistUser(user, get().rememberMe);
      set({ user, initialized: true });
    } catch (_error) {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      sessionStorage.removeItem(AUTH_TOKEN_SESSION_KEY);
      localStorage.removeItem(AUTH_USER_KEY);
      sessionStorage.removeItem(AUTH_USER_KEY);
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
      persistUser(result.user, rememberMe);
      set({
        token: result.token,
        user: result.user,
        initialized: true,
        rememberMe
      });
      void useProductionStore.getState().bootstrap();
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
    localStorage.removeItem(AUTH_USER_KEY);
    sessionStorage.removeItem(AUTH_USER_KEY);
    useProductionStore.getState().resetStore();
    set({ token: undefined, user: undefined, error: undefined });
  }
}));
