const electron      = require('electron');
const app           = electron.app;
const BrowserWindow = electron.BrowserWindow;
const path          = require('path');
const fs            = require('fs');
const url           = require('url');
const platform      = require('os').platform();

const options = require('./modules/options').parse();
const log     = require('./modules/logger').init();
const init    = require('./modules/init');
const _auth = require('./modules/webrequest/http-auth');

/* correct appName and userData to respect Linux standards */
if (process.platform === 'linux') {
  app.setName('particl-desktop');
  app.setPath('userData', path.join(app.getPath('appData'), app.getName()));
}

/* check for paths existence and create */
const PATH_USER_DATA = app.getPath('userData');
if (!fs.existsSync(PATH_USER_DATA)) fs.mkdir(PATH_USER_DATA);

if (options.regtest) {
  setupRegtest();
} else if (options.testnet || app.getVersion().includes('RC')) {
  setupTestnet();
} else {
  setupMainnet();
}

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow;
let tray;

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', () => {

  log.info('app ready')
  log.debug('argv', process.argv);
  log.debug('options', options);

  // initialize the authentication filter
  _auth.init();

  initMainWindow();
  init.start(mainWindow);
});

// Quit when all windows are closed.
app.on('window-all-closed', function () {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit()
  }
});

app.on('activate', function () {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) {
    initMainWindow()
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
app.on('browser-window-created', function (e, window) {
  window.setMenu(null);
});

/*
** initiates the Main Window
*/
function initMainWindow() {
  if (platform !== "darwin") {
    let trayImage = makeTray();
  }

  // Create the browser window.
  mainWindow = new BrowserWindow({
    // width: on Win, the width of app is few px smaller than it should be
    // (this triggers smaller breakpoints) - this size should cause
    // the same layout results on all OSes
    // minWidth/minHeight: both need to be specified or none will work
    width:     1270,
    minWidth:  1270,
    height:    675,
    minHeight: 675,
    icon:      path.join(__dirname, 'resources/icon.png'),

    webPreferences: {
      webviewTag: false,
      nodeIntegration: false,
      sandbox: true,
      contextIsolation: false,
      preload: path.join(__dirname, 'preload.js')
    },
  });

  // and load the index.html of the app.
  if (options.dev) {
    mainWindow.loadURL('http://localhost:4200');
  } else {
    mainWindow.loadURL(url.format({
      protocol: 'file:',
      pathname: path.join(__dirname, 'dist/index.html'),
      slashes: true
    }));
  }

  // Open the DevTools.
  if (options.devtools) {
    mainWindow.webContents.openDevTools()
  }

  // handle external URIs
  mainWindow.webContents.on('new-window', (event, url) => {
    event.preventDefault();
    electron.shell.openExternal(url);
  });

  // Emitted when the window is closed.
  mainWindow.on('closed', function () {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    mainWindow = null
  });
}

/*
** creates the tray icon and menu
*/
function makeTray() {

  // Default tray image + icon
  let trayImage = path.join(__dirname, 'resources/icon.png');

  // The tray context menu
  const contextMenu = electron.Menu.buildFromTemplate([
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload',
          click() { mainWindow.webContents.reloadIgnoringCache(); }
        },
        {
          label: 'Open Dev Tools',
          click() { mainWindow.openDevTools(); }
        }
      ]
    },
    {
      role: 'window',
      submenu: [
        {
          label: 'Close',
          click() { app.quit() }
        },
        {
          label: 'Hide',
          click() { mainWindow.hide(); }
        },
        {
          label: 'Show',
          click() { mainWindow.show(); }
        },
        {
          label: 'Maximize',
          click() { mainWindow.maximize(); }
        } /* TODO: stop full screen somehow,
        {
          label: 'Toggle Full Screen',
          click () {
            mainWindow.setFullScreen(!mainWindow.isFullScreen());
           }
        }*/
      ]
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'About ' + app.getName(),
          click() { electron.shell.openExternal('https://particl.io/#about'); }
        },
        {
          label: 'Visit Particl.io',
          click() { electron.shell.openExternal('https://particl.io'); }
        },
        {
          label: 'Visit Electron',
          click() { electron.shell.openExternal('https://electron.atom.io'); }
        }
      ]
    }
  ]);

  // Create the tray icon
  tray = new electron.Tray(trayImage)

  // TODO, tray pressed icon for OSX? :)
  // if (platform === "darwin") {
  //   tray.setPressedImage(imageFolder + '/osx/trayHighlight.png');
  // }

  // Set the tray icon
  tray.setToolTip('Particl ' + app.getVersion());
  tray.setContextMenu(contextMenu)

  // Always show window when tray icon clicked
  tray.on('click', function () {
    mainWindow.show();
  });

  return trayImage;
}


