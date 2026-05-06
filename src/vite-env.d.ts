/// <reference types="vite/client" />

interface TrackLineDesktopBridge {
  platform?: string;
  apiBaseUrl?: string;
  appVersion?: string;
  getAppVersion?: () => Promise<string>;
}

interface CapacitorBridge {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

interface Window {
  trackline?: TrackLineDesktopBridge;
  Capacitor?: CapacitorBridge;
}

declare const __APP_VERSION__: string;
