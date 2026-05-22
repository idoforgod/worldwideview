#!/usr/bin/env node
/**
 * gc-scan.mjs — Garbage Collector scanner for worldwideview
 *
 * Scans the repository for:
 *  1. Stale branches (merged or idle > STALE_BRANCH_DAYS)
 *  2. TODO/FIXME/HACK comments older than STALE_COMMENT_DAYS (via git blame)
 *  3. Orphaned workspace packages (zero reverse-deps inside the monorepo)
 *  4. Very old Prisma migrations (> 1 year untouched)
 *
 * Outputs a JSON report to stdout.
 * The workflow decides whether to open Issues/PRs based on dry_run flag.
 *
 * Usage:
 *   node scripts/gc-scan.mjs [--days-branch=90] [--days-comment=180]
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { argv, cwd } from 'node:process';

// ─── Tuneable thresholds ──────────────────────────────────────────────────────
const ARGS = Object.fromEntries(
  argv.slice(2).flatMap(a => {
    const m = a.match(/^--([\w-]+)=(.+)$/);
    return m ? [[m[1], m[2]]] : [];
  })
);

const STALE_BRANCH_DAYS  = Number(ARGS['days-branch']  ?? 90);
const STALE_COMMENT_DAYS = Number(ARGS['days-comment'] ?? 180);
const ROOT               = cwd();

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

function daysAgo(isoDate) {
  if (!isoDate) return Infinity;
  return (Date.now() - new Date(isoDate).getTime()) / 86_400_000;
}

// ─── 1. Stale branches ────────────────────────────────────────────────────────
function scanStaleBranches() {
  const findings = [];
  const out = run(
    'git for-each-ref --sort=committerdate refs/remotes/origin ' +
    '--format=%(refname:short)|%(committerdate:iso8601)|%(authorname)|%(subject)'
  );
  for (const line of out.split('\n').filter(Boolean)) {
    const [ref, date, author, subject] = line.split('|');
    const branch = ref.replace('origin/', '');
    if (['HEAD', 'main', 'master', 'develop'].includes(branch)) continue;
    const age = daysAgo(date);
    if (age < STALE_BRANCH_DAYS) continue;
    const mergeBase = run(`git merge-base origin/main "${ref}" 2>/dev/null`);
    const branchHead = run(`git rev-parse "${ref}"`);
    findings.push({
      type: 'stale-branch',
      branch,
      author,
      lastCommitDate: date?.trim(),
      ageDays: Math.floor(age),
      isMerged: mergeBase === branchHead,
      lastSubject: subject,
    });
  }
  return findings;
}

// ─── 2. Stale TODO/FIXME/HACK comments ───────────────────────────────────────
function scanStaleComments() {
  const findings = [];
  const grepResult = run(
    'git grep -rn --include=*.ts --include=*.tsx --include=*.mjs --include=*.js ' +
    '-E "TODO|FIXME|HACK|XXX" -- . :(exclude)node_modules :(exclude).next :(exclude)dist :(exclude)prisma/migrations'
  );
  for (const line of grepResult.split('\n').filter(Boolean).slice(0, 200)) {
    const m = line.match(/^([^:]+):(\d+):(.+)$/);
    if (!m) continue;
    const [, file, lineNum, text] = m;
    const blameOut = run(`git blame -L ${lineNum},${lineNum} --porcelain "${file}" 2>/dev/null`);
    const authorTimeMatch = blameOut.match(/author-time (\d+)/);
    if (!authorTimeMatch) continue;
    const age = (Date.now() - Number(authorTimeMatch[1]) * 1000) / 86_400_000;
    if (age < STALE_COMMENT_DAYS) continue;
    const authorMatch = blameOut.match(/^author (.+)$/m);
    findings.push({
      type: 'stale-comment',
      file: relative(ROOT, resolve(ROOT, file)),
      line: Number(lineNum),
      text: text.trim().slice(0, 120),
      author: authorMatch?.[1] ?? 'unknown',
      ageDays: Math.floor(age),
    });
  }
  return findings;
}

// ─── 3. Orphaned workspace packages ──────────────────────────────────────────
function scanOrphanedPackages() {
  const findings = [];
  try {
    const wsInfo = run('pnpm list --recursive --depth=0 --json 2>/dev/null');
    if (!wsInfo) return findings;
    const pkgs = JSON.parse(wsInfo);
    const allNames = new Set(pkgs.map(p => p.name).filter(Boolean));
    const reverseDepCount = Object.fromEntries([...allNames].map(n => [n, 0]));
    for (const pkg of pkgs) {
      for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
        if (reverseDepCount[dep] !== undefined) reverseDepCount[dep]++;
      }
    }
    for (const [name, count] of Object.entries(reverseDepCount)) {
      const pkg = pkgs.find(p => p.name === name);
      if (!pkg?.path?.includes('/packages/')) continue;
      if (count === 0) {
        findings.push({ type: 'orphaned-package', name, path: relative(ROOT, pkg.path) });
      }
    }
  } catch { /* skip */ }
  return findings;
}

// ─── 4. Old Prisma migrations ─────────────────────────────────────────────────
function scanOldMigrations() {
  const findings = [];
  const migrationsDir = resolve(ROOT, 'prisma/migrations');
  if (!existsSync(migrationsDir)) return findings;
  const dirs = run(`ls -1 "${migrationsDir}"`).split('\n').filter(Boolean);
  for (const dir of dirs) {
    const sqlFile = `prisma/migrations/${dir}/migration.sql`;
    const lastTouch = run(`git log -1 --format=%ci -- "${sqlFile}"`);
    if (!lastTouch) continue;
    const age = daysAgo(lastTouch);
    if (age < 365) continue;
    findings.push({
      type: 'old-migration',
      migration: dir,
      ageDays: Math.floor(age),
      lastTouched: lastTouch.trim(),
    });
  }
  return findings;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const report = {
  generatedAt: new Date().toISOString(),
  thresholds: { STALE_BRANCH_DAYS, STALE_COMMENT_DAYS },
  findings: [
    ...scanStaleBranches(),
    ...scanStaleComments(),
    ...scanOrphanedPackages(),
    ...scanOldMigrations(),
  ],
};

console.log(JSON.stringify(report, null, 2));
