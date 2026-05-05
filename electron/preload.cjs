const { contextBridge } = require("electron");

const API_PORT_PREFIX = "--trackline-api-port=";

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

contextBridge.exposeInMainWorld("trackline", {
  platform: "desktop",
  apiBaseUrl: `http://127.0.0.1:${apiPort}`
});
