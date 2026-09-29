/**
 * Turn a folder of tester backup files into something you can act on.
 *
 * WHY THIS EXISTS. The in-app digest is prose — right for one person reading
 * one thread, useless for six people over four weeks. The backup file is the
 * full event log as JSON, so it is the channel that aggregates: verdicts,
 * gripes, where in a session people stop, which exercises get abandoned, and
 * who quietly stopped opening the app.
 *
 *   npx tsx tools/review-report.ts ~/Downloads/fitmvp-backups
 *
 * Every file in the folder is validated through parseBackup first, so a
 * truncated or tampered transfer is reported rather than silently averaged in.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseBackup } from '../src/dev/backup';
import { buildSessionsProjection, workingSets } from '../src/projections/sessions';
import { selectContextCompleteness } from '../src/context/completeness';
import { buildUserContextProjection } from '../src/projections/userContext';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: npx tsx tools/review-report.ts <folder-of-backup-json>');
  process.exit(1);
}

type Tester = {
  file: string;
  events: number;
  experience: string;
  daysPerWeek: number | string;
  where: string;
  completed: number;
  skipped: number;
  abandoned: number;
  firstDay: string;
  lastDay: string;
  daysSinceLast: number;
  verdicts: Record<string, number>;
  gripes: Record<string, number>;
  notes: { day: string; verdict: string; note: string }[];
  skipReasons: Record<string, number>;
  /** "why didn't you train" — the most valuable free text in a habit app. */
  skipNotes: { day: string; reason: string; note: string }[];
  contextPct: number;
  /** Prescribed vs logged — where in a session people actually stop. */
  setsPrescribed: number;
  setsLogged: number;
  neverTouched: Record<string, number>;
};

const bump = (r: Record<string, number>, k: string) => { r[k] = (r[k] ?? 0) + 1; };
const today = new Date().toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

const testers: Tester[] = [];
const rejected: { file: string; reason: string }[] = [];

for (const name of readdirSync(dir)) {
  const p = join(dir, name);
  if (!statSync(p).isFile() || !name.endsWith('.json')) continue;
  const parsed = parseBackup(readFileSync(p, 'utf8'));
  if (!parsed.ok) { rejected.push({ file: name, reason: parsed.reason }); continue; }

  const proj = buildSessionsProjection(parsed.events);
  const ctx = buildUserContextProjection(parsed.events);
  const all = proj.order.map((id) => proj.byId[id]).filter((s): s is NonNullable<typeof s> => !!s);
  const completed = all.filter((s) => s.status === 'completed');
  const days = all.map((s) => s.trainingDay).sort();

  const t: Tester = {
    file: name, events: parsed.events.length,
    experience: ctx.experience ?? '—',
    daysPerWeek: ctx.constraints?.daysPerWeek ?? '—',
    where: ctx.equipment ?? '—',
    completed: completed.length,
    skipped: all.filter((s) => s.status === 'skipped').length,
    abandoned: all.filter((s) => s.status === 'active' || s.status === 'scheduled').length,
    firstDay: days[0] ?? '—', lastDay: days[days.length - 1] ?? '—',
    daysSinceLast: days.length ? daysBetween(days[days.length - 1]!, today) : -1,
    verdicts: {}, gripes: {}, notes: [], skipReasons: {}, skipNotes: [],
    contextPct: Math.round(selectContextCompleteness(proj, today).percent),
    setsPrescribed: 0, setsLogged: 0, neverTouched: {},
  };

  for (const s of all) {
    if (s.review) {
      bump(t.verdicts, s.review.verdict);
      for (const g of s.review.gripes) bump(t.gripes, g);
      if (s.review.note) t.notes.push({ day: s.trainingDay, verdict: s.review.verdict, note: s.review.note });
    }
    if (s.skipReason) {
      bump(t.skipReasons, s.skipReason);
      if (s.skipNotes) t.skipNotes.push({ day: s.trainingDay, reason: s.skipReason, note: s.skipNotes });
    }
    if (s.status === 'completed' || s.status === 'active') {
      t.setsPrescribed += s.exercises.reduce((n, e) => n + e.sets, 0);
      t.setsLogged += workingSets(s.setLog).length;
      const touched = new Set(workingSets(s.setLog).map((x) => x.exerciseId));
      for (const e of s.exercises) if (!touched.has(e.exerciseId)) bump(t.neverTouched, e.name);
    }
  }
  testers.push(t);
}

const pad = (s: string | number, n: number) => String(s).padEnd(n);
const line = (n = 78) => console.log('─'.repeat(n));

console.log(`\nFitMVP tester report · ${today} · ${testers.length} backup(s)\n`);
if (rejected.length) {
  console.log('REJECTED FILES (not counted — a bad transfer must not be averaged in)');
  for (const r of rejected) console.log(`  ${r.file}: ${r.reason}`);
  console.log();
}
if (!testers.length) { console.log('No valid backups found.'); process.exit(0); }

