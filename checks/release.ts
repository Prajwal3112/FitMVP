import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { APP_BUILD } from '../src/constants/build';

/**
 * OTA distribution config, and the traceability it would otherwise break.
 *
 * `expo-updates` means the APK is built once and the JavaScript inside it
 * changes for weeks. Three things can go silently wrong, and all three cost
 * the test rather than announcing themselves:
 *
 *   1. a build with no `channel` has nowhere for an update to land
 *   2. a report stamped only `APP_BUILD` cannot be placed against a commit,
 *      because every OTA revision carries the same string
 *   3. `expo-updates` imported into a pure module makes a suite unloadable
 *      under tsx — the react-native-in-a-testable-module mistake, third time
 */
const ROOT = resolve(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const json = (p: string) => JSON.parse(read(p)) as Record<string, never>;

let f = 0;
const ck = (n: string, c: boolean, d = '') => {
  if (c) console.log(`  ok   ${n}`); else { console.log(`  FAIL ${n} ${d}`); f++; }
};

const app = (json('app.json') as unknown as { expo: Record<string, unknown> }).expo;
const eas = json('eas.json') as unknown as {
  build: Record<string, { channel?: string; android?: { buildType?: string } }>;
};
const pkg = json('package.json') as unknown as { dependencies: Record<string, string> };

console.log('\nThe APK can receive updates at all');
ck('expo-updates is a dependency', pkg.dependencies['expo-updates'] !== undefined);
// Without a channel an `eas update` publishes into nothing and the tester
// never sees it — a silent no-op, not an error.
for (const [name, profile] of Object.entries(eas.build)) {
  ck(`the ${name} profile declares a channel`, typeof profile.channel === 'string',
    JSON.stringify(profile));
}
ck('preview still builds an APK, not an app-bundle',
  eas.build['preview']?.android?.buildType === 'apk');

console.log('\nA bad update cannot brick the launch that downloads it');
// fallbackToCacheTimeout 0 launches from the cached bundle and fetches in the
// background, so a broken publish only takes effect NEXT launch and stays
// rollback-able. A non-zero value blocks startup on the download and applies
// it immediately — which is how an OTA channel bricks an app irrecoverably.
const updates = app['updates'] as { fallbackToCacheTimeout?: number } | undefined;
ck('updates.fallbackToCacheTimeout is 0', updates?.fallbackToCacheTimeout === 0,
  JSON.stringify(updates));

console.log('\nAn update can never reach an APK that cannot run it');
// `appVersion` ties eligibility to the version string, so bumping `version`
// silently orphans installed APKs, and adding a native dependency does NOT
// invalidate anything — the APK is handed a bundle calling methods it lacks.
// `fingerprint` hashes the native project, so that case is impossible.
const rv = app['runtimeVersion'] as { policy?: string } | undefined;
ck('runtimeVersion policy is fingerprint', rv?.policy === 'fingerprint', JSON.stringify(rv));

console.log('\nEvery report says which JS revision produced it');
const release = read('src/constants/release.ts');
ck('release.ts reads the running update id', release.includes('Updates.updateId'));
ck('...and distinguishes an OTA launch from the embedded one',
  release.includes('isEmbeddedLaunch'));
// The nine consumers were all stamping APP_BUILD, which is now constant
// across every OTA revision of a single APK.
const STAMPED = [
  'src/screen/HomeScreen.tsx',      // the visible label
  'src/components/TellMe.tsx',      // "stuck here" reports
  'App.tsx',                        // migration + integrity failures
  'src/context/FitnessContext.tsx', // the digest header
  'src/dev/exportFile.ts',          // the backup's share title
];
for (const file of STAMPED) {
  const src = read(file);
  ck(`${file} stamps the running release, not just APP_BUILD`,
    /buildStamp\(\)|releaseDetail\(\)/.test(src) && !/\bAPP_BUILD\b/.test(src));
}

console.log('\nThe pure modules stay pure');
// checks/backup.ts loads src/dev/backup, which loads constants/build. One
// native import anywhere on that path and the suite stops running.
for (const file of ['src/constants/build.ts', 'src/dev/backup.ts']) {
  ck(`${file} imports no native module`,
    !/from '(expo-|react-native)/.test(read(file)), file);
}
ck('serializeLog takes the app label as a parameter',
  /serializeLog\(\s*events: Event\[\], app: string = APP_BUILD\s*\)/.test(read('src/dev/backup.ts')));
ck('APP_BUILD is still a plain string for it to default to',
  typeof APP_BUILD === 'string' && APP_BUILD.length > 0, APP_BUILD);

console.log('\nThe APK and the build string move together');
// Android refuses an APK whose versionCode is not higher than the installed
// one, and a report without a build string cannot be placed against a commit.
// Both are hand-bumped, so both are easy to forget — and forgetting either is
// only discovered by a tester.
const vc = (app['android'] as { versionCode?: number }).versionCode;
ck('android.versionCode is an integer', Number.isInteger(vc), String(vc));
console.log(`  versionCode ${vc} · APP_BUILD ${APP_BUILD}`);

console.log(f === 0 ? '\nALL PASS\n' : `\n${f} FAILURE(S)\n`);
process.exit(f === 0 ? 0 : 1);
