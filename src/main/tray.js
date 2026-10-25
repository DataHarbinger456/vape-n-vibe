const path = require("node:path");
const { app, Tray, Menu, nativeImage, clipboard } = require("electron");
const { createWindow } = require("./window");
const history = require("./history");

function showMainWindow(windows) {
  if (windows.main && !windows.main.isDestroyed()) {
    windows.main.show();
    windows.main.focus();
  } else {
    windows.main = createWindow();
  }
  return windows.main;
}

function createTray(windows) {
  const trayIcon = nativeImage.createFromPath(
    path.join(app.getAppPath(), "assets", "trayTemplate.png"),
  );
  trayIcon.setTemplateImage(true);

  const tray = new Tray(trayIcon);
  tray.setToolTip("Vape 'n' Vibe");

  // Rebuilt when history changes so "Copy Last Transcript" is only
  // enabled when there is something to copy.
  function buildMenu() {
    const hasHistory = Boolean(history.latest());
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: `Vape 'n' Vibe v${app.getVersion()}`, enabled: false },
        { type: "separator" },
        {
          label: "Copy Last Transcript",
          enabled: hasHistory,
          click: () => {
            const entry = history.latest();
            if (entry) clipboard.writeText(entry.text);
          },
        },
        {
          label: "Show History",
          click: () => {
            const win = showMainWindow(windows);
            const send = () => win.webContents.send("show-history");
            if (win.webContents.isLoading()) {
              win.webContents.once("did-finish-load", send);
            } else {
              send();
            }
          },
        },
        { type: "separator" },
        { label: "Quit", click: () => app.quit() },
      ]),
    );
  }

  buildMenu();
  history.onChange(buildMenu);

  tray.on("click", () => {
    showMainWindow(windows);
  });

  return tray;
}

module.exports = { createTray };
