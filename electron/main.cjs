const path = require("node:path");
const http = require("node:http");
const fs = require("node:fs");
const dotenv = require("dotenv");
const electron = require("electron");

const envCandidates = [
  process.resourcesPath ? path.join(process.resourcesPath, ".env") : undefined,
  path.resolve(process.cwd(), ".env"),
  path.resolve(__dirname, "..", ".env")
].filter(Boolean);

const envPath = envCandidates.find((candidate) => fs.existsSync(candidate));
if (envPath) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

if (!electron?.app || !electron?.BrowserWindow) {
  require(path.join(__dirname, "..", "server", "index.cjs"));
} else {
  const { app, BrowserWindow, ipcMain } = electron;

  const isDev = !app.isPackaged;
  const remoteApiUrl = String(process.env.TRACKLINE_REMOTE_API_URL || process.env.VITE_API_URL || "").trim();
  const shouldUseEmbeddedApi = isDev || !remoteApiUrl;
  const apiPort = Number(process.env.API_PORT || (isDev ? 8787 : 38787));

  function waitForApiReady(port, timeoutMs = 20000) {
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        const req = http.get(
          {
            host: "127.0.0.1",
            port,
            path: "/health",
            timeout: 1500
          },
          (res) => {
            res.resume();
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
              resolve();
              return;
            }
            retry();
          }
        );
        req.on("error", retry);
        req.on("timeout", () => {
          req.destroy();
          retry();
        });
      };

      const retry = () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`API nao respondeu na porta ${port}`));
          return;
        }
        setTimeout(check, 400);
      };

      check();
    });
  }

  async function ensureEmbeddedApi() {
    if (!shouldUseEmbeddedApi) {
      return;
    }
    process.env.API_PORT = String(apiPort);
    require(path.join(__dirname, "..", "server", "index.cjs"));
    await waitForApiReady(apiPort);
  }

  function resolveWindowIcon() {
    const iconFile = process.platform === "win32" ? "TL.ico" : "TL.png";
    if (isDev) {
      return path.join(__dirname, "..", "public", iconFile);
    }
    return path.join(__dirname, "..", "dist", iconFile);
  }

  function createWindow() {
    const appVersion = app.getVersion();
    const additionalArguments = shouldUseEmbeddedApi
      ? [`--trackline-api-port=${apiPort}`, `--trackline-app-version=${appVersion}`]
      : [`--trackline-api-url=${remoteApiUrl}`, `--trackline-app-version=${appVersion}`];

    const win = new BrowserWindow({
      width: 1366,
      height: 900,
      minWidth: 1000,
      minHeight: 700,
      title: "TrackLine",
      autoHideMenuBar: true,
      icon: resolveWindowIcon(),
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        additionalArguments
      }
    });

    if (isDev) {
      win.loadURL("http://localhost:5173");
      return;
    }

    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  app.whenReady().then(async () => {
    ipcMain.handle("trackline:getAppVersion", async () => app.getVersion());

    if (process.platform === "win32") {
      app.setAppUserModelId("com.trackline.app");
    }
    await ensureEmbeddedApi();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
