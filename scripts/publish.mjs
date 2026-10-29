/**
 * Build and publish the app to one Domo target.
 *
 *   node scripts/publish.mjs live   (npm run deploy)
 *   node scripts/publish.mjs test   (npm run deploy:test)
 *
 * Add --dry-run to build and prepare the manifest without publishing.
 *
 * Targets live in deploy.targets.json.
 *
 * The Domo CLI has no instance flag on publish: it uses whichever login file
 * was written most recently. With logins for two instances on one machine, a
 * publish meant for one can land on the other. So the target's login file is
 * touched first, which makes it the most recent, and the CLI's own choice is
 * checked before anything is uploaded.
 *
 * The test target is the same build under a different manifest: its own name,
 * its own design (and so its own collections), and its own datasets. The first
 * test publish has no design id, so Domo creates one; it is written back to
 * deploy.targets.json so later publishes update that design.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const TARGETS_FILE = path.join(ROOT, 'deploy.targets.json');
const LOGIN_DIR = path.join(os.homedir(), '.config', 'configstore', 'ryuu');
const CLI = path.join(ROOT, 'node_modules', 'ryuu', 'dist', 'bin', 'domo.js');

const fail = (message) => {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
};

const targetName = process.argv[2];
const dryRun = process.argv.includes('--dry-run');
const targets = JSON.parse(fs.readFileSync(TARGETS_FILE, 'utf8'));
const target = targets[targetName];
if (!target) fail(`Unknown target "${targetName}". Use one of: ${Object.keys(targets).join(', ')}.`);
if (!target.instance) fail(`Set "${targetName}.instance" in deploy.targets.json first.`);

// --- choose the login -------------------------------------------------------

const loginFile = path.join(LOGIN_DIR, `${target.instance}.json`);
if (!fs.existsSync(loginFile)) {
  fail(`Not logged in to ${target.instance}. Run: npm run domo -- login -i ${target.instance}`);
}
const now = new Date();
fs.utimesSync(loginFile, now, now);

const mostRecent = fs
  .readdirSync(LOGIN_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ f, mtime: fs.statSync(path.join(LOGIN_DIR, f)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime)[0].f;
if (mostRecent !== `${target.instance}.json`) {
  fail(`The Domo CLI would publish to ${mostRecent.replace(/\.json$/, '')}, not ${target.instance}. Nothing was published.`);
}

// --- build ------------------------------------------------------------------

execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });

let buildDir = path.join(ROOT, 'dist');

if (targetName !== 'live') {
  const datasets = target.datasets ?? {};
  const missing = Object.entries(datasets).filter(([, id]) => !id).map(([alias]) => alias);
  if (missing.length) fail(`Set the dataset id for ${missing.join(', ')} in deploy.targets.json.`);

  // A copy of the build, so dist/ always holds exactly what the live app serves.
  buildDir = path.join(ROOT, `dist-${targetName}`);
  fs.rmSync(buildDir, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'dist'), buildDir, { recursive: true });

  const manifestPath = path.join(buildDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.name = target.name;
  if (target.designId) manifest.id = target.designId;
  else delete manifest.id;
  for (const mapping of manifest.datasetsMapping ?? []) {
    if (!(mapping.alias in datasets)) fail(`No dataset id configured for "${mapping.alias}".`);
    mapping.dataSetId = datasets[mapping.alias];
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

// --- publish ----------------------------------------------------------------

if (dryRun) {
  console.log(`\nDry run: would publish ${targetName} to ${target.instance} from ${path.relative(ROOT, buildDir)}/`);
  process.exit(0);
}

console.log(`\nPublishing ${targetName} to ${target.instance} from ${path.relative(ROOT, buildDir)}/`);
execFileSync('node', [CLI, 'publish'], { stdio: 'inherit', cwd: buildDir });

// The CLI writes a new design's id into the manifest it published from.
if (targetName !== 'live' && !target.designId) {
  const published = JSON.parse(fs.readFileSync(path.join(buildDir, 'manifest.json'), 'utf8'));
  if (published.id) {
    target.designId = published.id;
    fs.writeFileSync(TARGETS_FILE, JSON.stringify(targets, null, 2) + '\n');
    console.log(`\nSaved the new design id ${published.id} to deploy.targets.json — commit it.`);
  } else {
    console.warn('\nThe CLI did not report a design id. Check the Asset Library before publishing again,');
    console.warn('or the next publish will create a second test design.');
  }
}
