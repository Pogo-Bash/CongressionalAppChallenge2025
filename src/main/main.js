const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const createWindow = () => {
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    if (process.env.NODE_ENV === 'development') {
        win.loadURL('http://localhost:5173'); // Load the Vite dev server
    } else {
        win.loadFile(path.join(__dirname, 'dist', 'src/renderer/index.html')); // Load the built React app
    }

    win.webContents.openDevTools(); // Open DevTools (optional)
};

app.whenReady().then(() => {
    ipcMain.handle('ping', () => 'pong'); // Example IPC handler
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});