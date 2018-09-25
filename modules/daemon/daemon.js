const electron = require('electron');
const app = electron.app;
const log = require('electron-log');
const spawn = require('child_process').spawn;
const rxIpc = require('rx-ipc-electron/lib/main').default;
const Observable = require('rxjs/Observable').Observable;
const path = require('path');

const _options = require('../options');
const clearCookie = require('../webrequest/http-auth').removeWalletAuthentication;
const rpc = require('../rpc/rpc');
const daemonManager = require('../daemon/daemonManager');

let daemons = [];
let chosenWallets = [];
let regtestInit = false;

function daemonData(data, logger) {
  data = data.toString().trim();
  logger(data);
}

const delay = ms => {
  return new Promise(resolve => {
      return setTimeout(resolve, ms)
  });
};

exports.init = function () {
  console.log('daemon init listening for reboot')
  rxIpc.registerListener('daemon', (data) => {
    return Observable.create(observer => {
      log.debug('got data on daemon channel!');
      if (data && data.type === 'restart') {
        exports.restart(true);
        observer.complete(true);
      } else {
        observer.complete(true);
      }
    });
  });
}

exports.restart = function (alreadyStopping) {
  log.info('restarting daemon...')

  // setup a listener, waiting for the daemon
  // to exit.
  const daemon = daemons[0];  //  If regtest, only necessary to restart the first daemon
  if (daemon) {
    daemon.once('close', code => {
      // clear authentication
      clearCookie();

      // restart
      this.start(chosenWallets);
    });
  }

  // wallet encrypt will restart by itself
  if (!alreadyStopping) {
    // stop daemon but don't make it quit the app.
    exports.stop(true).then(() => {
      log.debug('waiting for daemon shutdown...')
    });
  }

}

exports.start = function (wallets) {
  return (new Promise((resolve, reject) => {

    chosenWallets = wallets;

    exports.check().then(() => {
      log.info('daemon already started');
      resolve(undefined);

    }).catch(() => {

      let options = _options.get();
      const daemonPath = options.customdaemon
        ? options.customdaemon
        : daemonManager.getPath();

      wallets = wallets.map(wallet => `-wallet=${wallet}`);

      const nodeTotal = options.regtest ? Math.min( (+options.regtest_node_count || 3), 3) : 1;

      for (let nodeNum = 0; nodeNum < nodeTotal; nodeNum++) {
        let args = [...process.argv,"-rpccorsdomain=http://localhost:4200"];
        if (options.regtest) {
          // TODO: rework, as there is config like this all over the place
          const dataDir = path.join( (options.datadir ? options.datadir : app.getPath('userData')), 'regtest', String(nodeNum) );
          args.push(`-datadir=${dataDir}`);
        }
        args = [...args, ...wallets];

        log.info(`starting daemon (${nodeNum}) ${daemonPath} ${args.join(' ')}`);
        const child = spawn(daemonPath, args);
        if (!options.regtest) {
          child.on('close', code => {
            daemons[nodeNum] = undefined;
            if (code !== 0) {
              log.error(`daemon (${nodeNum}) exited with code ${code}.\n${daemonPath}\n${process.argv.join(' ')}`);
            } else {
              log.info(`daemon (${nodeNum}) exited successfully`);
            }
          });
        }

        if (options.regtest && !regtestInit && nodeNum === 0 ) {
          delay(4000).then(() => {
            rpc.call('walletsettings', ['stakingoptions', {"stakecombinethreshold":"100","stakesplitthreshold":200}], (error, response) => {
              if (error) {
                reject(error);
              } else if (response) {
                rpc.call('reservebalance', [true, '1000'], (error, response) => {
                  rpc.call('extkeygenesisimport', ["abandon baby cabbage dad eager fabric gadget habit ice kangaroo lab absorb"], () =>{}, 0);
                }, 0);
              }
            }, 0);
          });
        }

        // TODO change for logging
        child.stdout.on('data', data => daemonData(data, console.log));
        child.stderr.on('data', data => {
          daemonData(data, console.log);
        });

        daemons[nodeNum] = child;
      }
    });

  }));
}


exports.check = function () {
  return new Promise((resolve, reject) => {

    const _timeout = rpc.getTimeoutDelay();
    rpc.call('getnetworkinfo', null, (error, response) => {
      if (error) {
        reject(error);
      } else if (response) {
        resolve(response);
      }
    });
    rpc.setTimeoutDelay(_timeout);

  });
}

exports.stop = function (restarting) {
  log.info('daemon stop called..');
  const options = _options.get();
  const nodeTotal = options.regtest ? Math.min( (+options.regtest_node_count || 3), 3) : 1;
  let stoppedSuccess = true;

  return new Promise((resolve, reject) => {
    for (let nodeCount = 0; nodeCount < nodeTotal; nodeCount++) {
      const daemon = daemons[nodeCount];
      if (daemon) {
        if (!restarting) {
          daemon.once('close', code => {
            log.info('daemon exited successfully');
            if ( (nodeCount + 1) === nodeTotal ) {
              log.info('we can now quit electron safely! :)');
              electron.app.quit();
            }
          });
        }

        log.info('Call RPC stop!');
        rpc.call('stop', null, (error, response) => {
          if (error) {
            log.info('daemon errored to rpc stop - killing it brutally :(');
            daemon.kill('SIGINT');
            stoppedSuccess = false;
          } else {
            log.info(`Daemon (${nodeCount}) stopping gracefully...`);
          }

          if (nodeCount === (nodeTotal - 1) ) {
            stoppedSuccess ? resolve() : reject();
          }

        }, nodeCount);
      } else {
        log.info(`Daemon (${nodeCount}) not managed by gui.`);
        if (nodeCount === (nodeTotal - 1) ) {
          stoppedSuccess ? resolve() : reject();
        }
      }
    }
  });
};
