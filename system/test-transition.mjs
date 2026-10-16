#!/usr/bin/env node

// Maintainer-only transition fixture. It needs a development checkout with Git
// history and the v1.0.1 tag, so it is not part of the package proof.
//
// It packages 1.0.1 from tag v1.0.1, the release from the committed HEAD
// ("dev1" below: 1.1.0, or a 1.1.0-dev.N pre-release) with a planted ignored
// file and a planted instance/ folder that must not ship, and the next
// pre-release as a variant ("dev2"), all in temporary clones. Then it proves the
// ordered transition: the 1.0.1 updater installs dev1 while instance/ holds
// plain text; instance/ is populated (symlink, image, config); dev1 -> dev2 and
// rollback keep it byte-identical and leave no staging, user-owned, or instance
// copies; and the documented parking procedure returns to 1.0.1 and back.
//
// It repeats the transition on a PERSONALIZED 1.0.1 install (synthetic files of
// the user's own in every user-owned folder, kept in the user's own Git
// repository), where the 1.0.1 proof refuses the install: the 1.0.1 updater
// must still install the new release, user files stay byte-identical, and a
// populated instance/ survives update, failed update, rollback, and recover.
// Finally it reproduces an install stuck by the 1.0.1 updater (a failed apply
// whose restore the 1.0.1 proof refused) and repairs it with the new release's
// `update.mjs recover --root`, which refuses, changing nothing, when a
// maintained file was hand-edited.
//
// Usage: node system/test-transition.mjs [--work-dir /absolute/folder]
// With --work-dir the fixtures are kept there for inspection.

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const systemDir = path.dirname(fileURLToPath(import.meta.url))
const homeBaseRoot = path.resolve(systemDir, '..')
const args = process.argv.slice(2)
const workDirIndex = args.indexOf('--work-dir')
const requestedWorkDir = workDirIndex >= 0 ? args[workDirIndex + 1] : null
if (workDirIndex >= 0 && (!requestedWorkDir || !path.isAbsolute(requestedWorkDir))) {
  console.error('Usage: node system/test-transition.mjs [--work-dir /absolute/folder]')
  process.exit(2)
}

// Built at runtime so this file (which ships in every archive, base, and
// checkpoint) never contains the literal markers it searches for.
const MARKER = ['INSTANCE', 'PRIVATE', 'MARKER', '51b2'].join('_')
const IGNORED_MARKER = ['PLANTED', 'IGNORED', 'FILE', '7c19'].join('_')
const fixtureEnvironment = {
  ...process.env,
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Transition Fixture',
  GIT_AUTHOR_EMAIL: 'transition@example.invalid',
  GIT_COMMITTER_NAME: 'Transition Fixture',
  GIT_COMMITTER_EMAIL: 'transition@example.invalid',
}

