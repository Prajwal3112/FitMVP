const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Drizzle: inline-import for .sql migration files
config.resolver.sourceExts.push('sql');

// expo-sqlite on web pulls in wa-sqlite.wasm — Metro needs to treat it as an asset
config.resolver.assetExts.push('wasm');

module.exports = config;
