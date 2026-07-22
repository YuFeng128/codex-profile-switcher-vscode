import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("codexDesktop", {
  getState: () => ipcRenderer.invoke("profiles:getState"),
  addProfile: (profile: unknown) => ipcRenderer.invoke("profiles:add", profile),
  updateProfile: (id: string, profile: unknown) => ipcRenderer.invoke("profiles:update", id, profile),
  deleteProfile: (id: string) => ipcRenderer.invoke("profiles:delete", id),
  switchProfile: (id: string) => ipcRenderer.invoke("profiles:switch", id),
  autoConfigureHongyun: (apiKey: string) => ipcRenderer.invoke("hongyun:autoConfigure", apiKey),
  openPath: (targetPath: string) => ipcRenderer.invoke("app:openPath", targetPath),
});
