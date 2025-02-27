import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {}

const secureEnv = process.env.SECURE_ENV ? JSON.parse(process.env.SECURE_ENV) : {}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('electronAPI', {
      requestCameraPermission: () => ipcRenderer.invoke('request-camera-permission')
    })
    contextBridge.exposeInMainWorld('env', {
      firebaseConfig: secureEnv.FIREBASE_CONFIG || {},
      googleClassroomApiKey: secureEnv.GOOGLE_CLASSROOM_API_KEY || ''
    })
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
