const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vapenvibe", {
  getConfig: () => ipcRenderer.invoke("get-config"),
  setHotkey: (hotkey) => ipcRenderer.invoke("set-hotkey", hotkey),
  setHotkeyMode: (mode) => ipcRenderer.invoke("set-hotkey-mode", mode),
  getHistory: () => ipcRenderer.invoke("get-history"),
  copyHistoryEntry: (id) => ipcRenderer.invoke("copy-history-entry", id),
  deleteHistoryEntry: (id) => ipcRenderer.invoke("delete-history-entry", id),
  clearHistory: () => ipcRenderer.invoke("clear-history"),
  onHistoryUpdated: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("history-updated", handler);
    return () => ipcRenderer.removeListener("history-updated", handler);
  },
  onShowHistory: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("show-history", handler);
    return () => ipcRenderer.removeListener("show-history", handler);
  },
  setLanguage: (lang) => ipcRenderer.invoke("set-language", lang),
  setModel: (key) => ipcRenderer.invoke("set-model", key),
  startDownloads: (modelKey) => ipcRenderer.invoke("start-downloads", modelKey),
  onDownloadsProgress: (cb) => {
    const handler = (_e, pct) => cb(pct);
    ipcRenderer.on("downloads-progress", handler);
    return () => ipcRenderer.removeListener("downloads-progress", handler);
  },
  onDownloadsComplete: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("downloads-complete", handler);
    return () => ipcRenderer.removeListener("downloads-complete", handler);
  },
  onDownloadsError: (cb) => {
    const handler = (_e, msg) => cb(msg);
    ipcRenderer.on("downloads-error", handler);
    return () => ipcRenderer.removeListener("downloads-error", handler);
  },
  onRecordingToggle: (cb) => {
    const handler = (_e, on, dictationId) => cb(on, dictationId);
    ipcRenderer.on("recording-toggle", handler);
    return () => ipcRenderer.removeListener("recording-toggle", handler);
  },
  onRecordingCancel: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("recording-cancel", handler);
    return () => ipcRenderer.removeListener("recording-cancel", handler);
  },
  sendAudio: (wavBuffer, dictationId) =>
    ipcRenderer.invoke("audio-recorded", wavBuffer, dictationId),
  sendPartialAudio: (wavBuffer) =>
    ipcRenderer.invoke("audio-partial", wavBuffer),
  startAudioStream: () => ipcRenderer.invoke("audio-stream-start"),
  sendAudioStreamChunk: (pcmBuffer) =>
    ipcRenderer.send("audio-stream-chunk", pcmBuffer),
  onPartialText: (cb) => {
    const handler = (_e, text) => cb(text);
    ipcRenderer.on("partial-text", handler);
    return () => ipcRenderer.removeListener("partial-text", handler);
  },
  sendRecordingError: (detail) => ipcRenderer.send("recording-error", detail),
  onTranscriptionStatus: (cb) => {
    const handler = (_e, status) => cb(status);
    ipcRenderer.on("transcription-status", handler);
    return () => ipcRenderer.removeListener("transcription-status", handler);
  },
  requestAccessibility: () => ipcRenderer.invoke("request-accessibility"),
  checkAccessibility: () => ipcRenderer.invoke("check-accessibility"),
  sendVizFreq: (data) => ipcRenderer.send("viz-freq", data),
  getDictionary: () => ipcRenderer.invoke("get-dictionary"),
  setDictionary: (words) => ipcRenderer.invoke("set-dictionary", words),
  getCorrections: () => ipcRenderer.invoke("get-corrections"),
  setCorrections: (rules) => ipcRenderer.invoke("set-corrections", rules),
  restartApp: () => ipcRenderer.invoke("restart-app"),
  checkSystemEvents: () => ipcRenderer.invoke("check-system-events"),
  requestSystemEvents: () => ipcRenderer.invoke("request-system-events"),
  checkMicrophone: () => ipcRenderer.invoke("check-microphone"),
  requestMicrophone: () => ipcRenderer.invoke("request-microphone"),
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  downloadUpdate: () => ipcRenderer.invoke("download-update"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  onUpdateStatus: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on("update-status", handler);
    return () => ipcRenderer.removeListener("update-status", handler);
  },
});