line();
console.log('WHO IS STILL TRAINING');
line();
console.log(`  ${pad('file', 30)}${pad('done', 6)}${pad('skip', 6)}${pad('unfin', 7)}${pad('last seen', 12)}ctx`);
for (const t of [...testers].sort((a, b) => a.daysSinceLast - b.daysSinceLast)) {
  const stale = t.daysSinceLast > 10 ? '  ← GONE QUIET' : '';
  console.log(`  ${pad(t.file.slice(0, 29), 30)}${pad(t.completed, 6)}${pad(t.skipped, 6)}${pad(t.abandoned, 7)}${pad(`${t.daysSinceLast}d ago`, 12)}${t.contextPct}%${stale}`);
}

line();
console.log('VERDICTS — is the app prescribing the right sessions?');
line();
const totals: Record<string, number> = {};
for (const t of testers) for (const [k, v] of Object.entries(t.verdicts)) totals[k] = (totals[k] ?? 0) + v;
const reviewed = Object.values(totals).reduce((a, b) => a + b, 0);
for (const k of ['too_easy', 'about_right', 'too_much']) {
  const n = totals[k] ?? 0;
  const pct = reviewed ? Math.round((n / reviewed) * 100) : 0;
  console.log(`  ${pad(k, 14)}${pad(n, 5)}${'█'.repeat(Math.round(pct / 2))} ${pct}%`);
}
console.log(`\n  ${reviewed} reviewed of ${testers.reduce((a, t) => a + t.completed, 0)} completed sessions`);
console.log('  Skew toward too_easy → volume or progression is too conservative.');
console.log('  Skew toward too_much → the opposite, or the recovery gates are not firing.');

line();
console.log('GRIPES — ranked');
line();
const gripeTotals: Record<string, number> = {};
for (const t of testers) for (const [k, v] of Object.entries(t.gripes)) gripeTotals[k] = (gripeTotals[k] ?? 0) + v;
const ranked = Object.entries(gripeTotals).sort((a, b) => b[1] - a[1]);
if (!ranked.length) console.log('  none reported');
for (const [k, v] of ranked) console.log(`  ${pad(k, 22)}${pad(v, 5)}${'█'.repeat(v)}`);

line();
console.log('PRESCRIBED vs LOGGED — where people stop mid-session');
line();
for (const t of testers) {
  const pct = t.setsPrescribed ? Math.round((t.setsLogged / t.setsPrescribed) * 100) : 0;
  console.log(`  ${pad(t.file.slice(0, 29), 30)}${t.setsLogged}/${t.setsPrescribed} sets  ${pct}%`);
}
const abandonedEx: Record<string, number> = {};
for (const t of testers) for (const [k, v] of Object.entries(t.neverTouched)) abandonedEx[k] = (abandonedEx[k] ?? 0) + v;
const topAbandoned = Object.entries(abandonedEx).sort((a, b) => b[1] - a[1]).slice(0, 8);
if (topAbandoned.length) {
  console.log('\n  Exercises prescribed but never logged (a silent "no"):');
  for (const [k, v] of topAbandoned) console.log(`    ${pad(v, 4)}× ${k}`);
}

line();
console.log('SKIP REASONS');
line();
const skipTotals: Record<string, number> = {};
for (const t of testers) for (const [k, v] of Object.entries(t.skipReasons)) skipTotals[k] = (skipTotals[k] ?? 0) + v;
if (!Object.keys(skipTotals).length) console.log('  none recorded');
for (const [k, v] of Object.entries(skipTotals).sort((a, b) => b[1] - a[1])) console.log(`  ${pad(k, 18)}${v}`);
const allSkipNotes = testers.flatMap((t) => t.skipNotes.map((n) => ({ ...n, who: t.file })));
if (allSkipNotes.length) {
  console.log('\n  WHY THEY DID NOT TRAIN — in their words:');
  for (const n of allSkipNotes) console.log(`    ${n.who.slice(0, 22)} ${n.day} [${n.reason}] "${n.note}"`);
}

line();
console.log('IN THEIR OWN WORDS — read this part properly');
line();
for (const t of testers) {
  if (!t.notes.length) continue;
  console.log(`\n  ${t.file}  (${t.experience}, ${t.daysPerWeek}d/wk, ${t.where})`);
  for (const n of t.notes) console.log(`    ${n.day} [${n.verdict}] "${n.note}"`);
}
const silent = testers.filter((t) => !t.notes.length);
if (silent.length) console.log(`\n  ${silent.length} tester(s) wrote nothing: ${silent.map((t) => t.file).join(', ')}`);
console.log();
