const electron      = require('electron');
const log           = require('electron-log');

const rpc           = require('./rpc/rpc');
const zmq           = require('./zmq/zmq');

const daemon        = require('./daemon/daemon');
const daemonWarner  = require('./daemon/update');
const daemonManager = require('./daemon/daemonManager');
const multiwallet   = require('./multiwallet');
const notification  = require('./notification/notification');
const closeGui      = require('./close-gui/close-gui');
const market        = require('./market/market');



exports.start = function (mainWindow) {
  // Initialize IPC listeners
  rpc.init();
  notification.init();
  closeGui.init();
  daemon.init();
  market.init();

  /* Initialize ZMQ */
  zmq.init(mainWindow);
  // zmq.test(); // loop, will send tests

  /* Initialize daemonWarner */
  // warns GUI that daemon is downloading
  daemonWarner.init(mainWindow);
  daemonManager.on('status', (status, msg) => {
    if (status === "download") {
      daemonWarner.send(msg);
    }
  });

  exports.startDaemonManager();
}

exports.startDaemonManager = function() {
  daemon.check()
    .then(()            => log.info('daemon already started'))
    .catch(()           => daemonManager.init())
    .catch((error)      => log.error(error));
}

/*
  Start daemon when we get the GO sign from daemonManager.
  Listen for daemonManager errors too..

  Only happens _after_ daemonManager.init()
*/
daemonManager.on('status', (status, msg) => {

  // Done -> means we have a binary!
  if (status === 'done') {
    log.debug('daemonManager returned successfully, starting daemon!');
    multiwallet.get()
    .then(chosenWallets => daemon.start(chosenWallets))
    .catch(err          => log.error(err));
  } else if (status === 'error') {
    // Failed to get clientBinaries.json => connection issues?
    if (msg === 'Request timed out') {
      log.error('Unable to fetch the latest clients.');

      // alert that we weren't able to update.
      electron.dialog.showMessageBox({
        type: 'warning',
        buttons: ['Stop', 'Retry'],
        message: 'Unable to check for updates, please check your connection. Do you want to retry?'
      }, (response) => {
        if(response === 1) {
          exports.startDaemonManager();
        }
      });
    }

    log.debug('daemonManager errored: ' + msg);
  }

});

electron.app.on('before-quit', function beforeQuit(event) {
  log.info('received quit signal, cleaning up...');

  event.preventDefault();
  electron.app.removeListener('before-quit', beforeQuit);

  // destroy IPC listeners
  rpc.destroy();
  notification.destroy();
  closeGui.destroy();

  market.stop();
  daemon.stop().then(() => {
    log.info('daemon.stop() resolved!');
  }).catch(err => log.error('Error on before-quit signal: ', err));
});

electron.app.on('quit', (event, exitCode) => {
  log.info('Exiting!');
});