function mkDir(dirPath, root) {
  var dirs = dirPath.split(path.sep);
  var dir = dirs.shift();
  root = (root || '') + (root[root.length-1] === path.sep ? '' : path.sep) + dir + path.sep;

  try {
    if (!fs.existsSync(root)) fs.mkdirSync(root);
    else if (!fs.statSync(root).isDirectory()) throw `path ${root} is not a directory!!`;
  } catch (e) {
    throw e;
  }

  return !dirs.length || mkDir(dirs.join(path.sep), root);
};


/*
 * Creates paths and files for regtest connectivity
 */
function setupRegtest() {
  const TOTAL_NODES = Math.min( (+options.regtest_node_count || 3), 3);
  const BASE_PORT = 14792;
  const CONFIG_FILE_NAME = 'particl.conf';

  const rmDirContents = (dir, rmSelf) => {
    // if (dir == __dirname) {
    //   return;
    // }

    let filesList;
    filesList = fs.readdirSync(dir);
    if (filesList.length > 0) {
      filesList.forEach((f, idx) => {
        const filePath = path.join(dir, f);
        if (fs.statSync(filePath).isDirectory()) {
          rmDirContents(filePath, true);
        } else {
          if (f !== CONFIG_FILE_NAME)
            fs.unlinkSync(filePath);
        }
      });
    }

    if (rmSelf === true) {
      fs.rmdirSync(dir);
    }
  }

  const getConfigForRegtestNode = (nodeId, rpcPort, port) => {
    let daemonConfig = `
regtest=1

[regtest] # > 0.16 only
port=${port}
rpcport=${rpcPort}
rpcuser=rpcuser${nodeId}
rpcpassword=rpcpass${nodeId}
daemon=1
server=1
discover=0
listenonion=0
bind=${ options.rpcbind || '127.0.0.1' }
findpeers=0
debugexclude=libevent
displaylocaltime=1
acceptnonstdtxn=0
minstakeinterval=10
debug=1
`

    for (let ii=0; ii < TOTAL_NODES; ii++) {
      if (nodeId === ii) continue;
      daemonConfig += `addnode=${ options.rpcbind || '127.0.0.1' }:${BASE_PORT + ii}\n`;
    }
    return daemonConfig;

  };

  for (let nodeNum =0; nodeNum < TOTAL_NODES; nodeNum++) {
    const pathDaemonRelative = path.join('regtest', String(nodeNum));
    const pathDaemonAbs = path.join(PATH_USER_DATA, pathDaemonRelative);

    try {
      // Remove node data directory contents
      if (!options.clearDirContents && fs.existsSync(pathDaemonAbs) && fs.statSync(pathDaemonAbs).isDirectory()) {
        rmDirContents(pathDaemonAbs);
      }

      // Check for existence of (create if not existing) node data directory
      if (!mkDir(pathDaemonRelative, PATH_USER_DATA)) throw new Error(`cannot create directory '${pathDaemonAbs}'`);

      // Create daemon config file for the node if not existing
      const conFilePath = path.join(pathDaemonAbs, CONFIG_FILE_NAME);
      if (!fs.existsSync(conFilePath))
        fs.writeFileSync(conFilePath, getConfigForRegtestNode(nodeNum, +options.port + nodeNum, BASE_PORT + nodeNum));
    } catch(err) {
      log.e(`regtest setup for node ${nodeNum} failed: `, err);
    }
  }

  process.argv.push(...['-regtest']);
};

/*
 * Creates paths and files for testnet connectivity
*/
function setupTestnet () {
  // mkDir('testnet', PATH_USER_DATA);
  process.argv.push(...['-testnet']);
};

/*
 * Creates paths and files for mainnet connectivity
*/
function setupMainnet () {};
