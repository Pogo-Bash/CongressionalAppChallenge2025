const {app, BrowserWindow, ipcMain} = require('electron/main')
const path = require('node:path')

const CreateWindow = () => {
    const win = new BrowserWindow({
        width: 800, 
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true, 
            nodeIntegration: false
        }
    })

    win.loadFile('src/index.html')

    win.webContents.openDevTools()
}

app.whenReady().then(() => {
    ipcMain.handle('ping', () => 'pong')
    CreateWindow()

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            CreateWindow()
        }
    })
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})