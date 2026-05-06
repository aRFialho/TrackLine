const { contextBridge, ipcRenderer } = require("electron");

const API_PORT_PREFIX = "--trackline-api-port=";
const API_URL_PREFIX = "--trackline-api-url=";
const APP_VERSION_PREFIX = "--trackline-app-version=";

function resolveApiPort() {
  const arg = process.argv.find((value) => value.startsWith(API_PORT_PREFIX));
  if (!arg) {
    return 8787;
  }

  const parsed = Number(arg.slice(API_PORT_PREFIX.length));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 8787;
  }

  return parsed;
}

const apiPort = resolveApiPort();
const apiUrlArg = process.argv.find((value) => value.startsWith(API_URL_PREFIX));
const explicitApiUrl = apiUrlArg ? apiUrlArg.slice(API_URL_PREFIX.length).trim() : "";
const appVersionArg = process.argv.find((value) => value.startsWith(APP_VERSION_PREFIX));
const appVersion = appVersionArg ? appVersionArg.slice(APP_VERSION_PREFIX.length).trim() : "0.0.0";

contextBridge.exposeInMainWorld("trackline", {
  platform: "desktop",
  apiBaseUrl: explicitApiUrl || `http://127.0.0.1:${apiPort}`,
  appVersion,
  getAppVersion: () => ipcRenderer.invoke("trackline:getAppVersion"),
  installDesktopUpdate: (downloadUrl) => ipcRenderer.invoke("trackline:installDesktopUpdate", downloadUrl)
});
