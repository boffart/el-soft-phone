const { app, BrowserWindow } = require('electron/main')
const path = require('node:path')
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('enable-transparent-visuals');
app.commandLine.appendSwitch('disable-gpu');

function createWindow () {
  const win = new BrowserWindow({
    width: 500,
    height: 600,
    transparent:true,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: false,
    }
  });
  win.loadFile('index.html');

  // Автоматически изменяет высоту окна после загрузки содержимого
  mainWindow.webContents.on('did-finish-load', () => {
    adjustWindowHeight(mainWindow);
  });

  // Слушаем изменения размеров окна при изменении содержимого
  mainWindow.webContents.on('did-frame-finish-load', () => {
    adjustWindowHeight(mainWindow);
  });

  function adjustWindowHeight(window) {
    window.webContents.executeJavaScript('document.body.scrollHeight')
        .then(contentHeight => {
          const currentBounds = window.getBounds();
          window.setBounds({
            ...currentBounds,
            height: contentHeight + 40 // Добавляем 40 пикселей для отступов и рамок
          });
        });
  }
}



app.whenReady().then(() => {
  setTimeout(function() {
    createWindow();
  }, 100);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})