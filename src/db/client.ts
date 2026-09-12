import { Platform } from 'react-native';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';
import * as schema from './schema';

// ─── Database connection ─────────────────────────────────────────────
// Single shared connection for the app's lifetime.
// WAL + foreign keys are best-effort PRAGMAs — silently skipped on web
// (where the wa-sqlite worker doesn't support journal_mode = WAL).

const sqlite = openDatabaseSync('fitmvp.db');

if (Platform.OS !== 'web') {
  try {
    sqlite.execSync('PRAGMA journal_mode = WAL;');
    sqlite.execSync('PRAGMA foreign_keys = ON;');
  } catch (e) {
    // Don't let PRAGMA failures crash app boot — log and continue.
    // eslint-disable-next-line no-console
    console.warn('[db] PRAGMA setup failed (non-fatal):', e);
  }
}

export const db = drizzle(sqlite, { schema });

export type DB = typeof db;

// Re-export the raw SQLite handle for migration runner + advanced ops.
export const rawSqlite = sqlite;
