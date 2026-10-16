#!/usr/bin/env node

// Plants synthetic violations for every privacy-scan rule and proves each is
// caught with redacted output. All names, numbers, and paths are invented, and
// every planted value is assembled at runtime so this file itself scans clean.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { deflateRawSync, gzipSync } from 'node:zlib'
import crypto from 'node:crypto'
import { createDeterministicArchive } from './lib/release-retrieval-contract.mjs'

const systemDir = path.dirname(fileURLToPath(import.meta.url))
const homeBaseRoot = path.resolve(systemDir, '..')
const scanner = path.join(systemDir, 'privacy-scan.mjs')
const hook = path.join(systemDir, 'hooks', 'pre-push')
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'home-base-privacy-scan-'))
const checks = []

// Hermetic: system/PROMOTION.md tells maintainers to export
// HOME_BASE_PRIVATE_DENYLIST, which would otherwise reach every child scan,
// git push, and hook below (and so package.mjs, which runs this test). No
// child inherits it; a case that needs a denylist passes its own synthetic one.
const maintainerDenylistExported = process.env.HOME_BASE_PRIVATE_DENYLIST !== undefined
delete process.env.HOME_BASE_PRIVATE_DENYLIST

const join = (...parts) => parts.join('')
const planted = {
  name: join('Zebulon', ' ', 'Quarry'),
  wrappedName: join('Zebulon', '\n', 'Quarry'),
  slugName: join('zebulon', '-', 'quarry'),
  place: join('Quarry', 'town'),
  email: join('zebulon.quarry', '@', 'quarrymail', '.net'),
  allowedEmail: join('someone', '@', 'example', '.com'),
  serviceEmail: join('noreply', '@', 'anthropic', '.com'),
  phone: join('(415) ', '555-', '0137'),
  internationalPhone: join('+44 ', '20 ', '7946 ', '0958'),
  card: join('4111 1111 ', '1111 1111'),
  plainCard: join('5555', '5555', '5555', '4444'),
  notLuhn: join('4111 1111 ', '1111 1112'),
  endingIn: join('card ending in ', '4242'),
  lastFour: join('last four digits: ', '9876'),
  masked: join('acct x', '7781'),
  stars: join('****', '5521'),
  macPath: join('/', 'Users', '/', 'testperson', '/notes'),
  linuxPath: join('/', 'home', '/', 'testperson', '/data'),
  windowsPath: join('C:', '\\', 'Users', '\\', 'testperson', '\\doc.txt'),
}
const secrets = Object.entries(planted)
  .filter(([key]) => !['allowedEmail', 'serviceEmail', 'notLuhn'].includes(key))
  .map(([, value]) => value)
  .concat(['Zebulon', 'Quarry', 'quarrymail', 'testperson'])

function write(root, relativePath, value) {
  const target = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, value)
}

