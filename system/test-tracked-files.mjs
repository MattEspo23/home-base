#!/usr/bin/env node

// Proves that packaging inputs come from committed Git blobs only: ignored or
// untracked files inside maintained paths, the ignored instance/ overlay, and
// uncommitted edits never reach a release, and symlinks or submodules are refused.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  copyReleaseShapedTree,
  readTrackedBlobs,
  trackedHomeBaseTree,
  trackedReleaseFiles,
  trackedReleaseSource,
} from './lib/tracked-files.mjs'

const gitEnvironment = {
  ...process.env,
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Fixture Author',
  GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'Fixture Author',
  GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
}

if (spawnSync('git', ['--version']).status !== 0) {
  console.log('Tracked-files fixtures SKIPPED: git is not installed')
  process.exit(0)
}

function git(repository, args) {
  const result = spawnSync('git', ['-C', repository, ...args], { encoding: 'utf8', env: gitEnvironment })
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`)
  return result.stdout.trim()
}

function write(root, relativePath, value, mode) {
  const target = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, value)
  if (mode) fs.chmodSync(target, mode)
}

const manifest = {
  maintainedPaths: ['README.md', 'system'],
  userOwnedPaths: ['you'],
  starterSourceRoot: 'system/starter',
  starterFiles: ['you/SETUP.md'],
}

function createRepository(root, homeBase = '.') {
  fs.mkdirSync(root, { recursive: true })
  git(root, ['init', '-q', '-b', 'main'])
  const base = path.join(root, homeBase)
  write(base, '.gitignore', '.env.*\ninstance/\n')
  write(base, 'README.md', 'committed readme\n')
  write(base, 'system/tool.sh', '#!/bin/sh\necho fixture\n', 0o755)
  write(base, 'system/starter/you/SETUP.md', 'pristine setup\n')
  write(base, 'you/SETUP.md', 'personalized setup\n')
  git(root, ['add', '-A'])
  git(root, ['commit', '-q', '-m', 'fixture'])
  return base
}

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'home-base-tracked-files-'))
const checks = []
try {
  const repository = path.join(fixtureRoot, 'clean')
  const base = createRepository(repository)
  write(base, 'system/.env.local', 'PLANTED_IGNORED_FILE\n')
  write(base, 'instance/notes.md', 'PLANTED_INSTANCE_FILE\n')
  write(base, 'README.md', 'uncommitted edit\n')
  const tree = trackedHomeBaseTree(repository, '.')
  const files = trackedReleaseFiles(tree, manifest)
  assert.deepEqual(files, ['README.md', 'system/starter/you/SETUP.md', 'system/tool.sh', 'you/SETUP.md'])
  assert.ok(!files.some((file) => file.includes('.env') || file.startsWith('instance')))
  const sources = files.map((file) => ({ file, ...trackedReleaseSource(tree, manifest, file) }))
  const blobs = readTrackedBlobs(repository, sources.map((source) => source.blob))
  const contents = Object.fromEntries(sources.map((source) => [source.file, blobs.get(source.blob).toString('utf8')]))
  assert.equal(contents['README.md'], 'committed readme\n')
  assert.equal(contents['you/SETUP.md'], 'pristine setup\n')
  assert.equal(sources.find((source) => source.file === 'system/tool.sh').mode, '100755')
  checks.push('ignored files, instance/, and uncommitted edits never become release inputs; starters come from pristine sources')

  const nestedRepository = path.join(fixtureRoot, 'nested')
  createRepository(nestedRepository, 'home-base')
  write(nestedRepository, 'outside.md', 'outside the Home Base folder\n')
  git(nestedRepository, ['add', '-A'])
  git(nestedRepository, ['commit', '-q', '-m', 'outside file'])
  const nestedFiles = trackedReleaseFiles(trackedHomeBaseTree(nestedRepository, 'home-base'), manifest)
  assert.deepEqual(nestedFiles, ['README.md', 'system/starter/you/SETUP.md', 'system/tool.sh', 'you/SETUP.md'])
  checks.push('a Home Base folder nested in a larger repository packages only its own tracked files')

  const symlinkRepository = path.join(fixtureRoot, 'symlink')
  const symlinkBase = createRepository(symlinkRepository)
  fs.symlinkSync('../README.md', path.join(symlinkBase, 'system', 'escape.md'))
  git(symlinkRepository, ['add', '-A'])
  git(symlinkRepository, ['commit', '-q', '-m', 'symlink'])
  assert.throws(() => trackedHomeBaseTree(symlinkRepository, '.'), /symbolic links may not be packaged/)
  checks.push('tracked symbolic links are refused')

  const submoduleRepository = path.join(fixtureRoot, 'submodule')
  createRepository(submoduleRepository)
  const head = git(submoduleRepository, ['rev-parse', 'HEAD'])
  git(submoduleRepository, ['update-index', '--add', '--cacheinfo', `160000,${head},system/vendor`])
  git(submoduleRepository, ['commit', '-q', '-m', 'submodule'])
  assert.throws(() => trackedHomeBaseTree(submoduleRepository, '.'), /submodules or non-file entries/)
  checks.push('tracked submodules are refused')

  // Proof copies (prove.mjs) take only tracked files in a Git checkout, and
  // skip local-only names elsewhere, so ignored secrets never reach temp.
  const proofRepository = path.join(fixtureRoot, 'proof-copy')
  const proofBase = createRepository(proofRepository)
  write(proofBase, 'system/release-manifest.json', '{}\n')
  git(proofRepository, ['add', '-A'])
  git(proofRepository, ['commit', '-q', '-m', 'manifest'])
  write(proofBase, 'system/.env.local', 'PLANTED_IGNORED_FILE\n')
  write(proofBase, 'system/untracked-notes.md', 'PLANTED_UNTRACKED_FILE\n')
  write(proofBase, 'instance/notes.md', 'PLANTED_INSTANCE_FILE\n')
  write(proofBase, 'README.md', 'uncommitted edit is still proven\n')
  const proofCopy = path.join(fixtureRoot, 'proof-copy-output')
  const copied = copyReleaseShapedTree(proofBase, proofCopy, manifest)
  assert.deepEqual(copied.sort(), ['README.md', 'system/release-manifest.json', 'system/starter/you/SETUP.md', 'system/tool.sh', 'you/SETUP.md'])
  assert.equal(fs.readFileSync(path.join(proofCopy, 'README.md'), 'utf8'), 'uncommitted edit is still proven\n')
  assert.equal(fs.readFileSync(path.join(proofCopy, 'you/SETUP.md'), 'utf8'), 'pristine setup\n')
  const installed = path.join(fixtureRoot, 'proof-copy-installed')
  fs.cpSync(proofBase, installed, { recursive: true, filter: (source) => !source.split(path.sep).includes('.git') })
  write(installed, 'system/server.pem', 'PLANTED_KEY_FILE\n')
  write(installed, '.claude/settings.local.json', '{}\n')
  const installedCopy = path.join(fixtureRoot, 'proof-copy-installed-output')
  const installedCopied = copyReleaseShapedTree(installed, installedCopy, { ...manifest, maintainedPaths: [...manifest.maintainedPaths, '.claude'] })
  assert.ok(!installedCopied.some((file) => /\.env|\.pem$|settings\.local|instance/.test(file)), installedCopied.join(', '))
  checks.push('proof copies take only tracked files in a Git checkout and skip .env*, key files, and local settings elsewhere')

  // An installed release the user keeps in their own Git repository: Git's
  // tracked list is the user's history and lags behind an update, so files a
  // newer release added (still untracked) must reach the proof copy, and the
  // user's own files must not.
  const userRepository = path.join(fixtureRoot, 'user-git-install')
  const userBase = createRepository(userRepository)
  write(userBase, 'system/release-manifest.json', '{}\n')
  write(userBase, 'system/distribution/release.json', '{"schemaVersion":1}\n')
  write(userBase, 'you/HOBBIES.md', 'PLANTED_USER_FILE\n')
  git(userRepository, ['add', '-A'])
  git(userRepository, ['commit', '-q', '-m', 'my home base'])
  write(userBase, 'system/lib/added-by-update.mjs', 'export const added = true\n')
  write(userBase, 'system/.env.local', 'PLANTED_IGNORED_FILE\n')
  const userCopy = path.join(fixtureRoot, 'user-git-install-output')
  const userCopied = copyReleaseShapedTree(userBase, userCopy, { ...manifest, maintainedPaths: [...manifest.maintainedPaths] })
  assert.ok(userCopied.includes('system/lib/added-by-update.mjs'), userCopied.join(', '))
  assert.ok(!userCopied.some((file) => /\.env|HOBBIES/.test(file)), userCopied.join(', '))
  assert.equal(fs.readFileSync(path.join(userCopy, 'you/SETUP.md'), 'utf8'), 'pristine setup\n')
  checks.push('an installed release kept in the user\'s own Git repository is proven from its files on disk, never its Git index or the user\'s files')
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true })
}

console.log(`Tracked-files fixtures passed (${checks.length} checks):`)
for (const check of checks) console.log(`- ${check}`)
