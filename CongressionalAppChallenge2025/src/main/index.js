import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import path from 'path'
import * as dotenv from 'dotenv'
import https from 'https'
import http from 'http'
import { URL } from 'url'

const envPath = app.isPackaged
  ? path.join(process.resourcesPath, '.env')
  : path.join(process.cwd(), '.env')

dotenv.config({ path: envPath })

if (!process.env.FIREBASE_API_KEY) {
  console.error('Missing required environment variables. Check your .env file.')
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      nativeWindowOpen: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript(
      `document.body.classList.add('platform-${process.platform}');`
    )
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.log('Window open requested for URL:', url)

    // Allow about:blank for popup blocker detection
    if (url === 'about:blank') {
      return { action: 'allow' }
    }

    // Allow Firebase auth handler and Google authentication URLs
    if (
      url.includes('firebaseapp.com/__/auth/handler') ||
      url.includes('accounts.google.com') ||
      url.includes('apis.google.com/js/api') ||
      url.includes('google.com/signin') ||
      url.includes('googleusercontent.com') ||
      url.startsWith('https://')
    ) {
      console.log('Allowing internal window for auth URL:', url)
      return { action: 'allow' }
    }

    // For other URLs, open in external browser
    console.log('Opening external URL:', url)
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // FIXED: Changed isDevelopment to !is.dev for production environment
  if (!is.dev) {
    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; " +
              "script-src 'self' 'unsafe-eval' https://cdn.jsdelivr.net https://*.googleapis.com https://*.firebaseio.com https://apis.google.com; " +
              "font-src 'self' https://fonts.gstatic.com; " +
              "img-src 'self' data: https://*.googleusercontent.com; " +
              "media-src 'self' blob:; " +
              "connect-src 'self' https://cdn.jsdelivr.net https://*.googleapis.com https://classroom.googleapis.com https://*.firebaseio.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://tfhub.dev https://www.kaggle.com; " +
              +"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
              "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com;"
          ]
        }
      })
    })
  }

  // IPC handlers for window controls
  ipcMain.on('window-minimize', () => {
    mainWindow.minimize()
  })

  ipcMain.on('window-maximize', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
  })

  ipcMain.on('window-close', () => {
    mainWindow.close()
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })
  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

ipcMain.on('window-control', (event, action) => {
  const win = BrowserWindow.getFocusedWindow()
  if (!win) return

  switch (action) {
    case 'minimize':
      win.minimize()
      break
    case 'maximize':
      win.isMaximized() ? win.unmaximize() : win.maximize()
      break
    case 'close':
      win.close()
      break
  }
})

// For camera permission handling
ipcMain.handle('request-camera-permission', async () => {
  try {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return { success: false, error: 'No active window found' }

    const status = await win.webContents.getMediaSourceId('camera')
    return { success: true, status }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// Request proxy handler to bypass CORS issues
ipcMain.handle('proxy-request', async (event, { url, options }) => {
  console.log(`Proxying request to: ${url}`)

  if (!url || typeof url !== 'string') {
    console.error('Invalid URL provided to proxy-request')
    return {
      ok: false,
      status: 400,
      statusText: 'Bad Request: Invalid URL',
      data: 'Invalid URL',
      isJson: false
    }
  }

  return new Promise((resolve) => {
    try {
      const parsedUrl = new URL(url)
      const protocol = parsedUrl.protocol === 'https:' ? https : http

      // Prepare headers - make a clean copy
      const headers = {}
      if (options && options.headers) {
        Object.keys(options.headers).forEach((key) => {
          // Filter out problematic headers
          if (key.toLowerCase() !== 'host' && key.toLowerCase() !== 'connection') {
            headers[key] = options.headers[key]
          }
        })
      }

      const requestOptions = {
        method: options?.method || 'GET',
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        headers: headers
      }

      console.log(
        `Making ${requestOptions.method} request to ${parsedUrl.hostname}${parsedUrl.pathname}`
      )

      const req = protocol.request(requestOptions, (res) => {
        let responseBody = ''

        res.on('data', (chunk) => {
          responseBody += chunk
        })

        res.on('end', () => {
          console.log(`Proxy response status: ${res.statusCode}`)

          // Create a serializable response object
          const response = {
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            statusText: res.statusMessage || '',
            url: url
          }

          // Add response data
          try {
            // Try to parse as JSON
            const jsonData = JSON.parse(responseBody)
            response.data = jsonData
            response.isJson = true
          } catch (e) {
            // Store as text if not JSON
            response.data = responseBody
            response.isJson = false
          }

          resolve(response)
        })
      })

      req.on('error', (error) => {
        console.error(`Proxy request error: ${error.message}`)
        resolve({
          ok: false,
          status: 500,
          statusText: error.message || 'Request failed',
          data: error.message || 'Unknown error',
          isJson: false
        })
      })

      // We don't want to reject the promise as it causes IPC issues
      req.on('timeout', () => {
        console.error('Proxy request timed out')
        req.destroy()
        resolve({
          ok: false,
          status: 504,
          statusText: 'Gateway Timeout',
          data: 'Request timed out',
          isJson: false
        })
      })

      // Add body if provided
      if (options && options.body) {
        req.write(options.body)
      }

      req.end()
    } catch (error) {
      console.error(`Error in proxy request: ${error.message}`)
      resolve({
        ok: false,
        status: 500,
        statusText: error.message || 'Error in proxy request',
        data: error.message || 'Unknown error',
        isJson: false
      })
    }
  })
})

process.env.SECURE_ENV = JSON.stringify({
  FIREBASE_CONFIG: {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID
  },
  GOOGLE_CLASSROOM_API_KEY: process.env.GOOGLE_CLASSROOM_API_KEY
})