let failures = 0
function check(ok, label, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${!ok && detail ? `\n  ${detail.split('\n').slice(-6).join('\n  ')}` : ''}`)
  if (!ok) failures += 1
  return ok
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options })
  return { status: result.status, stdout: result.stdout ?? '', out: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() }
}

function git(repository, gitArgs) {
  const result = run('git', ['-C', repository, ...gitArgs], { env: fixtureEnvironment })
  if (result.status !== 0) throw new Error(`git ${gitArgs.join(' ')} failed:\n${result.out}`)
  return result.stdout.trim()
}

const repositoryRoot = run('git', ['-C', homeBaseRoot, 'rev-parse', '--show-toplevel']).stdout.trim()
if (!repositoryRoot || run('git', ['-C', homeBaseRoot, 'rev-parse', '--verify', '--quiet', 'v1.0.1^{commit}']).status !== 0) {
  console.error('test-transition needs a development checkout with Git history and the v1.0.1 tag.')
  process.exit(2)
}
const relativeHomeBase = path.relative(repositoryRoot, homeBaseRoot) || '.'
const headCommit = git(repositoryRoot, ['rev-parse', 'HEAD'])
if (git(repositoryRoot, ['status', '--porcelain', '--', relativeHomeBase])) {
  console.log('NOTE uncommitted changes are not part of this test; dev.1 is packaged from the committed HEAD.')
}

const parent = requestedWorkDir ?? os.tmpdir()
fs.mkdirSync(parent, { recursive: true })
const base = fs.mkdtempSync(path.join(parent, 'transition-'))
const packages = path.join(base, 'packages')
fs.mkdirSync(packages)

function cloneAt(name, revision) {
  const clone = path.join(base, 'sources', name)
  fs.mkdirSync(path.dirname(clone), { recursive: true })
  git(repositoryRoot, ['clone', '--quiet', '--no-hardlinks', repositoryRoot, clone])
  // A detached HEAD (as in pull-request CI) is not a branch, so fetch it explicitly.
  git(clone, ['fetch', '--quiet', repositoryRoot, 'HEAD'])
  git(clone, ['checkout', '--quiet', '-B', `transition-${name}`, revision])
  git(clone, ['remote', 'remove', 'origin'])
  return path.join(clone, relativeHomeBase)
}

function packageRelease(sourceHomeBase, version) {
  const output = path.join(packages, `home-base-${version}.tgz`)
  const result = run(process.execPath, [path.join(sourceHomeBase, 'system', 'package.mjs'), '--output', output], { cwd: sourceHomeBase })
  if (result.status !== 0) throw new Error(`packaging ${version} failed:\n${result.out.slice(-2000)}`)
  return { output, log: result.out }
}

function archiveEntries(archive) {
  return run('tar', ['-tzf', archive]).stdout.split('\n').filter(Boolean)
}

function extract(version, into) {
  fs.mkdirSync(into, { recursive: true })
  const result = run('tar', ['-xzf', path.join(packages, `home-base-${version}.tgz`), '-C', into])
  if (result.status !== 0) throw new Error(result.out)
  return path.join(into, 'home-base')
}

function hb(root, updateArgs) {
  const result = run(process.execPath, [path.join(root, 'system', 'update.mjs'), ...updateArgs], { cwd: root })
  let json = null
  try { json = JSON.parse(result.stdout) } catch { json = null }
  return { ...result, json }
}

function validate(root) {
  return run(process.execPath, [path.join(root, 'system', 'validate.mjs')], { cwd: root })
}

function version(root) {
  return JSON.parse(fs.readFileSync(path.join(root, 'system', 'release-manifest.json'), 'utf8')).version
}

function state(root) {
  return JSON.parse(fs.readFileSync(path.join(root, '.home-base', 'state', 'update-state.json'), 'utf8'))
}

function update(root, candidate) {
  const prepared = hb(root, ['prepare', '--candidate', candidate])
  if (prepared.status !== 0 || !prepared.json) return { status: prepared.status ?? 1, out: prepared.out }
  const plan = JSON.parse(fs.readFileSync(prepared.json.planPath, 'utf8'))
  const applyArgs = ['apply', '--candidate', candidate, '--plan', prepared.json.planPath, '--approve', prepared.json.planDigest]
  if (plan.deletes.length > 0) applyArgs.push('--approve-deletes', prepared.json.planDigest)
  const applied = hb(root, applyArgs)
  return { status: applied.status, tx: prepared.json.transactionId, out: applied.out }
}

function rollback(root, transactionId) {
  return hb(root, ['rollback', '--transaction', transactionId, '--approve', transactionId])
}

function treeHash(directory) {
  if (!fs.existsSync(directory)) return 'absent'
  const hash = crypto.createHash('sha256')
  const visit = (relativePath) => {
    const absolute = path.join(directory, relativePath)
    const stat = fs.lstatSync(absolute)
    if (stat.isSymbolicLink()) hash.update(`L:${relativePath}->${fs.readlinkSync(absolute)}\n`)
    else if (stat.isFile()) hash.update(`F:${relativePath}:${crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex')}\n`)
    else for (const entry of fs.readdirSync(absolute).sort()) visit(path.join(relativePath, entry))
  }
  visit('')
  return hash.digest('hex')
}

// Copies of instance/ or user-owned files anywhere in hidden updater state.
function hiddenCopies(root) {
  const hits = { stagingDirs: 0, instancePaths: 0, markerFiles: 0, userOwnedInStaging: 0, journalOld: 0 }
  const stateRoot = path.join(root, '.home-base', 'state')
  const staging = path.join(stateRoot, 'staging')
  hits.stagingDirs = fs.existsSync(staging) ? fs.readdirSync(staging).length : 0
  const visit = (absolute, relativePath) => {
    const stat = fs.lstatSync(absolute)
    const segments = relativePath.split('/')
    if (segments.includes('instance')) hits.instancePaths += 1
    if (segments.includes('journal-old') && segments.at(-1) === 'journal-old') hits.journalOld += 1
    if (segments[0] === 'staging' && segments.some((segment) => ['you', 'work', 'memory'].includes(segment))) hits.userOwnedInStaging += 1
    if (stat.isFile() && fs.readFileSync(absolute).includes(MARKER)) hits.markerFiles += 1
    if (stat.isDirectory()) for (const entry of fs.readdirSync(absolute)) visit(path.join(absolute, entry), relativePath ? `${relativePath}/${entry}` : entry)
  }
  if (fs.existsSync(stateRoot)) visit(stateRoot, '')
  return hits
}

