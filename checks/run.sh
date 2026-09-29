#!/usr/bin/env bash
# Runs every check in this directory through tsx (a drizzle-kit transitive
# dep — no new package). These were throwaway scratchpad scripts twice and
# were lost twice; they live in the repo now.
#
# WHAT THEY DO NOT COVER: anything that goes through a screen. Fourteen of
# these passed green while onboarding was unusable, because every one of
# them seeds UserContextCreated directly instead of filling the form.
cd "$(dirname "$0")/.."
pass=0; fail=0
for f in checks/*.ts; do
  if out=$(node_modules/.bin/tsx "$f" 2>&1); then
    pass=$((pass+1)); printf '  ok   %s\n' "$(basename "$f" .ts)"
  else
    fail=$((fail+1)); printf '  FAIL %s\n' "$(basename "$f" .ts)"; echo "$out" | tail -12 | sed 's/^/       /'
  fi
done
echo; echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
