const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, '../../design'), path.resolve(__dirname, '../../contracts')];
config.resolver.assetExts.push('wasm');
module.exports = config;
