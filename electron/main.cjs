const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const os = require("node:os");
const { spawn } = require("node:child_process");
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
  const { app, BrowserWindow, ipcMain, shell } = electron;

  const isDev = !app.isPackaged;
  const remoteApiUrl = String(process.env.TRACKLINE_REMOTE_API_URL || process.env.VITE_API_URL || "").trim();
  const shouldUseEmbeddedApi = isDev || !remoteApiUrl;
  const apiPort = Number(process.env.API_PORT || (isDev ? 8787 : 38787));
  const updateDownloadDir = path.join(os.tmpdir(), "trackline-updates");

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

  function sanitizeDownloadedFileName(urlString) {
    try {
      const parsed = new URL(urlString);
      const baseName = path.basename(parsed.pathname) || "TrackLine-Update.exe";
      const safeBaseName = baseName.replace(/[^\w.\-]/g, "_");
      return safeBaseName || "TrackLine-Update.exe";
    } catch (_error) {
      return `TrackLine-Update-${Date.now()}.exe`;
    }
  }

  function downloadFileWithRedirects(urlString, targetFilePath, maxRedirects = 5) {
    return new Promise((resolve, reject) => {
      if (maxRedirects < 0) {
        reject(new Error("Muitos redirecionamentos no download de atualizacao."));
        return;
      }

      let parsed;
      try {
        parsed = new URL(urlString);
      } catch (_error) {
        reject(new Error("URL de atualizacao invalida."));
        return;
      }

      const client = parsed.protocol === "https:" ? https : parsed.protocol === "http:" ? http : null;
      if (!client) {
        reject(new Error("Protocolo de URL nao suportado para atualizacao."));
        return;
      }

      const request = client.get(parsed, (response) => {
        const statusCode = Number(response.statusCode || 0);

        if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
          response.resume();
          const redirected = new URL(response.headers.location, parsed).toString();
          downloadFileWithRedirects(redirected, targetFilePath, maxRedirects - 1).then(resolve).catch(reject);
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          reject(new Error(`Falha no download da atualizacao (HTTP ${statusCode}).`));
          return;
        }

        fs.mkdirSync(path.dirname(targetFilePath), { recursive: true });
        const fileStream = fs.createWriteStream(targetFilePath);
        response.pipe(fileStream);

        fileStream.on("finish", () => {
          fileStream.close(() => resolve(targetFilePath));
        });

        fileStream.on("error", (error) => {
          try {
            fs.unlinkSync(targetFilePath);
          } catch (_error) {
            // ignore cleanup error
          }
          reject(error);
        });
      });

      request.on("error", (error) => {
        reject(error);
      });
    });
  }

  async function installDesktopUpdate(downloadUrl) {
    const parsed = new URL(downloadUrl);
    if (!["https:", "http:"].includes(parsed.protocol)) {
      throw new Error("URL de atualizacao deve usar http ou https.");
    }

    const downloadedName = sanitizeDownloadedFileName(downloadUrl);
    const targetPath = path.join(updateDownloadDir, downloadedName);
    const downloadedFilePath = await downloadFileWithRedirects(downloadUrl, targetPath);
    const lower = downloadedFilePath.toLowerCase();

    if (lower.endsWith(".exe")) {
      const args = ["/SP-", "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"];
      const child = spawn(downloadedFilePath, args, {
        detached: true,
        stdio: "ignore"
      });
      child.unref();
      app.quit();
      return { ok: true, mode: "silent-installer", filePath: downloadedFilePath };
    }

    await shell.openPath(downloadedFilePath);
    return { ok: true, mode: "open-file", filePath: downloadedFilePath };
  }

  app.whenReady().then(async () => {
    ipcMain.handle("trackline:getAppVersion", async () => app.getVersion());
    ipcMain.handle("trackline:installDesktopUpdate", async (_event, downloadUrl) => {
      const nextUrl = String(downloadUrl || "").trim();
      if (!nextUrl) {
        throw new Error("URL de atualizacao nao informada.");
      }
      return installDesktopUpdate(nextUrl);
    });

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
