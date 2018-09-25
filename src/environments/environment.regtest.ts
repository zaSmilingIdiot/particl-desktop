declare const require: any;

export const environment = {
  production: false,
  envName: 'regtest',
  releasesUrl:
    'https://api.github.com/repos/particl/particl-desktop/releases/latest',
  version: require('../../package.json').version,
  marketVersion: require('../../node_modules/particl-marketplace/package.json')
    .version,
  particlHost: 'localhost',
  particlPort: 19792,
  marketHost: 'localhost',
  marketPort: 3000
};
