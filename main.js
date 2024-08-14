const { app, BrowserWindow } = require('electron/main')
const path = require('node:path')
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('enable-transparent-visuals');
app.commandLine.appendSwitch('disable-gpu');

function createWindow () {
  const win = new BrowserWindow({
    width: 800,
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
  // Обрабатываем событие завершения загрузки
  win.webContents.on('did-finish-load', () => {
    win.webContents.executeJavaScript(`
            console.log('Executing JavaScript in renderer');
            try {
                document.addEventListener('DOMContentLoaded', () => {
                    const transparentBg = document.querySelector('.transparent-bg');
                    if (transparentBg) {
                        transparentBg.style.pointerEvents = 'none'; // Игнорируем события указателя для этого элемента
                        console.log('Pointer events updated');
                    } else {
                        console.error('Element .transparent-bg not found');
                    }
                });
            } catch (error) {
                console.error('Error executing script:', error);
            }
        `).catch(error => {
      console.error('Error executing JavaScript in renderer:', error);
    });
  });

  win.loadFile('index.html');

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