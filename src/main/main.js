const {app, BrowserWindow} = require('electron')

const CreateWindow = () => {
    const win = new BrowserWindow({
        width: 800, 
        height: 600
    })

    win.loadFile('src/index.html')
}

app.whenReady().then(() => {
    CreateWindow()
})