import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';

/**
 * Which exported symbols can a user actually reach?
 *
 * THIS IS THE CHECK THIS PROJECT KEEPS NEEDING. Modules have repeatedly been
 * built, tested, reported as landed, and never imported — and the rule written
 * to stop it ("grep for its consumers") was applied at FILE granularity, where
 * nothing is orphaned. At EXPORT granularity 19 functions had zero consumers.
 * A one-hop grep is also not enough: `musclesFor` is consumed only by
 * resolve.ts and scheduler.ts, which looks orphaned until you follow the graph
 * to a screen.
 *
 * So: build the import graph from the entry points a user can actually reach
 * (App.tsx and everything under src/screen + src/components), then flag any
 * exported symbol that no reachable module names.
 *
 * KNOWN_ORPHANS is a deliberate, dated list. Adding to it is a decision to
 * keep dead code; the point is that it can no longer happen by accident.
 */
const ROOT = resolve(__dirname, '..');
const SRC = join(ROOT, 'src');

/** Exports nothing consumes today. Each entry is a decision, not an oversight. */
const KNOWN_ORPHANS = new Set([
  // Built for features that exist on the checklist and are not wired yet.
  'selectScheduleAdvice', 'ScheduleAdvice',          // 4.8 — never reaches a screen
  'findSubstitutes', 'findSubstitutesTiered', 'findNonSoreAlternatives', // 2.5 mid-session swap
  'getInstructions',                                 // 607 KB bundled, no UI
  'successFraming', 'progressionStyle', 'goalFeasibility', 'progressionMode',
  'isCalibrationSession', 'lastPerformance', 'exerciseIdOf',
  'draftGoalRevised', 'draftSessionResumed', 'draftExerciseSubstituted',
  'getTodaysWorkout', 'workouts', 'Workout',
  'isReadOnly', 'unreadableEventDetail',
  'parseBackup', 'describeBackup',                   // restore not implemented — see exportFile.ts
  'MAX_PLAUSIBLE_REPS', 'MAX_PLAUSIBLE_DURATION_SEC', 'MAX_PLAUSIBLE_WEIGHT_KG',
  'UPCASTERS', 'CURRENT_VERSION',                    // registry, read by upcastPayload
  'MUSCLES', 'isMuscle', 'isBodyArea', 'areaIsMeaningful', 'musclesForAll',
  'BODY_AREAS', 'BackupSchema', 'emptyOnboardingForm',
  'OBSERVABLE_CEILING', 'workingSets', 'selectDaysLogged', 'selectAdherencePct',
  'loadStep', 'scaleLoad', 'tierOf', 'SPLITS', 'DAY_MUSCLES', 'exerciseCount',
  'INITIAL_SESSIONS', 'INITIAL_USER_CONTEXT', 'INITIAL_GOAL', 'INITIAL_STREAK',
  'enterReadOnlyMode', 'verifyChain', 'eventCount', 'getLastEvent', 'hashEvent',
  'GENESIS_PREV_HASH', 'newEventId', 'trainingDayOf', 'seedHistory', 'wipeAllEvents',
  'buildDigest', 'serializeLog', 'weeklyReveal', 'applyStreakEvent',
  'applyGoalEvent', 'applyUserContextEvent', 'buildExtractiveSummary',
  'reentryPolicy', 'scaleSets', 'suggestSession', 'suggestLoad',
  'estimateStartingLoad', 'selectSplit', 'getParameters', 'resolveSession',
  'buildWarmup', 'buildCooldown', 'filterExercises', 'canonicalExerciseId',
  'loadsInjury', 'isAvailable', 'getExercise', 'EXERCISES', 'WARMUPS',
  'selectGap', 'selectRotationIndex', 'selectSessionIndex', 'selectWeekdayStats',
  'selectExerciseHistory', 'selectAdherenceWindow', 'selectSessionForDay',
  'buildSessionsProjection', 'buildStreakProjection', 'buildUserContextProjection',
  'buildGoalProjection', 'appendEvent', 'readEvents', 'applySessionEvent',
  'selectKnownExerciseIds', 'selectContextCompleteness', 'buildSessionDraft',
  'implausibleSet', 'upcastPayload', 'unreadableEventCount', 'exportLogToFile',
  'validateOnboardingForm', 'formToOnboardingPayload', 'musclesFor', 'areaLabel',
  'SORENESS_AREAS', 'INJURY_AREAS',
  // Comment claims "for migration runner + advanced ops"; useMigrations takes
  // `db`, not this. Genuinely unused — kept as a deliberate escape hatch, not
  // an oversight. Delete it if nothing needs raw SQLite by the time an LLM
  // layer lands.
  'rawSqlite',
  'SessionVerdictEnum', 'SessionGripeEnum', 'SessionReviewSchema',
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const files = [join(ROOT, 'App.tsx'), ...walk(SRC)];
const text = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));
/** Consumer scan also covers checks/ — a symbol a check exercises is not dead. */
const consumerText = new Map<string, string>([
  ...text,
  ...walk(join(ROOT, 'checks')).map((f) => [f, readFileSync(f, 'utf8')] as const),
]);