function clean(hits) {
  return hits.stagingDirs === 0 && hits.instancePaths === 0 && hits.markerFiles === 0 && hits.userOwnedInStaging === 0 && hits.journalOld === 0
}

function populateInstance(root) {
  const instance = path.join(root, 'instance')
  fs.mkdirSync(path.join(instance, 'node_modules', 'tool', 'bin'), { recursive: true })
  fs.writeFileSync(path.join(instance, 'node_modules', 'tool', 'bin', 'cli.js'), '#!/usr/bin/env node\n')
  fs.mkdirSync(path.join(instance, 'node_modules', '.bin'), { recursive: true })
  fs.symlinkSync('../tool/bin/cli.js', path.join(instance, 'node_modules', '.bin', 'tool'))
  fs.mkdirSync(path.join(instance, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(instance, 'assets', 'avatar.png'), Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'))
  fs.writeFileSync(path.join(instance, 'config.json'), `${JSON.stringify({ owner: 'fictional', marker: MARKER }, null, 2)}\n`)
  fs.writeFileSync(path.join(instance, 'NOTES.md'), `[broken link](missing.md) ${MARKER}\n`)
}

// Invented content only. Every user-owned folder gets a file of the user's own,
// and one starter file is personalized.
const SYNTHETIC_USER_FILES = {
  'you/HOBBIES.md': '# Hobbies\n\n- Fictional: restoring a 1970s bicycle.\n',
  'work/CLIENTS.md': '# Clients\n\n- Example Bakery (fictional), weekly review.\n',
  'projects/garden-renovation.md': '# Garden renovation (fictional)\n\nNext step: pick three shrubs.\n',
  'systems/garden-planner/BLUEPRINT.md': '# Garden planner blueprint (fictional)\n',
  'systems/garden-planner/PROOF.md': '# Garden planner proof (fictional)\n',
  'capabilities/2026-01-01-sample-connector.md': '# Sample connector review (fictional)\n',
  'knowledge/SOIL-NOTES.md': '# Soil notes (fictional)\n\nLoam drains well.\n',
  'memory/FIXTURE-NOTES.md': '# Notes (fictional)\n\n- Prefers short summaries.\n',
}
const USER_OWNED_ROOTS = JSON.parse(fs.readFileSync(path.join(homeBaseRoot, 'system', 'release-manifest.json'), 'utf8')).userOwnedPaths

function personalize(root) {
  for (const [relativePath, text] of Object.entries(SYNTHETIC_USER_FILES)) {
    fs.mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true })
    fs.writeFileSync(path.join(root, relativePath), text)
  }
  fs.appendFileSync(path.join(root, 'you', 'ABOUT.md'), '\n- Fictional detail: lives near a river.\n')
  // Like a user who keeps their Home Base in Git: the tracked list lags behind
  // every update, which once made a correct candidate fail after the swap.
  git(root, ['init', '-q'])
  git(root, ['add', '-A'])
  git(root, ['commit', '-q', '-m', 'my home base'])
}

// Every user-owned file except the update history the updater appends to.
function userFilesHash(root) {
  const hash = crypto.createHash('sha256')
  for (const owned of USER_OWNED_ROOTS) {
    const visit = (relativePath) => {
      const absolute = path.join(root, relativePath)
      const stat = fs.lstatSync(absolute, { throwIfNoEntry: false })
      if (!stat || relativePath === 'memory/UPDATE-HISTORY.md') return
      if (stat.isFile()) hash.update(`F:${relativePath}:${crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex')}\n`)
      else if (stat.isDirectory()) for (const entry of fs.readdirSync(absolute).sort()) visit(`${relativePath}/${entry}`)
      else hash.update(`O:${relativePath}\n`)
    }
    visit(owned)
  }
  return hash.digest('hex')
}

