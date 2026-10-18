/**
 * Bump this on every APK you hand out. Testers will be on different builds
 * for weeks, and a bug report without a build number is a bug report you
 * cannot place.
 *
 * NOT ENOUGH ON ITS OWN since `expo-updates` landed 2026-10-18: the APK keeps
 * this string at versionCode 4 while the JavaScript inside it changes with
 * every OTA publish. Use `buildStamp()` / `releaseDetail()` from
 * `constants/release.ts` for anything user-facing or reported — they append
 * which update is actually running. A report stamped only `0.4.0-ota` cannot
 * be placed against a commit, which is the exact failure this constant exists
 * to prevent, reintroduced one layer down.
 *
 * This file stays free of native imports: `checks/backup.ts` reaches it
 * through `src/dev/backup`, and `expo-updates` would make that suite
 * unloadable under tsx.
 */
export const APP_BUILD = '0.4.0-ota';
