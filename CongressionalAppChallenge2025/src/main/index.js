import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import path from 'path'
import * as dotenv from 'dotenv'

const envPath = app.isPackaged
  ? path.join(process.resourcesPath, '.env')
  : path.join(process.cwd(), '.env')

dotenv.config({ path: envPath })

if (!process.env.FIREBASE_API_KEY) {
  console.error('Missing required environment variables. Check your .env file.');
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
      nativeWindowOpen: true,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript(
      `document.body.classList.add('platform-${process.platform}');`
    );
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.log('Window open requested for URL:', url);
    
    // Allow Firebase auth handler and Google authentication URLs
    if (url.includes('firebaseapp.com/__/auth/handler') ||
        url.includes('accounts.google.com') ||
        url.includes('apis.google.com/js/api') ||
        url.includes('google.com/signin') ||
        url.includes('googleusercontent.com')) {
      console.log('Allowing internal window for auth URL:', url);
      return { action: 'allow' };
    }
    
    // For other URLs, open in external browser
    console.log('Opening external URL:', url);
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
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
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return;

  switch (action) {
    case 'minimize':
      win.minimize();
      break;
    case 'maximize':
      win.isMaximized() ? win.unmaximize() : win.maximize();
      break;
    case 'close':
      win.close();
      break;
  }
});

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
  GOOGLE_CLASSROOM_API_KEY: process.env.GOOGLE_CLASSROOM_API_KEY,
});