// A candidate whose proof passes on the staged tree and fails after the swap.
function brokenCandidate(source, into) {
  const broken = path.join(into, 'home-base')
  fs.mkdirSync(into, { recursive: true })
  const copied = run('cp', ['-RP', source, broken])
  if (copied.status !== 0) throw new Error(copied.out)
  fs.writeFileSync(path.join(broken, 'system', 'prove.mjs'), [
    "if (!process.cwd().split('/').includes('staging')) {",
    "  console.error('Synthetic proof failure after the swap')",
    '  process.exit(1)',
    '}',
    '',
  ].join('\n'))
  return broken
}

function park(root) {
  const parked = `${root}-instance-parked`
  fs.renameSync(path.join(root, 'instance'), parked)
  return parked
}

function unpark(root, parked) {
  fs.renameSync(parked, path.join(root, 'instance'))
}

// Files a user may keep that the release rules refuse: a screenshot, a note
// with a broken link, and fake key-shaped text (assembled at runtime). From 1.1
// the validator only notes them; 1.0.x validators refuse them anywhere.
const MESSY_USER_FILES = {
  'projects/screenshot.png': Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'),
  'knowledge/reading-notes.md': '# Reading notes (fictional)\n\nSee [the chapter summary](./chapter-summary.md), not written yet.\n',
  'memory/pasted-by-mistake.md': `${['Fixture', 'Only', '-', 'Not', 'A', 'Key', '-', '2026', '!'].join('')}\n`,
}

function addMessyUserFiles(root) {
  for (const [relativePath, contents] of Object.entries(MESSY_USER_FILES)) fs.writeFileSync(path.join(root, relativePath), contents)
}

// Before rolling back to 1.0.x, these move out along with instance/.
function parkMessyUserFiles(root) {
  const parked = `${root}-files-parked`
  for (const relativePath of Object.keys(MESSY_USER_FILES)) {
    fs.mkdirSync(path.dirname(path.join(parked, relativePath)), { recursive: true })
    fs.renameSync(path.join(root, relativePath), path.join(parked, relativePath))
  }
  return parked
}

function unparkMessyUserFiles(root, parked) {
  for (const relativePath of Object.keys(MESSY_USER_FILES)) fs.renameSync(path.join(parked, relativePath), path.join(root, relativePath))
}

