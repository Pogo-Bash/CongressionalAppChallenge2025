import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {}

// Parse secure environment variables
const secureEnv = process.env.SECURE_ENV ? JSON.parse(process.env.SECURE_ENV) : {}

// Add validation for the Firebase config
const firebaseConfig = secureEnv.FIREBASE_CONFIG || {}
const hasRequiredFields =
  firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId

if (!hasRequiredFields) {
  console.warn('Firebase configuration is incomplete. Some features may not work correctly.')
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    // Expose Electron APIs
    contextBridge.exposeInMainWorld('electron', {
      ipcRenderer: {
        // Simple method for window control
        send: (channel, ...args) => {
          const validChannels = ['window-control']
          if (validChannels.includes(channel)) {
            ipcRenderer.send(channel, ...args)
          }
        },
        // Proxy request method with serialization safety
        proxyRequest: async (url, options = {}) => {
          // Ensure options are serializable
          const safeOptions = {
            method: options.method || 'GET',
            headers: options.headers ? { ...options.headers } : {}
          }

          // Only include body if it exists and is a string
          if (options.body && typeof options.body === 'string') {
            safeOptions.body = options.body
          }

          try {
            return await ipcRenderer.invoke('proxy-request', { url, options: safeOptions })
          } catch (error) {
            console.error('Error in proxy request:', error)
            // Return a fetch-compatible error response
            return {
              ok: false,
              status: 500,
              statusText: 'Error in proxy request',
              json: async () => ({ error: error.toString() }),
              text: async () => error.toString()
            }
          }
        }
      }
    })

    // Expose custom API
    contextBridge.exposeInMainWorld('api', api)

    // Expose camera permission API
    contextBridge.exposeInMainWorld('electronAPI', {
      requestCameraPermission: () => ipcRenderer.invoke('request-camera-permission')
    })

    // Expose window control APIs
    contextBridge.exposeInMainWorld('windowControls', {
      minimize: () => ipcRenderer.send('window-control', 'minimize'),
      maximize: () => ipcRenderer.send('window-control', 'maximize'),
      close: () => ipcRenderer.send('window-control', 'close')
    })

    // Expose environment variables
    contextBridge.exposeInMainWorld('env', {
      firebaseConfig,
      googleClassroomApiKey: secureEnv.GOOGLE_CLASSROOM_API_KEY || '',
      isConfigComplete: hasRequiredFields
    })

    // Expose IPC channel for general communication
    contextBridge.exposeInMainWorld('ipc', {
      send: (channel, ...args) => {
        // Whitelist channels for security
        const validChannels = ['request-data', 'save-settings']
        if (validChannels.includes(channel)) {
          ipcRenderer.send(channel, ...args)
        }
      },
      receive: (channel, func) => {
        // Whitelist channels for security
        const validChannels = ['data-response', 'settings-saved']
        if (validChannels.includes(channel)) {
          // Remove existing listeners to avoid duplicates
          ipcRenderer.removeAllListeners(channel)
          // Add the new listener
          ipcRenderer.on(channel, (_, ...args) => func(...args))
        }
      },
      invoke: async (channel, ...args) => {
        // Whitelist channels for security
        const validChannels = ['get-user-data', 'perform-calculation']
        if (validChannels.includes(channel)) {
          return await ipcRenderer.invoke(channel, ...args)
        }
        return null
      }
    })
  } catch (error) {
    console.error('Error exposing APIs to renderer process:', error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
  // @ts-ignore (define in dts)
  window.env = {
    firebaseConfig,
    googleClassroomApiKey: secureEnv.GOOGLE_CLASSROOM_API_KEY || '',
    isConfigComplete: hasRequiredFields
  }
  // @ts-ignore (define in dts)
  window.windowControls = {
    minimize: () => ipcRenderer.send('window-control', 'minimize'),
    maximize: () => ipcRenderer.send('window-control', 'maximize'),
    close: () => ipcRenderer.send('window-control', 'close')
  }
}
