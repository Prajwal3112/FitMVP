import { File, Paths } from 'expo-file-system';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import { serializeLog } from './backup';
import { readEvents } from '../events/log';
import { APP_BUILD } from '../constants/build';

/**
 * Hand the user a restorable copy of their event log.
 *
 * WHY A FILE AND NOT THE SHARE SHEET'S TEXT. A 1,200-event log is ~558 KB;
 * Android silently truncates a share of that size, and a truncated backup is
 * worse than none — it looks like it worked. `parseBackup` would reject it, but
 * only after the original is already gone.
 *
 * WHY IT MATTERS NOW. Until this existed, the only thing standing between a
 * tester and total loss was Android's own auto-backup to Google Drive — which
 * also meant the whole log, including both free-text fields, left the device
 * without anyone being told. That was the reason `allowBackup` could not simply
 * be switched off. Now it can.
 *
 * Writes to the CACHE directory deliberately: the file is a transient handoff,
 * the OS may reclaim it, and it should not sit in app storage looking like the
 * real copy. The real copy is wherever the user puts it.
 */

export type ExportResult =
  | { ok: true; eventCount: number; bytes: number; shared: boolean; uri: string }
  | { ok: false; reason: string };

function stamp(): string {
  // Local date, no colons — colons are illegal in filenames on some targets.
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export async function exportLogToFile(): Promise<ExportResult> {
  let json: string;
  let count: number;
  try {
    const events = await readEvents();
    count = events.length;
    json = serializeLog(events);
  } catch (e) {
    return {
      ok: false,
      reason: `Could not read your log: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const file = new File(Paths.cache, `fitmvp-backup-${stamp()}.json`);
  try {
    // A stale file from an earlier export in the same minute would otherwise
    // make create() throw.
    if (file.exists) file.delete();
    file.create();
    file.write(json);
  } catch (e) {
    return {
      ok: false,
      reason: `Could not write the backup file: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  let shared = false;
  try {
    if (await isAvailableAsync()) {
      await shareAsync(file.uri, {
        mimeType: 'application/json',
        dialogTitle: `FitMVP backup · ${count} events · build ${APP_BUILD}`,
        UTI: 'public.json',
      });
      shared = true;
    }
  } catch {
    // The user dismissing the share sheet throws on some platforms. The file
    // is written either way, so this is not a failure — report where it is.
  }

  return { ok: true, eventCount: count, bytes: json.length, shared, uri: file.uri };
}

/**
 * Restore is NOT implemented, and that is a deliberate stopping point.
 *
 * Writing a backup back into the log means either refusing unless the log is
 * empty (safe, but useless on the phone that still has the data) or merging two
 * event-sourced histories — which needs conflict rules this project has not
 * specified, and getting it wrong destroys the thing it is meant to protect.
 * `parseBackup()` already validates a file completely, so the format is ready
 * for a restore whenever the rules are decided.
 *
 * Until then the honest position: the export protects against losing the PHONE,
 * not against a corrupted log on a phone you still hold.
 */