try {
  console.log(`Fixtures: ${base}`)

  // ---- packaging
  packageRelease(cloneAt('1.0.1', 'v1.0.1'), '1.0.1')
  check(true, 'packaged 1.0.1 from tag v1.0.1')

  const dev1Source = cloneAt('dev1', headCommit)
  fs.writeFileSync(path.join(dev1Source, 'system', '.env.local'), `planted ignored file ${IGNORED_MARKER}\n`)
  fs.mkdirSync(path.join(dev1Source, 'instance'), { recursive: true })
  fs.writeFileSync(path.join(dev1Source, 'instance', 'README.md'), `${MARKER}\n`)
  const dev1Version = version(dev1Source)
  const dev1 = packageRelease(dev1Source, dev1Version)
  check(/^1\.1\.\d+(?:-dev\.\d+)?$/.test(dev1Version), `packaged ${dev1Version} from committed HEAD ${headCommit.slice(0, 12)}`)
  check(dev1.log.includes('Excluded 1 untracked or ignored file(s) inside maintained paths'), 'packager reports the planted ignored file as excluded', dev1.log)
  const dev1Entries = archiveEntries(dev1.output)
  const dev1Bytes = gunzipSync(fs.readFileSync(dev1.output))
  check(!dev1Entries.some((entry) => entry.includes('.env.local') || entry.startsWith('home-base/instance')) && !dev1Bytes.includes(IGNORED_MARKER) && !dev1Bytes.includes(MARKER),
    `dev archive (${dev1Entries.length} entries) contains no instance/, no planted ignored file, and neither marker`)

  // The variant is the next pre-release: dev.N+1 after a pre-release, or the
  // next patch's dev.1 after a stable release (which also needs the pre-release
  // Status line).
  const dev2Version = /-dev\.\d+$/.test(dev1Version)
    ? dev1Version.replace(/dev\.(\d+)$/, (_, number) => `dev.${Number(number) + 1}`)
    : dev1Version.replace(/^(\d+)\.(\d+)\.(\d+)$/, (_, major, minor, patch) => `${major}.${minor}.${Number(patch) + 1}-dev.1`)
  const dev2Source = cloneAt('dev2', headCommit)
  for (const file of ['VERSION.md', 'PROVENANCE.json', 'system/release-manifest.json']) {
    const target = path.join(dev2Source, file)
    let text = fs.readFileSync(target, 'utf8').replaceAll(dev1Version, dev2Version)
    if (file === 'VERSION.md') text = text.replace(/^- Status: public stable release$/m, '- Status: pre-release')
    fs.writeFileSync(target, text)
  }
  fs.appendFileSync(path.join(dev2Source, 'system', 'README.md'), '\n<!-- transition fixture: dev.2 maintained change -->\n')
  git(dev2Source, ['commit', '--quiet', '-am', `fixture ${dev2Version}`])
  packageRelease(dev2Source, dev2Version)
  check(true, `packaged ${dev2Version} variant`)

  // ---- ordered transition
  const install = extract('1.0.1', path.join(base, 'install'))
  check(hb(install, ['init']).status === 0, 'init the 1.0.1 install')
  fs.mkdirSync(path.join(install, 'instance'))
  fs.writeFileSync(path.join(install, 'instance', 'README.md'), `Plain text only before the first upgrade. ${MARKER}\n`)
  const dev1Candidate = extract(dev1Version, path.join(base, 'candidate-dev1'))
  const dev2Candidate = extract(dev2Version, path.join(base, 'candidate-dev2'))

  const u1 = update(install, dev1Candidate)
  check(u1.status === 0 && version(install) === dev1Version, `the 1.0.1 updater installs ${dev1Version} with a plain-text instance/`, u1.out)
  console.log(`  hidden state left by the 1.0.1 updater: ${JSON.stringify(hiddenCopies(install))}`)
  check(hb(install, ['init']).status === 0, `${dev1Version} init runs on the upgraded install`)
  const afterSweep = hiddenCopies(install)
  check(clean(afterSweep), `${dev1Version} init sweeps the 1.0.1 staging copy and its journal-old ${JSON.stringify(afterSweep)}`)

  populateInstance(install)
  const instanceHash = treeHash(path.join(install, 'instance'))
  const populated = validate(install)
  check(populated.status === 0, 'validator passes with a symlink, image, config, and broken-link note in instance/', populated.out)

  const u2 = update(install, dev2Candidate)
  check(u2.status === 0 && version(install) === dev2Version, `${dev1Version} -> ${dev2Version} with a populated instance/`, u2.out)
  const afterDev2 = hiddenCopies(install)
  check(clean(afterDev2), `no staging, journal-old, instance, or user-owned copies after the update ${JSON.stringify(afterDev2)}`)
  check(treeHash(path.join(install, 'instance')) === instanceHash, 'instance/ byte-identical after the update')

  const r2 = rollback(install, u2.tx)
  check(r2.status === 0 && version(install) === dev1Version && state(install).lastSuccessfulTransactionId === u1.tx, `rollback ${dev2Version} -> ${dev1Version}; the earlier update becomes the latest`, r2.out)
  check(treeHash(path.join(install, 'instance')) === instanceHash, 'instance/ byte-identical after rollback')
  const afterRollback = hiddenCopies(install)
  check(clean(afterRollback), `no staging, journal-old, instance, or user-owned copies after rollback ${JSON.stringify(afterRollback)}`)

  // ---- negative control: rolling back to 1.0.1 without parking
  const negative = path.join(base, 'negative', 'home-base')
  fs.mkdirSync(path.dirname(negative), { recursive: true })
  run('cp', ['-RP', install, negative])
  const failed = rollback(negative, u1.tx)
  check(failed.status !== 0 && /recovery_required|recover/.test(failed.out), 'negative control: rollback to 1.0.1 with a populated instance/ stops and asks for recover', failed.out)
  check(state(negative).activeTransactionId === u1.tx && version(negative) === '1.0.1', 'negative control: 1.0.1 files are back and the transaction stays active for recovery')
  const negativeParked = park(negative)
  const recovered = hb(negative, ['recover'])
  check(recovered.status === 0 && version(negative) === '1.0.1' && state(negative).activeTransactionId === null, 'negative control: after parking, the 1.0.1 recover completes', recovered.out)
  check(treeHash(negativeParked) === instanceHash, 'negative control: the parked instance/ is intact')

  // ---- the documented parking procedure
  const parked = park(install)
  const r1 = rollback(install, u1.tx)
  check(r1.status === 0 && version(install) === '1.0.1', `procedure: park instance/, roll back ${dev1Version} -> 1.0.1`, r1.out)
  const onStable = validate(install)
  check(onStable.status === 0, 'the 1.0.1 validator passes while instance/ is parked', onStable.out)
  unpark(install, parked)
  check(validate(install).status !== 0, 'a populated instance/ fails the 1.0.1 validator, so it stays parked on 1.0.x')
  const parkedAgain = park(install)
  const back = update(install, dev1Candidate)
  check(back.status === 0 && version(install) === dev1Version, `re-upgrade 1.0.1 -> ${dev1Version} with instance/ parked`, back.out)
  const afterReupgrade = hb(install, ['init']).status === 0 && hiddenCopies(install)
  check(afterReupgrade && clean(afterReupgrade), `${dev1Version} init sweeps staging after the re-upgrade ${JSON.stringify(afterReupgrade)}`)
  unpark(install, parkedAgain)
  const restored = validate(install)
  check(restored.status === 0 && treeHash(path.join(install, 'instance')) === instanceHash, 'instance/ restored after the re-upgrade, validator passes, byte-identical', restored.out)

  // ---- a personalized 1.0.1 install
  const personal = extract('1.0.1', path.join(base, 'personal'))
  check(hb(personal, ['init']).status === 0, 'init a second 1.0.1 install')
  personalize(personal)
  fs.mkdirSync(path.join(personal, 'instance'))
  fs.writeFileSync(path.join(personal, 'instance', 'README.md'), `Plain text only before the first upgrade. ${MARKER}\n`)
  let personalUser = userFilesHash(personal)
  const personalHistory = fs.readFileSync(path.join(personal, 'memory', 'UPDATE-HISTORY.md'), 'utf8')
  check(validate(personal).status === 0, 'the 1.0.1 validator passes on the personalized install')
  const oldProof = run(process.execPath, [path.join(personal, 'system', 'prove.mjs')], { cwd: personal })
  check(oldProof.status !== 0 && /personalized files outside the starter manifest/.test(oldProof.out), 'control: the 1.0.1 proof refuses the personalized install (the 1.0.x bug)', oldProof.out)

  const p1 = update(personal, dev1Candidate)
  check(p1.status === 0 && version(personal) === dev1Version, `the 1.0.1 updater installs ${dev1Version} on a personalized, Git-tracked install`, p1.out)
  check(userFilesHash(personal) === personalUser, 'user-owned files byte-identical after the 1.0.1 updater')
  check(fs.readFileSync(path.join(personal, 'memory', 'UPDATE-HISTORY.md'), 'utf8').startsWith(personalHistory), 'update history was only appended to')
  const newValidate = validate(personal)
  const newProof = run(process.execPath, [path.join(personal, 'system', 'prove.mjs')], { cwd: personal })
  check(newValidate.status === 0 && newProof.status === 0, `${dev1Version} validate and prove pass with cwd = the personalized install`, `${newValidate.out}\n${newProof.out}`)
  const personalSweep = hb(personal, ['init']).status === 0 && hiddenCopies(personal)
  check(personalSweep && clean(personalSweep), `${dev1Version} init sweeps the 1.0.1 staging copy of the user's files ${JSON.stringify(personalSweep)}`)

  addMessyUserFiles(personal)
  personalUser = userFilesHash(personal)
  const messyValidate = validate(personal)
  check(messyValidate.status === 0 && /Notes about your own files \(3\)/.test(messyValidate.out), `${dev1Version} validator only notes a screenshot, a broken link, and key-shaped text in the user's folders`, messyValidate.out)

  populateInstance(personal)
  const personalInstance = treeHash(path.join(personal, 'instance'))
  const p2 = update(personal, dev2Candidate)
  check(p2.status === 0 && version(personal) === dev2Version, `${dev1Version} -> ${dev2Version} on the personalized install with a populated instance/`, p2.out)
  check(userFilesHash(personal) === personalUser && treeHash(path.join(personal, 'instance')) === personalInstance, 'user files and instance/ byte-identical after the update')
  const pr2 = rollback(personal, p2.tx)
  check(pr2.status === 0 && version(personal) === dev1Version && state(personal).activeTransactionId === null, `rollback ${dev2Version} -> ${dev1Version} completes on the personalized install with a screenshot, a broken link, and key-shaped text in its folders`, pr2.out)
  check(userFilesHash(personal) === personalUser && treeHash(path.join(personal, 'instance')) === personalInstance, 'user files and instance/ byte-identical after rollback')
  const afterPersonalRollback = hiddenCopies(personal)
  check(clean(afterPersonalRollback), `no staging, journal-old, instance, or user-owned copies after rollback ${JSON.stringify(afterPersonalRollback)}`)

  const broken = brokenCandidate(dev2Candidate, path.join(base, 'candidate-broken'))
  const failedApply = update(personal, broken)
  check(failedApply.status !== 0 && /verified checkpoint was restored/.test(failedApply.out) && state(personal).activeTransactionId === null && version(personal) === dev1Version,
    `a candidate failing after the swap is restored (confirmed by checkpoint hashes) on the personalized install, not left stuck`, failedApply.out)
  check(userFilesHash(personal) === personalUser && treeHash(path.join(personal, 'instance')) === personalInstance && clean(hiddenCopies(personal)), 'user files and instance/ byte-identical, no hidden copies, after the failed update')

  const unparked = rollback(personal, p1.tx)
  check(unparked.status !== 0 && state(personal).activeTransactionId === p1.tx && version(personal) === '1.0.1', 'rollback to 1.0.1 without parking stops for recover (the 1.0.1 validator rejects instance/)', unparked.out)
  const personalParked = park(personal)
  const messyParked = parkMessyUserFiles(personal)
  const personalUserParked = userFilesHash(personal)
  const oldRecoverPersonal = hb(personal, ['recover'])
  check(oldRecoverPersonal.status !== 0 && /personalized files outside the starter manifest/.test(oldRecoverPersonal.out) && state(personal).activeTransactionId === p1.tx,
    'control: the restored 1.0.1 recover cannot finish on a personalized install, which is why the error names the updater copy', oldRecoverPersonal.out)
  const personalCommand = JSON.parse(fs.readFileSync(path.join(personal, '.home-base', 'state', 'recovery.json'), 'utf8')).recoverCommand
  const personalRecover = run('sh', ['-c', personalCommand])
  check(unparked.out.includes(personalCommand) && personalRecover.status === 0 && state(personal).activeTransactionId === null && version(personal) === '1.0.1',
    'after parking, the recover command the rollback printed completes on the personalized install without running the 1.0.1 proof', personalRecover.out)
  check(userFilesHash(personal) === personalUserParked && treeHash(personalParked) === personalInstance, 'user files and the parked instance/ byte-identical after recover')
  const personalBack = update(personal, dev1Candidate)
  check(personalBack.status === 0 && version(personal) === dev1Version && userFilesHash(personal) === personalUserParked, `the 1.0.1 updater re-installs ${dev1Version} on the personalized install`, personalBack.out)
  unpark(personal, personalParked)
  unparkMessyUserFiles(personal, messyParked)
  check(validate(personal).status === 0 && treeHash(path.join(personal, 'instance')) === personalInstance && userFilesHash(personal) === personalUser, 'instance/ and the parked user files moved back, validator passes, all byte-identical')

  // ---- an install stuck by the 1.0.1 updater, and its repair
  const stuck = extract('1.0.1', path.join(base, 'stuck'))
  check(hb(stuck, ['init']).status === 0, 'init a third 1.0.1 install')
  personalize(stuck)
  fs.mkdirSync(path.join(stuck, 'instance'))
  fs.writeFileSync(path.join(stuck, 'instance', 'README.md'), `Plain text only. ${MARKER}\n`)
  const stuckUser = userFilesHash(stuck)
  const stuckInstance = treeHash(path.join(stuck, 'instance'))
  const stuckApply = update(stuck, brokenCandidate(dev1Candidate, path.join(base, 'candidate-broken-dev1')))
  const stuckMarker = path.join(stuck, '.home-base', 'state', 'recovery.json')
  check(stuckApply.status !== 0 && /personalized files outside the starter manifest/.test(stuckApply.out) && state(stuck).activeTransactionId && fs.existsSync(stuckMarker) && version(stuck) === '1.0.1',
    'reproduced: the 1.0.1 updater restores after a failed apply, then its own proof refuses the personalized install and the transaction stays active', stuckApply.out)
  const oldRecover = hb(stuck, ['recover'])
  check(oldRecover.status !== 0 && /personalized files outside the starter manifest/.test(oldRecover.out) && state(stuck).activeTransactionId, 'reproduced: 1.0.1 recover fails the same way, so the install is stuck', oldRecover.out)
  const stuckTx = state(stuck).activeTransactionId

  const edited = path.join(base, 'stuck-edited', 'home-base')
  fs.mkdirSync(path.dirname(edited), { recursive: true })
  run('cp', ['-RP', stuck, edited])
  fs.appendFileSync(path.join(edited, 'START-HERE.md'), '\nA hand edit made after the failed update.\n')
  const editedBefore = treeHash(edited)
  const refusedRepair = hb(dev1Candidate, ['recover', '--root', edited])
  check(refusedRepair.status !== 0 && /Recovery refused: .*START-HERE\.md.*Nothing was changed/s.test(refusedRepair.out) && treeHash(edited) === editedBefore,
    'repair refuses, changing nothing (hidden state included), when a maintained file matches neither the checkpoint nor the 1.0.1 base', refusedRepair.out)

  // A 1.0.x restore that was itself cut off. The 1.0.1 restore deletes every
  // maintained root first, then copies them back in localeCompare order, so a
  // kill before system/ was copied leaves system/ and every later root
  // missing; there is no system/update.mjs left to run. The new release's
  // repair puts back only the maintained roots from the verified checkpoint.
  const interrupted = path.join(base, 'stuck-interrupted', 'home-base')
  fs.mkdirSync(path.dirname(interrupted), { recursive: true })
  run('cp', ['-RP', stuck, interrupted])
  const interruptedMaintained = treeHash(path.join(interrupted, 'system'))
  const legacyManifest = JSON.parse(fs.readFileSync(path.join(interrupted, 'system', 'release-manifest.json'), 'utf8'))
  const restoreOrder = [...legacyManifest.maintainedPaths].sort((left, right) => left.localeCompare(right))
  const cutAt = restoreOrder.indexOf('system')
  for (const maintained of restoreOrder.slice(cutAt)) fs.rmSync(path.join(interrupted, maintained), { recursive: true, force: true })
  check(!fs.existsSync(path.join(interrupted, 'system')) && cutAt > 0, `simulated a 1.0.1 restore killed before system/: ${restoreOrder.length - cutAt} of ${restoreOrder.length} maintained roots missing`)
  const interruptedRepair = hb(dev1Candidate, ['recover', '--root', interrupted])
  check(interruptedRepair.status === 0 && interruptedRepair.json?.action === 'legacy_checkpoint_restored' && state(interrupted).activeTransactionId === null && version(interrupted) === '1.0.1'
    && treeHash(path.join(interrupted, 'system')) === interruptedMaintained && userFilesHash(interrupted) === stuckUser && clean(hiddenCopies(interrupted)),
    'the repair puts the missing maintained roots back from the verified checkpoint and clears the update; user files byte-identical, no hidden copies', interruptedRepair.out)
  const interruptedUpdate = update(interrupted, dev1Candidate)
  check(interruptedUpdate.status === 0 && version(interrupted) === dev1Version && userFilesHash(interrupted) === stuckUser, `then the 1.0.1 updater installs ${dev1Version} normally`, interruptedUpdate.out)

  const repaired = hb(dev1Candidate, ['recover', '--root', stuck])
  check(repaired.status === 0 && repaired.json?.action === 'legacy_restore_verified' && state(stuck).activeTransactionId === null && !fs.existsSync(stuckMarker) && version(stuck) === '1.0.1',
    `\`node <${dev1Version}>/system/update.mjs recover --root\` clears the stuck 1.0.1 transaction ${stuckTx.slice(0, 8)}`, repaired.out)
  const afterRepair = hiddenCopies(stuck)
  check(clean(afterRepair) && userFilesHash(stuck) === stuckUser && treeHash(path.join(stuck, 'instance')) === stuckInstance,
    `repair removes the staging copy of the user's files and leaves user files and instance/ byte-identical ${JSON.stringify(afterRepair)}`)
  const unstuck = update(stuck, dev1Candidate)
  check(unstuck.status === 0 && version(stuck) === dev1Version && userFilesHash(stuck) === stuckUser, `the repaired install updates to ${dev1Version} with the 1.0.1 updater`, unstuck.out)
} catch (error) {
  failures += 1
  console.log(`FAIL ${error.message}`)
} finally {
  console.log(`\n${failures === 0 ? 'Transition fixtures passed' : `Transition fixtures failed (${failures})`}`)
  if (failures === 0 && !requestedWorkDir) fs.rmSync(base, { recursive: true, force: true })
  else console.log(`Fixtures kept in ${base}`)
}
process.exitCode = failures === 0 ? 0 : 1