function scan(args, options = {}) {
  const result = spawnSync(process.execPath, [scanner, ...args], { encoding: 'utf8', ...options })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

function assertRedacted(output, label) {
  for (const secret of secrets) {
    assert.equal(output.toLowerCase().includes(secret.toLowerCase()), false, `${label}: output leaked planted text`)
  }
}

function assertFinding(output, rule, where) {
  assert.ok(output.includes(`FINDING ${rule} ${where}`), `expected ${rule} at ${where}\n${output}`)
}

const gitEnvironment = {
  ...process.env,
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Fixture Author',
  GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'Fixture Author',
  GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
}

function git(repository, args, environment = gitEnvironment) {
  const result = spawnSync('git', ['-C', repository, ...args], { encoding: 'utf8', env: environment })
  assert.equal(result.status, 0, `git ${args[0]} failed`)
  return result.stdout.trim()
}

try {
  const outside = path.join(fixtureRoot, 'outside')
  const denylist = path.join(outside, 'denylist.txt')
  write(outside, 'denylist.txt', `# synthetic private terms\n${planted.name}\n${planted.place}\nab\n`)

  const tree = path.join(fixtureRoot, 'tree')
  write(tree, 'clean.md', `# Clean\n\nWrite to ${planted.allowedEmail} or ${planted.serviceEmail}.\nNot a card: ${planted.notLuhn}.\nDate 2026-10-15, version 1.1.0, hash 4b71312.\n`)
  write(tree, 'email.md', `one\ntwo\ncontact ${planted.email}\n`)
  write(tree, 'phone.md', `call ${planted.phone}\n\nabroad ${planted.internationalPhone}\n`)
  write(tree, 'card.md', `${planted.card}\nplain ${planted.plainCard}\n`)
  write(tree, 'last-four.md', `${planted.endingIn}\n${planted.lastFour}\n${planted.masked}\n${planted.stars}\n`)
  write(tree, 'paths.md', `${planted.macPath}\n${planted.linuxPath}\n${planted.windowsPath}\n`)
  write(tree, 'denylist.md', `intro\nwritten by ${planted.wrappedName}\nslug ${planted.slugName}\n`)
  write(tree, `notes/${planted.place.toLowerCase()}-notes.md`, 'harmless body\n')
  write(tree, 'LICENSE', `Copyright (c) 2026 ${planted.name}\n`)
  write(tree, 'instance/private.md', `${planted.email} ${planted.name}\n`)
  write(tree, '.home-base/state/note.md', `${planted.email}\n`)
  write(tree, 'node_modules/pkg/index.js', `// ${planted.email}\n`)
  write(tree, 'archive.tgz', 'a .tgz is never read as text in tree mode\n')

  const treeScan = scan(['--tree', tree, '--denylist', denylist])
  assert.equal(treeScan.status, 1)
  assertFinding(treeScan.output, 'email', 'email.md:3')
  assertFinding(treeScan.output, 'phone', 'phone.md:1')
  assertFinding(treeScan.output, 'phone', 'phone.md:3')
  assertFinding(treeScan.output, 'card-number', 'card.md:1')
  assertFinding(treeScan.output, 'card-number', 'card.md:2')
  for (const line of [1, 2, 3, 4]) assertFinding(treeScan.output, 'last-four', `last-four.md:${line}`)
  for (const line of [1, 2, 3]) assertFinding(treeScan.output, 'machine-path', `paths.md:${line}`)
  assertFinding(treeScan.output, 'denylist', 'denylist.md:2')
  assertFinding(treeScan.output, 'denylist', 'denylist.md:4')
  assertFinding(treeScan.output, 'denylist', '[redacted path ')
  assert.ok(treeScan.output.includes('LICENSE'), 'without an allowlisted identity fact, LICENSE is reported')
  assert.equal(treeScan.output.includes('clean.md'), false)
  assert.equal(/instance|\.home-base|node_modules/.test(treeScan.output), false)
  assertFinding(treeScan.output, 'unscannable', 'archive.tgz:-')
  assert.ok(treeScan.output.includes('Ignored 1 denylist line(s) shorter than 3 characters'))
  assertRedacted(treeScan.output, 'tree scan')
  checks.push('tree scan catches email, phone, Luhn-valid card, last-four, machine-path, and denylist (wrapped, slugged, and in file names) with redacted output')

  const allowlist = path.join(outside, 'allowlist.json')
  write(outside, 'allowlist.json', `${JSON.stringify({
    schemaVersion: 1,
    reservedEmailDomains: ['example.com'],
    publicEmails: [planted.serviceEmail],
    identityFacts: [{ fact: 'synthetic license holder', values: [planted.name], files: ['LICENSE'] }],
  }, null, 2)}\n`)
  const scopedScan = scan(['--tree', tree, '--denylist', denylist, '--allowlist', allowlist])
  assert.equal(scopedScan.status, 1)
  assert.equal(scopedScan.output.includes('LICENSE'), false)
  assertFinding(scopedScan.output, 'denylist', 'denylist.md:2')
  assertRedacted(scopedScan.output, 'scoped scan')
  checks.push('a public identity fact is allowed only in the files the allowlist names')

  const repository = path.join(fixtureRoot, 'repository')
  fs.mkdirSync(repository)
  git(repository, ['init', '-q', '-b', 'main'])
  write(repository, 'README.md', 'clean start\n')
  fs.mkdirSync(path.join(repository, 'system'))
  fs.copyFileSync(path.join(systemDir, 'privacy-allowlist.json'), path.join(repository, 'system', 'privacy-allowlist.json'))
  git(repository, ['add', '-A'])
  git(repository, ['commit', '-q', '-m', 'clean start'])
  const base = git(repository, ['rev-parse', 'HEAD'])
  write(repository, 'docs/contact.md', `reach me at ${planted.phone}\n`)
  git(repository, ['add', '-A'])
  git(repository, ['commit', '-q', '-m', `add contact\n\nsee ${planted.macPath}`], {
    ...gitEnvironment,
    GIT_AUTHOR_NAME: planted.name,
    GIT_AUTHOR_EMAIL: planted.email,
  })
  const head = git(repository, ['rev-parse', 'HEAD']).slice(0, 12)
  const commitScan = scan(['--repo', repository, '--commits', `${base}..HEAD`, '--denylist', denylist, '--ref', `feature/${planted.slugName}`])
  assert.equal(commitScan.status, 1)
  assertFinding(commitScan.output, 'denylist', `commit ${head} author-name`)
  assertFinding(commitScan.output, 'email', `commit ${head} author-email`)
  assertFinding(commitScan.output, 'machine-path', `commit ${head} message:3`)
  assertFinding(commitScan.output, 'phone', `commit ${head} docs/contact.md:1`)
  assertFinding(commitScan.output, 'denylist', 'ref #1')
  assert.equal(commitScan.output.includes('README.md'), false, 'blobs outside the range are not rescanned')
  assertRedacted(commitScan.output, 'commit scan')
  assert.equal(scan(['--repo', repository, '--commits', `${base}..HEAD`, '--commits', 'HEAD']).status, 2)
  assert.equal(scan(['--repo', repository, '--commits', 'HEAD --output=x']).status, 2)
  checks.push('commit scan covers author and committer names and emails, messages, added blobs, and ref names')

  const archive = path.join(fixtureRoot, 'home-base-fixture.tgz')
  createDeterministicArchive([
    { path: 'home-base/README.md', contents: 'clean\n', mode: 0o644 },
    { path: 'home-base/system/leak.md', contents: `x\n${planted.endingIn}\n`, mode: 0o644 },
  ], archive)
  const archiveScan = scan(['--archive', archive])
  assert.equal(archiveScan.status, 1)
  assertFinding(archiveScan.output, 'last-four', 'archive:home-base/system/leak.md:2')
  assertRedacted(archiveScan.output, 'archive scan')
  checks.push('archive scan extracts a packaged .tgz privately with tar and scans every entry')

  write(outside, 'pr-body.md', `## Summary\nThanks to ${planted.name} for the review.\n`)
  const textScan = scan(['--text', path.join(outside, 'pr-body.md'), '--denylist', denylist])
  assert.equal(textScan.status, 1)
  assertFinding(textScan.output, 'denylist', 'text pr-body.md:2')
  assertRedacted(textScan.output, 'text scan')
  checks.push('pull-request or reviewer text is scanned with the same redaction')

  write(tree, 'inside-denylist.txt', `${planted.name}\n`)
  assert.equal(scan(['--tree', tree, '--denylist', path.join(tree, 'inside-denylist.txt')]).status, 2)
  assert.equal(scan(['--denylist', path.join(homeBaseRoot, 'system', 'privacy-allowlist.json')]).status, 2)
  write(outside, 'empty-denylist.txt', '# nothing\n')
  assert.equal(scan(['--tree', tree, '--denylist', path.join(outside, 'empty-denylist.txt')]).status, 2)
  assert.equal(scan(['--tree', tree, '--denylist', path.join(outside, 'missing.txt')]).status, 2)
  assert.equal(scan(['--unknown']).status, 2)
  assert.equal(scan(['--tree']).status, 2)
  checks.push('a denylist inside the repository or a scanned folder, an empty or missing denylist, and bad arguments exit 2')

  // A packaged or installed Home Base holds personal files in user-owned
  // folders, so outside a development checkout only maintained paths are checked.
  const developmentCheckout = !fs.existsSync(path.join(homeBaseRoot, 'system', 'distribution', 'release.json'))
  const ownScan = scan(developmentCheckout ? [] : ['--tree', homeBaseRoot, '--maintained'])
  assert.equal(ownScan.status, 0, ownScan.output)
  checks.push(`this Home Base scans clean (${developmentCheckout ? 'whole development tree' : 'maintained release paths'})`)

  // M4: content that cannot be read as text is a finding; UTF-16 is decoded.
  const contentTree = path.join(fixtureRoot, 'content-tree')
  const leakText = `notes for ${planted.name}, card ${planted.card}\n`
  write(contentTree, 'export.zip', Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), deflateRawSync(leakText)]))
  write(contentTree, 'report.docx', Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), deflateRawSync(leakText)]))
  write(contentTree, 'statement.pdf', Buffer.concat([Buffer.from('%PDF-1.7\n'), deflateRawSync(leakText)]))
  write(contentTree, 'notes.txt.gz', gzipSync(leakText))
  write(contentTree, 'renamed.txt', gzipSync(leakText))
  write(contentTree, 'sheet.xlsx', deflateRawSync(leakText))
  write(contentTree, 'photo.png', Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'))
  write(contentTree, 'utf16-bom.txt', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(leakText, 'utf16le')]))
  write(contentTree, 'utf16be-bom.txt', Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(leakText, 'utf16le').swap16()]))
  write(contentTree, 'utf16-plain.txt', Buffer.from(leakText, 'utf16le'))
  const contentScan = scan(['--tree', contentTree, '--denylist', denylist])
  assert.equal(contentScan.status, 1)
  for (const file of ['export.zip', 'report.docx', 'statement.pdf', 'notes.txt.gz', 'renamed.txt', 'sheet.xlsx', 'photo.png']) assertFinding(contentScan.output, 'unscannable', `${file}:-`)
  for (const file of ['utf16-bom.txt', 'utf16be-bom.txt', 'utf16-plain.txt']) {
    assertFinding(contentScan.output, 'denylist', `${file}:1`)
    assertFinding(contentScan.output, 'card-number', `${file}:1`)
  }
  assertRedacted(contentScan.output, 'content scan')
  const pngDigest = crypto.createHash('sha256').update(fs.readFileSync(path.join(contentTree, 'photo.png'))).digest('hex')
  const binaryAllowlist = path.join(outside, 'binary-allowlist.json')
  write(outside, 'binary-allowlist.json', `${JSON.stringify({
    schemaVersion: 1,
    identityFacts: [],
    unscannableFiles: [{ path: 'photo.png', sha256: pngDigest }, { path: 'export.zip', sha256: '0'.repeat(64) }],
  }, null, 2)}\n`)
  const allowedBinary = scan(['--tree', contentTree, '--allowlist', binaryAllowlist])
  assert.equal(allowedBinary.output.includes('photo.png'), false, 'an exact path and sha256 in unscannableFiles is accepted')
  assertFinding(allowedBinary.output, 'unscannable', 'export.zip:-')
  checks.push('zip, office, PDF, gzip (by magic or name), and image files are unscannable findings unless their exact path and sha256 are allowlisted; UTF-16 text (with or without a BOM) is decoded and scanned')

  // m3: formatting tricks are decoded before identity rules run.
  const trickTree = path.join(fixtureRoot, 'trick-tree')
  const [local, domain] = planted.email.split('@')
  write(trickTree, 'fullwidth.md', `reach ${local}＠${domain}\n`)
  write(trickTree, 'percent.md', `mailto:${local}%40${domain}\n`)
  write(trickTree, 'entity.md', `<a>${local}&#64;${domain}</a> or ${local}&commat;${domain}\n`)
  write(trickTree, 'zero-width.md', `by ${planted.name.slice(0, 4)}​${planted.name.slice(4)}\n`)
  write(trickTree, 'fullwidth-name.md', `by Ｚ${planted.name.slice(1)}\n`)
  const trickScan = scan(['--tree', trickTree, '--denylist', denylist])
  for (const file of ['fullwidth.md', 'percent.md', 'entity.md']) assertFinding(trickScan.output, 'email', `${file}:1`)
  for (const file of ['zero-width.md', 'fullwidth-name.md']) assertFinding(trickScan.output, 'denylist', `${file}:1`)
  assertRedacted(trickScan.output, 'trick scan')
  checks.push('fullwidth, percent-encoded, entity-encoded, and zero-width variants of emails and denylist terms are caught')

  // m2: redacted path labels are keyed per run, so they cannot be checked
  // against guessed names.
  const label = (output) => output.match(/\[redacted path ([0-9a-f]{12})\]/)?.[1]
  const firstLabel = label(scan(['--tree', tree, '--denylist', denylist]).output)
  const secondLabel = label(scan(['--tree', tree, '--denylist', denylist]).output)
  assert.ok(firstLabel && secondLabel && firstLabel !== secondLabel)
  assert.notEqual(firstLabel, crypto.createHash('sha256').update(`notes/${planted.place.toLowerCase()}-notes.md`).digest('hex').slice(0, 12))
  checks.push('redacted path labels change every run (keyed with a random per-run secret)')

  // M7 and M4 in commits; m4: the allowlist comes from the committed blob.
  write(repository, 'instance/private.md', 'therapy on Tuesday; balance 18,240\n')
  write(repository, '.home-base/state/update-state.json', '{}\n')
  write(repository, 'config/.env.local', 'NAME=value\n')
  write(repository, 'certs/server.pem', 'not a real key\n')
  write(repository, '.claude/settings.local.json', '{}\n')
  write(repository, 'CLAUDE.local.md', 'local notes\n')
  write(repository, 'exports/notes.md.gz', gzipSync(leakText))
  write(repository, 'exports/export.txt', Buffer.from(leakText, 'utf16le'))
  git(repository, ['add', '-f', '-A'])
  // A case variant of instance/ (a separate folder on case-sensitive disks).
  const variantBlob = spawnSync('git', ['-C', repository, 'hash-object', '-w', '--stdin'], { encoding: 'utf8', input: 'case variant\n', env: gitEnvironment }).stdout.trim()
  git(repository, ['update-index', '--add', '--cacheinfo', `100644,${variantBlob},Instance/other.md`])
  git(repository, ['commit', '-q', '-m', 'private paths'])
  const privateHead = git(repository, ['rev-parse', 'HEAD']).slice(0, 12)
  const pathScan = scan(['--repo', repository, '--commits', 'HEAD~1..HEAD', '--denylist', denylist])
  assert.equal(pathScan.status, 1)
  for (const file of ['instance/private.md', 'Instance/other.md', '.home-base/state/update-state.json', 'config/.env.local', 'certs/server.pem', '.claude/settings.local.json', 'CLAUDE.local.md']) {
    assertFinding(pathScan.output, 'private-path', `commit ${privateHead} ${file}:name`)
  }
  assertFinding(pathScan.output, 'unscannable', `commit ${privateHead} exports/notes.md.gz:-`)
  assertFinding(pathScan.output, 'denylist', `commit ${privateHead} exports/export.txt:1`)
  assertRedacted(pathScan.output, 'private-path scan')
  const committedAllowlist = path.join(repository, 'system', 'privacy-allowlist.json')
  const widened = JSON.parse(fs.readFileSync(committedAllowlist, 'utf8'))
  widened.reservedEmailDomains.push(planted.email.split('@')[1])
  fs.writeFileSync(committedAllowlist, `${JSON.stringify(widened, null, 2)}\n`)
  assertFinding(scan(['--repo', repository, '--commits', `${base}..HEAD`]).output, 'email', `commit ${head} author-email`)
  git(repository, ['checkout', '--', 'system/privacy-allowlist.json'])
  checks.push('commits that add instance/ (any case), .home-base/, .env*, key files, or local settings are private-path findings; compressed and UTF-16 blobs are caught; an uncommitted allowlist edit is ignored')

  // M5: annotated tags (tagger and message) are scanned.
  git(repository, ['tag', '-a', 'v0.0.1', '-m', `release notes thanking ${planted.name}`, base], {
    ...gitEnvironment,
    GIT_COMMITTER_NAME: planted.name,
    GIT_COMMITTER_EMAIL: planted.email,
  })
  const tagObject = git(repository, ['rev-parse', 'v0.0.1']).slice(0, 12)
  const tagScan = scan(['--repo', repository, '--tag', 'v0.0.1', '--denylist', denylist])
  assert.equal(tagScan.status, 1)
  assertFinding(tagScan.output, 'denylist', `tag ${tagObject} message:1`)
  assertFinding(tagScan.output, 'denylist', `tag ${tagObject} tagger-name:-`)
  assertFinding(tagScan.output, 'email', `tag ${tagObject} tagger-email:-`)
  assertRedacted(tagScan.output, 'tag scan')
  checks.push('annotated tags: tagger name and email and the tag message are scanned')

  // Archives: nested archives, private paths, and UTF-16 entries.
  const richArchive = path.join(fixtureRoot, 'home-base-rich.tgz')
  createDeterministicArchive([
    { path: 'home-base/README.md', contents: 'clean\n', mode: 0o644 },
    { path: 'home-base/instance/notes.md', contents: 'private overlay\n', mode: 0o644 },
    { path: 'home-base/system/inner.tgz', contents: gzipSync(leakText), mode: 0o644 },
    { path: 'home-base/system/utf16.txt', contents: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(leakText, 'utf16le')]), mode: 0o644 },
  ], richArchive)
  const richScan = scan(['--archive', richArchive, '--denylist', denylist])
  assert.equal(richScan.status, 1)
  assertFinding(richScan.output, 'private-path', 'archive:home-base/instance/notes.md:name')
  assertFinding(richScan.output, 'unscannable', 'archive:home-base/system/inner.tgz:-')
  assertFinding(richScan.output, 'denylist', 'archive:home-base/system/utf16.txt:1')
  assertRedacted(richScan.output, 'rich archive scan')
  assert.equal(fs.readdirSync(os.tmpdir()).some((name) => name.startsWith('home-base-privacy-archive-') && fs.existsSync(path.join(os.tmpdir(), name, 'home-base', 'system', 'utf16.txt'))), false, 'the private extraction folder is removed')
  checks.push('archive entries are extracted privately; nested archives, instance/ entries, and UTF-16 entries are caught')

  // m1: the inside-repository check resolves the real path and ignores case.
  const caseVariant = path.join(path.dirname(tree), path.basename(tree).toUpperCase(), 'inside-denylist.txt')
  assert.equal(scan(['--tree', tree, '--denylist', caseVariant]).status, 2)
  checks.push('a denylist inside a scanned folder is refused even when named with different case')

  // M3, M5, M6: the installed hook.
  const zero = '0'.repeat(40)
  const scannerFiles = ['privacy-scan.mjs', 'privacy-allowlist.json', 'lib/tracked-files.mjs']
  const hookRepository = path.join(fixtureRoot, 'hook-repository')
  const publicRemote = path.join(fixtureRoot, 'public.git')
  const privateRemote = path.join(fixtureRoot, 'private.git')
  const withDenylist = { ...gitEnvironment, HOME_BASE_PRIVATE_DENYLIST: denylist }
  const commitAll = (message, environment = gitEnvironment) => {
    git(hookRepository, ['add', '-A'])
    git(hookRepository, ['commit', '-q', '--allow-empty', '-m', message], environment)
    return git(hookRepository, ['rev-parse', 'HEAD'])
  }
  const push = (args, environment = withDenylist) => spawnSync('git', ['-C', hookRepository, 'push', '-q', ...args], { encoding: 'utf8', env: environment })
  const remoteHas = (remote, ref) => spawnSync('git', ['--git-dir', remote, 'rev-parse', '--verify', '--quiet', ref], { encoding: 'utf8' }).status === 0
  fs.mkdirSync(hookRepository)
  git(hookRepository, ['init', '-q', '-b', 'main'])
  write(hookRepository, 'README.md', 'no scanner on this commit\n')
  const noScanner = commitAll('before the scanner')
  fs.mkdirSync(path.join(hookRepository, 'system', 'lib'), { recursive: true })
  for (const file of scannerFiles) fs.copyFileSync(path.join(systemDir, file), path.join(hookRepository, 'system', file))
  const cleanSha = commitAll('scanner')
  for (const remote of [publicRemote, privateRemote]) spawnSync('git', ['init', '-q', '--bare', remote])
  git(hookRepository, ['remote', 'add', 'origin', publicRemote])
  git(hookRepository, ['remote', 'add', 'private', privateRemote])

  git(hookRepository, ['config', 'core.hooksPath', 'system/hooks'])
  assert.equal(scan(['--install-hook', '--repo', hookRepository]).status, 2, 'install refuses while core.hooksPath is set')
  git(hookRepository, ['config', '--unset', 'core.hooksPath'])
  const installedHook = path.join(hookRepository, '.git', 'hooks', 'pre-push')
  write(hookRepository, '.git/hooks/pre-push', '#!/bin/sh\nexit 0\n')
  assert.equal(scan(['--install-hook', '--repo', hookRepository]).status, 2, 'install never overwrites a foreign hook')
  fs.rmSync(installedHook)
  const install = scan(['--install-hook', '--repo', hookRepository])
  assert.equal(install.status, 0, install.output)
  assert.ok((fs.statSync(installedHook).mode & 0o111) !== 0)
  assert.equal(git(hookRepository, ['status', '--porcelain']), '', 'the installed hook lives outside the tracked tree')

  const runHook = (lines, environment = withDenylist, remote = 'origin') => spawnSync('/bin/sh', [installedHook, remote, publicRemote], {
    cwd: hookRepository,
    encoding: 'utf8',
    input: lines,
    env: environment,
  })
  const withoutDenylist = { ...gitEnvironment }
  delete withoutDenylist.HOME_BASE_PRIVATE_DENYLIST
  assert.equal(runHook(`refs/heads/main ${cleanSha} refs/heads/main ${zero}\n`, withoutDenylist).status, 1)
  assert.equal(runHook(`refs/heads/main ${cleanSha} refs/heads/main ${zero}\n`, { ...gitEnvironment, HOME_BASE_PRIVATE_DENYLIST: path.join(outside, 'empty-denylist.txt') }).status, 1)
  write(outside, 'zero-bytes.txt', '')
  assert.equal(runHook(`refs/heads/main ${cleanSha} refs/heads/main ${zero}\n`, { ...gitEnvironment, HOME_BASE_PRIVATE_DENYLIST: path.join(outside, 'zero-bytes.txt') }).status, 1)
  const fakeBin = path.join(fixtureRoot, 'fake-bin')
  fs.mkdirSync(fakeBin)
  for (const tool of ['git', 'mktemp', 'mkdir', 'rm']) {
    const located = spawnSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim()
    fs.symlinkSync(located, path.join(fakeBin, tool))
  }
  const noNode = runHook(`refs/heads/main ${cleanSha} refs/heads/main ${zero}\n`, { ...withDenylist, PATH: fakeBin })
  assert.equal(noNode.status, 1)
  assert.ok(noNode.stderr.includes('node is not installed'))
  checks.push('the installed hook refuses without a denylist, with an empty one, or without node; install refuses core.hooksPath and foreign hooks')

  const firstPush = push(['origin', 'main'])
  assert.equal(firstPush.status, 0, firstPush.stderr)
  assert.ok(remoteHas(publicRemote, 'refs/heads/main'))
  git(hookRepository, ['checkout', '-q', '-b', 'from-old', noScanner])
  write(hookRepository, 'generic.md', 'generic improvement\n')
  commitAll('generic')
  const oldBranch = push(['origin', 'from-old'])
  assert.notEqual(oldBranch.status, 0)
  assert.ok(oldBranch.stderr.includes('has no system/privacy-scan.mjs'))
  assert.equal(remoteHas(publicRemote, 'refs/heads/from-old'), false)
  git(hookRepository, ['checkout', '-q', 'main'])
  const crashing = path.join(hookRepository, 'system', 'privacy-scan.mjs')
  const realScanner = fs.readFileSync(crashing)
  git(hookRepository, ['checkout', '-q', '-b', 'crash'])
  fs.writeFileSync(crashing, 'throw new Error("scanner crashed")\n')
  commitAll('broken scanner')
  assert.notEqual(push(['origin', 'crash']).status, 0)
  assert.equal(remoteHas(publicRemote, 'refs/heads/crash'), false)
  fs.writeFileSync(crashing, 'process.exit(0)\n')
  commitAll('scanner that exits 0 without scanning')
  assert.notEqual(push(['origin', 'crash']).status, 0)
  assert.equal(remoteHas(publicRemote, 'refs/heads/crash'), false)
  git(hookRepository, ['checkout', '-q', 'main'])
  assert.deepEqual(fs.readFileSync(crashing), realScanner)
  checks.push('a branch without the scanner (cut from an older commit), and a branch whose scanner crashes or exits 0 without scanning, are refused and never reach the remote')

  git(hookRepository, ['checkout', '-q', '-b', 'leak'])
  write(hookRepository, 'notes.md', `drafted with ${planted.name}\n`)
  commitAll('notes')
  const leakPush = push(['origin', 'leak'])
  assert.notEqual(leakPush.status, 0)
  assertRedacted(`${leakPush.stdout}${leakPush.stderr}`, 'pre-push hook')
  git(hookRepository, ['checkout', '-q', 'main'])

  git(hookRepository, ['tag', '-a', 'v1.0.0', '-m', `thanks to ${planted.name}`, cleanSha])
  assert.notEqual(push(['origin', 'refs/tags/v1.0.0']).status, 0)
  assert.equal(remoteHas(publicRemote, 'refs/tags/v1.0.0'), false)
  git(hookRepository, ['tag', '-a', 'v1.0.1', '-m', 'clean release notes', cleanSha], { ...gitEnvironment, GIT_COMMITTER_EMAIL: planted.email })
  assert.notEqual(push(['origin', 'refs/tags/v1.0.1']).status, 0)
  git(hookRepository, ['tag', '-a', 'v1.0.2', '-m', 'clean release notes', cleanSha])
  assert.equal(push(['origin', 'refs/tags/v1.0.2']).status, 0)
  checks.push('a commit adding a denylisted term, an annotated tag whose message or tagger leaks, are refused; a clean annotated tag passes')

  // Private history reachable only from another remote is still scanned.
  git(hookRepository, ['checkout', '-q', '-b', 'private-main'])
  write(hookRepository, 'finance.md', `budget note for ${planted.name}\n`)
  commitAll('private note')
  const privatePush = push(['private', 'private-main:main'], gitEnvironment)
  assert.notEqual(privatePush.status, 0, 'the hook still refuses without a denylist, even for the private remote')
  const privateSeed = spawnSync('git', ['-C', hookRepository, 'push', '-q', '--no-verify', 'private', 'private-main:main'], { encoding: 'utf8', env: gitEnvironment })
  assert.equal(privateSeed.status, 0, privateSeed.stderr)
  git(hookRepository, ['fetch', '-q', 'private'])
  git(hookRepository, ['checkout', '-q', '-b', 'promo', 'private/main'])
  write(hookRepository, 'generic.md', 'generic improvement\n')
  commitAll('generic')
  assert.notEqual(push(['origin', 'promo']).status, 0)
  assert.equal(remoteHas(publicRemote, 'refs/heads/promo'), false)
  checks.push('a new branch built on another remote\'s history is scanned against the remote being pushed to only')

  // Force push, unknown remote commit, and deleted ref.
  git(hookRepository, ['checkout', '-q', '-B', 'rewrite', cleanSha])
  write(hookRepository, 'clean.md', 'first\n')
  commitAll('first')
  assert.equal(push(['origin', 'rewrite']).status, 0)
  git(hookRepository, ['reset', '-q', '--hard', cleanSha])
  write(hookRepository, 'clean.md', `rewritten by ${planted.name}\n`)
  commitAll('rewrite')
  assert.notEqual(push(['--force', 'origin', 'rewrite']).status, 0)
  git(hookRepository, ['reset', '-q', '--hard', cleanSha])
  write(hookRepository, 'clean.md', 'rewritten cleanly\n')
  const cleanRewrite = commitAll('clean rewrite')
  assert.equal(push(['--force', 'origin', 'rewrite']).status, 0)
  const unknownRemote = crypto.randomBytes(20).toString('hex')
  assert.equal(runHook(`refs/heads/rewrite ${git(hookRepository, ['rev-parse', 'leak'])} refs/heads/rewrite ${unknownRemote}\n`).status, 1)
  assert.equal(runHook(`refs/heads/rewrite ${cleanRewrite} refs/heads/rewrite ${unknownRemote}\n`).status, 0)
  const deleted = push(['origin', '--delete', 'rewrite'])
  assert.equal(deleted.status, 0, deleted.stderr)
  assert.equal(remoteHas(publicRemote, 'refs/heads/rewrite'), false)
  checks.push('force pushes are scanned (leaking rewrite refused, clean rewrite passes), an unknown remote commit falls back to the remote\'s history, and deleting a ref passes')
  if (maintainerDenylistExported) checks.push('ran with HOME_BASE_PRIVATE_DENYLIST exported; no child inherited it')
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true })
}

console.log(`Privacy scan fixtures passed (${checks.length} checks):`)
for (const check of checks) console.log(`- ${check}`)
