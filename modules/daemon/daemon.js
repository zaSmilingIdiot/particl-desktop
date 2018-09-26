const electron = require('electron');
const app = electron.app;
const log = require('electron-log');
const spawn = require('child_process').spawn;
const rxIpc = require('rx-ipc-electron/lib/main').default;
const Observable = require('rxjs/Observable').Observable;
const path = require('path');

const options = require('../options').get();
const clearCookie = require('../webrequest/http-auth').removeWalletAuthentication;
const rpc = require('../rpc/rpc');
const daemonManager = require('../daemon/daemonManager');

let daemon;
let chosenWallets = [];

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
  log.debug('daemon init listening for reboot');
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

      const daemonPath = options.customdaemon
        ? options.customdaemon
        : daemonManager.getPath();

      wallets = wallets.map(wallet => `-wallet=${wallet}`);

      let args = [...process.argv,"-rpccorsdomain=http://localhost:4200"];
      if (options.regtest) {
        // TODO: rework, as there is config like this all over the place
        const dataDir = path.join( (options.datadir ? options.datadir : app.getPath('userData')), 'regtest', '0' );
        args.push(`-datadir=${dataDir}`);
      }
      args = [...args, ...wallets];

      log.info(`starting daemon ${daemonPath} ${args.join(' ')}`);
      const child = spawn(daemonPath, args);
      if (!options.regtest) {
        child.on('close', code => {
          daemon = undefined;
          if (code !== 0) {
            log.error(`daemon exited with code ${code}.\n${daemonPath}\n${process.argv.join(' ')}`);
          } else {
            log.info(`daemon exited successfully`);
          }
        });
      }

      // TODO change for logging
      child.stdout.on('data', data => daemonData(data, console.log));
      child.stderr.on('data', data => {
        daemonData(data, console.log);
      });

      daemon = child;
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

  return new Promise((resolve, reject) => {
    if (daemon) {
      if (!restarting) {
        daemon.once('close', code => {
          log.info('we can now quit electron safely! :)');
          electron.app.quit();
        });
      }

      log.info('Call RPC stop!');
      rpc.call('stop', null, (error, response) => {
        if (error) {
          log.info('daemon errored to rpc stop - killing it brutally :(');
          daemon.kill('SIGINT');
          reject();
        } else {
          log.info(`Daemon stopping gracefully...`);
          resolve();
        }
      });
    } else {
      log.info(`Daemon not managed by gui.`);
      resolve();
    }
  });
};
