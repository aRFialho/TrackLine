import { useEffect, useMemo, useState } from "react";
import { api, type AppUpdateInfo } from "../lib/api";

type RuntimePlatform = "desktop" | "android" | "web";

type UpdateState = {
  show: boolean;
  force: boolean;
  platform: RuntimePlatform;
  currentVersion: string;
  info?: AppUpdateInfo;
  error?: string;
  running: boolean;
};

const dismissStoragePrefix = "trackline-update-dismissed";

const normalizeVersion = (value: string) => value.trim().replace(/^v/i, "");

const compareVersions = (a: string, b: string) => {
  const cleanA = normalizeVersion(a).split(/[.-]/).map((part) => Number(part.replace(/\D+/g, "")) || 0);
  const cleanB = normalizeVersion(b).split(/[.-]/).map((part) => Number(part.replace(/\D+/g, "")) || 0);
  const length = Math.max(cleanA.length, cleanB.length);
  for (let index = 0; index < length; index += 1) {
    const left = cleanA[index] ?? 0;
    const right = cleanB[index] ?? 0;
    if (left > right) {
      return 1;
    }
    if (left < right) {
      return -1;
    }
  }
  return 0;
};

const detectPlatform = (): RuntimePlatform => {
  if (window.trackline?.platform === "desktop") {
    return "desktop";
  }
  const isNative = typeof window.Capacitor?.isNativePlatform === "function" ? window.Capacitor.isNativePlatform() : false;
  const nativePlatform = typeof window.Capacitor?.getPlatform === "function" ? window.Capacitor.getPlatform() : "";
  if (isNative && nativePlatform === "android") {
    return "android";
  }
  return "web";
};

const getCurrentVersion = async (platform: RuntimePlatform) => {
  if (platform === "desktop" && typeof window.trackline?.getAppVersion === "function") {
    const version = await window.trackline.getAppVersion();
    return normalizeVersion(version || "0.0.0");
  }
  if (platform === "desktop" && window.trackline?.appVersion) {
    return normalizeVersion(window.trackline.appVersion);
  }
  return normalizeVersion(__APP_VERSION__ || "0.0.0");
};

function UpdatePrompt() {
  const [state, setState] = useState<UpdateState>({
    show: false,
    force: false,
    platform: "web",
    currentVersion: normalizeVersion(__APP_VERSION__ || "0.0.0"),
    running: false
  });

  useEffect(() => {
    let cancelled = false;

    const checkForUpdate = async () => {
      const platform = detectPlatform();
      const currentVersion = await getCurrentVersion(platform);

      try {
        const info = await api.appUpdate();
        if (cancelled) {
          return;
        }
        const latestVersion = normalizeVersion(info.latestVersion || "0.0.0");
        const hasNewVersion = compareVersions(currentVersion, latestVersion) < 0;
        const minVersion = info.minimumSupportedVersion ? normalizeVersion(info.minimumSupportedVersion) : "";
        const belowMinVersion = minVersion ? compareVersions(currentVersion, minVersion) < 0 : false;
        const force = Boolean(info.forceUpdate || belowMinVersion);
        const dismissKey = `${dismissStoragePrefix}:${platform}`;
        const dismissedVersion = localStorage.getItem(dismissKey) || "";

        if (!hasNewVersion || (!force && dismissedVersion === latestVersion)) {
          setState((previous) => ({
            ...previous,
            show: false,
            platform,
            currentVersion,
            info
          }));
          return;
        }

        setState((previous) => ({
          ...previous,
          show: true,
          force,
          platform,
          currentVersion,
          info,
          error: undefined,
          running: false
        }));
      } catch (error) {
        if (cancelled) {
          return;
        }
        setState((previous) => ({
          ...previous,
          show: false,
          platform,
          currentVersion,
          error: error instanceof Error ? error.message : "Falha ao verificar atualizacao."
        }));
      }
    };

    void checkForUpdate();

    return () => {
      cancelled = true;
    };
  }, []);

  const targetDownloadUrl = useMemo(() => {
    if (!state.info) {
      return "";
    }
    if (state.platform === "desktop") {
      return state.info.desktop.downloadUrl || "";
    }
    if (state.platform === "android") {
      return state.info.android.downloadUrl || "";
    }
    return state.info.desktop.downloadUrl || state.info.android.downloadUrl || "";
  }, [state.info, state.platform]);

  if (!state.show || !state.info) {
    return null;
  }

  const latestVersion = normalizeVersion(state.info.latestVersion || "0.0.0");

  const closeModal = () => {
    if (state.force) {
      return;
    }
    const dismissKey = `${dismissStoragePrefix}:${state.platform}`;
    localStorage.setItem(dismissKey, latestVersion);
    setState((previous) => ({ ...previous, show: false }));
  };

  const startUpdate = async () => {
    if (!targetDownloadUrl) {
      setState((previous) => ({
        ...previous,
        error:
          "URL de atualizacao nao configurada no servidor. Defina APP_UPDATE_DESKTOP_URL e APP_UPDATE_ANDROID_URL no Render."
      }));
      return;
    }

    setState((previous) => ({ ...previous, running: true, error: undefined }));
    try {
      if (state.platform === "desktop" && typeof window.trackline?.installDesktopUpdate === "function") {
        await window.trackline.installDesktopUpdate(targetDownloadUrl);
      } else {
        const win = window.open(targetDownloadUrl, "_blank");
        if (!win) {
          window.location.href = targetDownloadUrl;
        }
      }
    } catch (error) {
      setState((previous) => ({
        ...previous,
        running: false,
        error: error instanceof Error ? error.message : "Falha ao iniciar atualizacao."
      }));
    }
  };

  return (
    <div className="update-modal-backdrop" role="presentation">
      <div className="update-modal" role="dialog" aria-modal="true">
        <h2>Atualizacao disponivel</h2>
        <p>
          Versao atual: <b>{state.currentVersion}</b> | Nova versao: <b>{latestVersion}</b>
        </p>
        {state.info.notes ? <p className="muted-line">{state.info.notes}</p> : null}
        <div className="actions">
          {!state.force ? (
            <button type="button" className="mini-btn ghost" onClick={closeModal} disabled={state.running}>
              Lembrar depois
            </button>
          ) : null}
          <button type="button" className="mini-btn" onClick={() => void startUpdate()} disabled={state.running}>
            {state.running ? "Baixando atualizacao..." : "Atualizar agora"}
          </button>
        </div>
        {state.error ? <p className="error">{state.error}</p> : null}
      </div>
    </div>
  );
}

export default UpdatePrompt;
