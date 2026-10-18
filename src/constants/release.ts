import * as Updates from 'expo-updates';
import { APP_BUILD } from './build';

// ─── What exactly is this person running? ────────────────────────────
//
// `APP_BUILD` is hand-bumped per APK and was enough while every change
// required a reinstall. With `expo-updates` it is NOT: the APK stays at
// versionCode 4 and `0.4.0-ota` forever while the JavaScript underneath it
// changes as often as we publish. A bug report stamped only `0.4.0-ota`
// cannot be placed against a commit — which is the exact failure the build
// string was introduced to prevent, reintroduced one layer down.
//
// So every report carries which OTA revision produced it.
//
// LIVES HERE, NOT IN build.ts, because `expo-updates` is a native module and
// `build.ts` is reached from `checks/backup.ts` through `src/dev/backup`.
// Putting the import there would make a suite unloadable under tsx — the same
// react-native-in-a-testable-module mistake, for the third time.

/** Short, so it fits on Home and at the top of a share sheet. */
export function buildStamp(): string {
  // `embedded` means they are running the bundle that shipped inside the APK,
  // so APP_BUILD alone identifies it completely.
  if (!Updates.isEmbeddedLaunch && Updates.updateId !== null) {
    return `${APP_BUILD} · ota ${Updates.updateId.slice(0, 8)}`;
  }
  return `${APP_BUILD} · apk`;
}

/**
 * The long form, for a report rather than a label. Includes the channel and
 * when the running bundle was published, which is what tells you whether a
 * tester has actually picked up a fix yet.
 */
export function releaseDetail(): string {
  const lines = [`build ${APP_BUILD}`];
  // Dev builds report nothing useful here and `channel` is undefined under
  // Expo Go, so every field is guarded rather than interpolated blind.
  if (Updates.channel) lines.push(`channel ${Updates.channel}`);
  lines.push(Updates.isEmbeddedLaunch ? 'running the bundle in the APK' : 'running an OTA update');
  if (Updates.updateId !== null) lines.push(`update ${Updates.updateId}`);
  if (Updates.createdAt !== null) {
    lines.push(`published ${Updates.createdAt.toISOString().slice(0, 16).replace('T', ' ')}`);
  }
  if (Updates.runtimeVersion) lines.push(`runtime ${Updates.runtimeVersion}`);
  return lines.join(' · ');
}