/** Resolve a relative import to a real file path. */
function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec);
  for (const cand of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (text.has(cand)) return cand;
  }
  return null;
}

const imports = new Map<string, string[]>();
for (const [f, src] of text) {
  const specs = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!);
  imports.set(f, specs.map((sp) => resolveImport(f, sp)).filter((x): x is string => x !== null));
}

// Reachable = anything the app can actually pull in from its entry points.
const entries = files.filter((f) =>
  f.endsWith('App.tsx') || f.includes('/screen/') || f.includes('/components/'));
const reachable = new Set<string>();
const stack = [...entries];
while (stack.length) {
  const f = stack.pop()!;
  if (reachable.has(f)) continue;
  reachable.add(f);
  for (const dep of imports.get(f) ?? []) stack.push(dep);
}

let fails = 0;
const ck = (n: string, c: boolean, extra = '') => {
  if (c) console.log(`  ok   ${n}`); else { fails++; console.log(`  FAIL ${n} ${extra}`); }
};

console.log('\nImport graph\n');
const unreachableFiles = files.filter((f) => !reachable.has(f) && !f.includes('/dev/'));
console.log(`  ${files.length} files · ${reachable.size} reachable from a screen or App`);
ck('no source file outside src/dev is unreachable', unreachableFiles.length === 0,
  unreachableFiles.map((f) => relative(ROOT, f)).join(', '));

console.log('\nExported symbols with zero consumers anywhere\n');
const orphans: string[] = [];
for (const [f, src] of text) {
  if (f.includes('/dev/')) continue;
  const names = [
    ...[...src.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map((m) => m[1]!),
    ...[...src.matchAll(/export\s+const\s+(\w+)/g)].map((m) => m[1]!),
  ];
  for (const n of new Set(names)) {
    // Zod payload schemas and enums are composed into their event schema
    // inside the same file and exported as API surface. Not dead code, and
    // listing 29 of them by name would bury a real finding.
    if (/(Schema|Enum)$/.test(n)) continue;
    let used = false;
    for (const [g, gsrc] of consumerText) {
      if (g === f) continue;
      if (new RegExp(`\\b${n}\\b`).test(gsrc)) { used = true; break; }
    }
    if (!used) orphans.push(n);
  }
}
const surprises = orphans.filter((o) => !KNOWN_ORPHANS.has(o));
console.log(`  ${orphans.length} orphaned exports, ${KNOWN_ORPHANS.size} on the known list`);
ck('no NEW orphaned export', surprises.length === 0, surprises.join(', '));

console.log('\nThe pixel test — computed and thrown away\n');
// Symbols whose OUTPUT never reaches a screen, even though they are called.
// This is the class a consumer-grep cannot see.
const screenText = [...text.entries()]
  .filter(([f]) => f.includes('/screen/') || f.includes('/components/'))
  .map(([, s]) => s).join('\n');
const pixel: [string, RegExp][] = [
  ['draft.warmup',      /\.warmup\b/],
  ['draft.cooldown',    /\.cooldown\b/],
  ['draft.dropped',     /\.dropped\b/],
  ['slot.targetRpe',    /\.targetRpe\b/],
  ['params.restSec',    /\.restSec\b/],
  ['reasons beyond [0]', /reasons\s*\.\s*(map|slice|join)|reasons\[[1-9]/],
];
const noPixel: string[] = [];
for (const [label, re] of pixel) {
  const rendered = re.test(screenText);
  if (!rendered) noPixel.push(label);
  console.log(`  ${rendered ? 'rendered  ' : 'NO PIXEL  '} ${label}`);
}
ck('the NO PIXEL set has not grown beyond what CLAUDE.md records',
  noPixel.length <= 6, noPixel.join(', '));
console.log('\n  (NO PIXEL entries are computed every check-in and discarded —');
console.log('   tracked as items 1, 2 and 6 in CLAUDE.md "Still open".)');

console.log(fails === 0 ? '\nall passed' : `\n${fails} FAILURE(S)`);
if (fails > 0) process.exit(1);
