const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const http = require("node:http");

const isDev = !app.isPackaged;
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
  if (isDev) {
    return;
  }
  process.env.API_PORT = String(apiPort);
  require(path.join(__dirname, "..", "server", "index.cjs"));
  await waitForApiReady(apiPort);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1366,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: "TrackLine",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "..", "public", "TL.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      additionalArguments: [`--trackline-api-port=${apiPort}`]
    }
  });

  if (isDev) {
    win.loadURL("http://localhost:5173");
    return;
  }

  win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

app.whenReady().then(async () => {
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
