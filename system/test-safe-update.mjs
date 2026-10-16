#!/usr/bin/env node

import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  applyPreparedUpdate,
  initializeUpdateState,
  prepareUpdate,
  previewUpdate,
  recoverUpdate,
  rollbackCommittedUpdate,
  sealResolution,
  updateInternals,
} from './lib/safe-update-contract.mjs'
import { copyReleaseShapedTree } from './lib/tracked-files.mjs'
import { loadReleaseManifest } from './lib/update-contract.mjs'

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'home-base-safe-update-'))
const checks = []

function pass(message) {
  checks.push(message)
}

function write(root, relative, value) {
  const target = path.join(root, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, value)
}

function manifest(version) {
  return {
    schemaVersion: 2,
    product: 'Home Base fixture',
    releaseId: `fixture-${version}`,
    version,
    starterSourceRoot: 'system/starter',
    maintainedPaths: ['managed', 'system'],
    userOwnedPaths: ['memory', 'user'],
    instancePaths: ['instance'],
    starterFiles: [],
  }
}

const USER_MARKER = 'USER_OWNED_FIXTURE_MARKER_c41d'
const INSTANCE_MARKER = 'INSTANCE_FIXTURE_MARKER_9e07'

function plantPrivateFiles(root) {
  write(root, 'user/preferences.md', `keep my preference ${USER_MARKER}\n`)
  write(root, 'instance/notes.md', `private overlay ${INSTANCE_MARKER}\n`)
  write(root, 'instance/tool.js', '// private tool\n')
  write(root, 'instance/assets/avatar.png', Buffer.from('89504e470d0a1a0a', 'hex'))
  fs.mkdirSync(path.join(root, 'instance', 'node_modules', '.bin'), { recursive: true })
  fs.symlinkSync('../../tool.js', path.join(root, 'instance', 'node_modules', '.bin', 'tool'))
}

function treeDigest(directory) {
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

// Hidden updater state may hold maintained content only: no staging, no
// journal-old, and no copy of user-owned or instance files.
function assertNoPrivateCopies(root, label) {
  const stateRoot = path.join(root, '.home-base', 'state')
  const staging = path.join(stateRoot, 'staging')
  assert.deepEqual(fs.existsSync(staging) ? fs.readdirSync(staging) : [], [], `${label}: staging must be empty`)
  const visit = (absolute, relativePath) => {
    const stat = fs.lstatSync(absolute)
    const segments = relativePath.split('/')
    assert.ok(!segments.includes('instance'), `${label}: instance copy at ${relativePath}`)
    assert.ok(!segments.includes('user'), `${label}: user-owned copy at ${relativePath}`)
    assert.ok(!segments.includes('journal-old'), `${label}: journal-old left at ${relativePath}`)
    if (stat.isFile()) {
      const bytes = fs.readFileSync(absolute)
      assert.ok(!bytes.includes(USER_MARKER) && !bytes.includes(INSTANCE_MARKER), `${label}: private bytes copied into ${relativePath}`)
    }
    if (stat.isDirectory()) for (const entry of fs.readdirSync(absolute)) visit(path.join(absolute, entry), relativePath ? `${relativePath}/${entry}` : entry)
  }
  if (fs.existsSync(stateRoot)) visit(stateRoot, '')
}

function applyFixture(current, incoming, extra = {}) {
  const prepared = prepareUpdate(current, incoming)
  applyPreparedUpdate(current, incoming, prepared.planPath, {
    approval: prepared.plan.planDigest,
    deletionApproval: prepared.plan.planDigest,
    validate: validateFixture,
    ...extra,
  })
  return prepared.plan.transactionId
}

function stateOf(root) {
  return JSON.parse(fs.readFileSync(path.join(root, '.home-base', 'state', 'update-state.json'), 'utf8'))
}

function versionOf(root) {
  return JSON.parse(fs.readFileSync(path.join(root, 'system', 'release-manifest.json'), 'utf8')).version
}

function createRelease(root, version, commitCharacter, managedText = 'top\nbase-one\nbase-two\nbottom\n') {
  fs.mkdirSync(root, { recursive: true })
  write(root, 'system/release-manifest.json', `${JSON.stringify(manifest(version), null, 2)}\n`)
  write(root, 'system/distribution/release.json', `${JSON.stringify({
    schemaVersion: 1,
    source: {
      repository: 'https://example.test/home-base',
      ref: `refs/tags/${version}`,
      commit: commitCharacter.repeat(40),
    },
  }, null, 2)}\n`)
  write(root, 'managed/skill.md', managedText)
  write(root, 'memory/UPDATE-HISTORY.md', '# Update history\n')
  write(root, 'user/preferences.md', 'keep my preference\n')
}

function validateFixture(root) {
  assert.ok(fs.existsSync(path.join(root, 'system', 'release-manifest.json')))
  updateInternals.scanWholeTree(root)
}

function crashAt(expectedPhase) {
  return (phase) => {
    if (phase === expectedPhase) {
      const error = new Error(`simulated abrupt termination at ${phase}`)
      error.simulatedAbrupt = true
      throw error
    }
  }
}

try {
  const current = path.join(fixtureRoot, 'merge-current')
  const incoming = path.join(fixtureRoot, 'merge-incoming')
  createRelease(current, '1.0.0', 'a')
  createRelease(incoming, '1.1.0', 'b', 'top\nbase-one\nupstream-two\nbottom\n')
  initializeUpdateState(current)
  write(current, 'managed/skill.md', 'top\nlocal-one\nbase-two\nbottom\n')
  write(incoming, 'managed/new.md', 'new upstream file\n')
  const prepared = prepareUpdate(current, incoming)
  const skillEntry = prepared.plan.entries.find((entry) => entry.file === 'managed/skill.md')
  assert.equal(skillEntry.action, 'write_merged')
  const applied = applyPreparedUpdate(current, incoming, prepared.planPath, {
    approval: prepared.plan.planDigest,
    validate: validateFixture,
  })
  assert.equal(fs.readFileSync(path.join(current, 'managed/skill.md'), 'utf8'), 'top\nlocal-one\nupstream-two\nbottom\n')
  assert.equal(fs.readFileSync(path.join(current, 'user/preferences.md'), 'utf8'), 'keep my preference\n')
  assert.equal(fs.readFileSync(path.join(current, 'managed/new.md'), 'utf8'), 'new upstream file\n')
  assert.equal(applied.state.currentRelease.version, '1.1.0')
  rollbackCommittedUpdate(current, prepared.plan.transactionId, prepared.plan.transactionId, { validateRestored: validateFixture })
  assert.equal(fs.readFileSync(path.join(current, 'managed/skill.md'), 'utf8'), 'top\nlocal-one\nbase-two\nbottom\n')
  assert.equal(fs.existsSync(path.join(current, 'managed/new.md')), false)
  const retry = prepareUpdate(current, incoming)
  applyPreparedUpdate(current, incoming, retry.planPath, {
    approval: retry.plan.planDigest,
    validate: validateFixture,
  })
  assert.equal(fs.readFileSync(path.join(current, 'managed/skill.md'), 'utf8'), 'top\nlocal-one\nupstream-two\nbottom\n')
  pass('three-way merge preserves local-only edits through apply, rollback, and idempotent retry')

  const newRootCurrent = path.join(fixtureRoot, 'new-root-current')
  const newRootIncoming = path.join(fixtureRoot, 'new-root-incoming')
  createRelease(newRootCurrent, '1.2.0', 'b')
  createRelease(newRootIncoming, '1.3.0', 'c')
  const newRootManifestPath = path.join(newRootIncoming, 'system', 'release-manifest.json')
  const newRootManifest = JSON.parse(fs.readFileSync(newRootManifestPath, 'utf8'))
  newRootManifest.maintainedPaths.push('THIRD_PARTY_NOTICES.md')
  fs.writeFileSync(newRootManifestPath, `${JSON.stringify(newRootManifest, null, 2)}\n`)
  write(newRootIncoming, 'THIRD_PARTY_NOTICES.md', '# New maintained root\n')
  initializeUpdateState(newRootCurrent)
  const newRootPlan = prepareUpdate(newRootCurrent, newRootIncoming)
  applyPreparedUpdate(newRootCurrent, newRootIncoming, newRootPlan.planPath, {
    approval: newRootPlan.plan.planDigest,
    validate: validateFixture,
  })
  assert.equal(fs.existsSync(path.join(newRootCurrent, 'THIRD_PARTY_NOTICES.md')), true)
  const legacyCheckpointPath = path.join(newRootCurrent, '.home-base', 'state', 'transactions', newRootPlan.plan.transactionId, 'checkpoint', 'checkpoint.json')
  const legacyCheckpoint = JSON.parse(fs.readFileSync(legacyCheckpointPath, 'utf8'))
  legacyCheckpoint.maintainedPaths = ['managed', 'system']
  fs.writeFileSync(legacyCheckpointPath, `${JSON.stringify(legacyCheckpoint, null, 2)}\n`)
  rollbackCommittedUpdate(newRootCurrent, newRootPlan.plan.transactionId, newRootPlan.plan.transactionId, { validateRestored: validateFixture })
  assert.equal(fs.existsSync(path.join(newRootCurrent, 'THIRD_PARTY_NOTICES.md')), false)
  pass('rollback removes incoming-only maintained roots, including from a legacy current-only checkpoint')

  const conflictCurrent = path.join(fixtureRoot, 'conflict-current')
  const conflictIncoming = path.join(fixtureRoot, 'conflict-incoming')
  createRelease(conflictCurrent, '2.0.0', 'c')
  createRelease(conflictIncoming, '2.1.0', 'd', 'top\nincoming-one\nbase-two\nbottom\n')
  initializeUpdateState(conflictCurrent)
  write(conflictCurrent, 'managed/skill.md', 'top\nlocal-one\nbase-two\nbottom\n')
  const conflictPrepared = prepareUpdate(conflictCurrent, conflictIncoming)
  assert.deepEqual(conflictPrepared.plan.conflictRoots, ['managed/skill.md'])
  const resolutionOutput = path.join(conflictPrepared.resolutionRoot, 'output', 'managed', 'skill.md')
  fs.mkdirSync(path.dirname(resolutionOutput), { recursive: true })
  fs.symlinkSync('missing-resolution-target', resolutionOutput)
  assert.throws(() => sealResolution(conflictCurrent, conflictPrepared.planPath), /symbolic link/)
  fs.rmSync(resolutionOutput)
  fs.linkSync(path.join(conflictCurrent, 'managed', 'skill.md'), resolutionOutput)
  assert.throws(() => sealResolution(conflictCurrent, conflictPrepared.planPath), /hard-linked/)
  fs.rmSync(resolutionOutput)
  write(path.join(conflictPrepared.resolutionRoot, 'output'), 'managed/skill.md', 'top\nreviewed-resolution\nbase-two\nbottom\n')
  const sealed = sealResolution(conflictCurrent, conflictPrepared.planPath)
  assert.equal(sealed.planDigest, conflictPrepared.plan.planDigest)
  const resolutionReceiptPath = path.join(conflictPrepared.resolutionRoot, 'resolution.json')
  const validResolutionReceipt = fs.readFileSync(resolutionReceiptPath, 'utf8')
  const foreignResolution = JSON.parse(validResolutionReceipt)
  foreignResolution.nonce = 'foreign-nonce'
  fs.writeFileSync(resolutionReceiptPath, `${JSON.stringify(foreignResolution, null, 2)}\n`)
  assert.throws(() => applyPreparedUpdate(conflictCurrent, conflictIncoming, conflictPrepared.planPath, {
    approval: conflictPrepared.plan.planDigest,
    validate: validateFixture,
  }), /foreign, incomplete, or stale/)
  fs.writeFileSync(resolutionReceiptPath, validResolutionReceipt)
  applyPreparedUpdate(conflictCurrent, conflictIncoming, conflictPrepared.planPath, {
    approval: conflictPrepared.plan.planDigest,
    validate: validateFixture,
  })
  assert.equal(fs.readFileSync(path.join(conflictCurrent, 'managed/skill.md'), 'utf8').includes('reviewed-resolution'), true)
  pass('resolution symlinks, hardlinks, and foreign receipts fail closed; overlapping intent applies only after an exact reviewed seal')

  const topologyCurrent = path.join(fixtureRoot, 'topology-current')
  const topologyIncoming = path.join(fixtureRoot, 'topology-incoming')
  createRelease(topologyCurrent, '3.0.0', 'e')
  createRelease(topologyIncoming, '3.1.0', 'f')
  write(topologyCurrent, 'managed/node', 'old file\n')
  write(topologyIncoming, 'managed/node/child.md', 'new directory child\n')
  initializeUpdateState(topologyCurrent)
  const topologyPlan = prepareUpdate(topologyCurrent, topologyIncoming)
  applyPreparedUpdate(topologyCurrent, topologyIncoming, topologyPlan.planPath, {
    approval: topologyPlan.plan.planDigest,
    validate: validateFixture,
  })
  assert.equal(fs.statSync(path.join(topologyCurrent, 'managed/node')).isDirectory(), true)
  assert.equal(fs.readFileSync(path.join(topologyCurrent, 'managed/node/child.md'), 'utf8'), 'new directory child\n')
  const reverseCurrent = path.join(fixtureRoot, 'reverse-topology-current')
  const reverseIncoming = path.join(fixtureRoot, 'reverse-topology-incoming')
  createRelease(reverseCurrent, '3.2.0', 'e')
  createRelease(reverseIncoming, '3.3.0', 'f')
  write(reverseCurrent, 'managed/node/child.md', 'old directory child\n')
  write(reverseIncoming, 'managed/node', 'new file\n')
  initializeUpdateState(reverseCurrent)
  const reversePlan = prepareUpdate(reverseCurrent, reverseIncoming)
  applyPreparedUpdate(reverseCurrent, reverseIncoming, reversePlan.planPath, {
    approval: reversePlan.plan.planDigest,
    deletionApproval: reversePlan.plan.planDigest,
    validate: validateFixture,
  })
  assert.equal(fs.statSync(path.join(reverseCurrent, 'managed/node')).isFile(), true)
  assert.equal(fs.readFileSync(path.join(reverseCurrent, 'managed/node'), 'utf8'), 'new file\n')
  pass('reviewed file-to-directory and directory-to-file transitions stage and commit without partial topology')

  const deletionCurrent = path.join(fixtureRoot, 'deletion-current')
  const deletionIncoming = path.join(fixtureRoot, 'deletion-incoming')
  createRelease(deletionCurrent, '4.0.0', '1')
  createRelease(deletionIncoming, '4.1.0', '2')
  write(deletionCurrent, 'managed/retired.md', 'retire me\n')
  initializeUpdateState(deletionCurrent)
  const deletionPlan = prepareUpdate(deletionCurrent, deletionIncoming)
  assert.ok(deletionPlan.plan.deletes.includes('managed/retired.md'))
  assert.throws(() => applyPreparedUpdate(deletionCurrent, deletionIncoming, deletionPlan.planPath, {
    approval: deletionPlan.plan.planDigest,
    validate: validateFixture,
  }), /explicit deletion approval/)
  applyPreparedUpdate(deletionCurrent, deletionIncoming, deletionPlan.planPath, {
    approval: deletionPlan.plan.planDigest,
    deletionApproval: deletionPlan.plan.planDigest,
    validate: validateFixture,
  })
  assert.equal(fs.existsSync(path.join(deletionCurrent, 'managed/retired.md')), false)
  pass('maintained-file deletion requires a second exact plan-digest approval')

  for (const attack of ['symlink', 'hardlink', 'special', 'case', 'unicode']) {
    const attackCurrent = path.join(fixtureRoot, `${attack}-current`)
    const attackIncoming = path.join(fixtureRoot, `${attack}-incoming`)
    createRelease(attackCurrent, '5.0.0', '3')
    createRelease(attackIncoming, '5.1.0', '4')
    initializeUpdateState(attackCurrent)
    if (attack === 'symlink') fs.symlinkSync('../user/preferences.md', path.join(attackIncoming, 'managed', 'escape'))
    if (attack === 'hardlink') fs.linkSync(path.join(attackIncoming, 'managed', 'skill.md'), path.join(attackIncoming, 'managed', 'linked.md'))
    if (attack === 'special') {
      const fifo = spawnSync('mkfifo', [path.join(attackIncoming, 'managed', 'pipe')], { encoding: 'utf8' })
      assert.equal(fifo.status, 0, fifo.stderr)
    }
    if (attack === 'case') {
      const attackManifest = manifest('5.1.0')
      attackManifest.maintainedPaths.push('Managed')
      write(attackIncoming, 'system/release-manifest.json', `${JSON.stringify(attackManifest, null, 2)}\n`)
      write(attackIncoming, 'Managed/collision.md', 'case-collision fixture\n')
    }
    if (attack === 'unicode') {
      const attackManifest = manifest('5.1.0')
      attackManifest.maintainedPaths.push('café', 'café')
      write(attackIncoming, 'system/release-manifest.json', `${JSON.stringify(attackManifest, null, 2)}\n`)
    }
    assert.throws(() => previewUpdate(attackCurrent, attackIncoming), /symbolic|hard-linked|special|colliding|overlap/)
  }
  pass('incoming symlinks, hardlinks, special files, case collisions, and Unicode collisions fail closed')

  const baseCurrent = path.join(fixtureRoot, 'base-current')
  const baseIncoming = path.join(fixtureRoot, 'base-incoming')
  createRelease(baseCurrent, '6.0.0', '5')
  createRelease(baseIncoming, '6.1.0', '6')
  const baseState = initializeUpdateState(baseCurrent)
  const baseSkill = path.join(baseCurrent, '.home-base', 'state', baseState.baseSnapshot.path, 'tree', 'managed', 'skill.md')
  fs.chmodSync(baseSkill, 0o600)
  fs.appendFileSync(baseSkill, 'tampered\n')
  assert.throws(() => previewUpdate(baseCurrent, baseIncoming), /base snapshot.*corrupt/i)
  const missingBaseCurrent = path.join(fixtureRoot, 'missing-base-current')
  const missingBaseIncoming = path.join(fixtureRoot, 'missing-base-incoming')
  createRelease(missingBaseCurrent, '6.2.0', '5')
  createRelease(missingBaseIncoming, '6.3.0', '6')
  const missingBaseState = initializeUpdateState(missingBaseCurrent)
  fs.rmSync(path.join(missingBaseCurrent, '.home-base', 'state', missingBaseState.baseSnapshot.path), { recursive: true })
  assert.throws(() => previewUpdate(missingBaseCurrent, missingBaseIncoming), /ENOENT|base snapshot/i)
  const currentSymlinkRoot = path.join(fixtureRoot, 'current-symlink-current')
  const currentSymlinkIncoming = path.join(fixtureRoot, 'current-symlink-incoming')
  createRelease(currentSymlinkRoot, '6.4.0', '5')
  createRelease(currentSymlinkIncoming, '6.5.0', '6')
  initializeUpdateState(currentSymlinkRoot)
  fs.rmSync(path.join(currentSymlinkRoot, 'managed', 'skill.md'))
  fs.symlinkSync('../user/preferences.md', path.join(currentSymlinkRoot, 'managed', 'skill.md'))
  assert.throws(() => previewUpdate(currentSymlinkRoot, currentSymlinkIncoming), /symbolic link/)
  pass('missing/corrupt bases and current-tree symlink substitution fail closed')

  const toctouCurrent = path.join(fixtureRoot, 'toctou-current')
  const toctouIncoming = path.join(fixtureRoot, 'toctou-incoming')
  createRelease(toctouCurrent, '7.0.0', '7')
  createRelease(toctouIncoming, '7.1.0', '8')
  initializeUpdateState(toctouCurrent)
  const toctouPlan = prepareUpdate(toctouCurrent, toctouIncoming)
  fs.appendFileSync(path.join(toctouIncoming, 'managed', 'skill.md'), 'changed after review\n')
  assert.throws(() => applyPreparedUpdate(toctouCurrent, toctouIncoming, toctouPlan.planPath, {
    approval: toctouPlan.plan.planDigest,
    validate: validateFixture,
  }), /TOCTOU|identity changed/)
  recoverUpdate(toctouCurrent, { validateRestored: validateFixture })
  pass('candidate changes after prepare are detected before mutation, then the prepared transaction recovers cleanly')

  for (const phase of ['approved', 'staged', 'committing']) {
    const crashCurrent = path.join(fixtureRoot, `crash-${phase}-current`)
    const crashIncoming = path.join(fixtureRoot, `crash-${phase}-incoming`)
    createRelease(crashCurrent, '8.0.0', '9')
    createRelease(crashIncoming, '8.1.0', 'a', `top\nbase-one\n${phase}\nbottom\n`)
    initializeUpdateState(crashCurrent)
    const crashPlan = prepareUpdate(crashCurrent, crashIncoming)
    assert.throws(() => applyPreparedUpdate(crashCurrent, crashIncoming, crashPlan.planPath, {
      approval: crashPlan.plan.planDigest,
      validate: validateFixture,
      fault: crashAt(phase),
    }), /simulated abrupt termination/)
    const recovered = recoverUpdate(crashCurrent, { validateRestored: validateFixture })
    assert.equal(recovered.recovered, true)
    const retryPlan = prepareUpdate(crashCurrent, crashIncoming)
    applyPreparedUpdate(crashCurrent, crashIncoming, retryPlan.planPath, {
      approval: retryPlan.plan.planDigest,
      validate: validateFixture,
    })
    assert.equal(JSON.parse(fs.readFileSync(path.join(crashCurrent, 'system', 'release-manifest.json'))).version, '8.1.0')
  }
  pass('abrupt termination before or at the recovery marker is recoverable and retry is idempotent')

  const swapCurrent = path.join(fixtureRoot, 'crash-swap-current')
  const swapIncoming = path.join(fixtureRoot, 'crash-swap-incoming')
  createRelease(swapCurrent, '9.0.0', 'b')
  createRelease(swapIncoming, '9.1.0', 'c', 'top\nbase-one\nswap\nbottom\n')
  initializeUpdateState(swapCurrent)
  const swapPlan = prepareUpdate(swapCurrent, swapIncoming)
  assert.throws(() => applyPreparedUpdate(swapCurrent, swapIncoming, swapPlan.planPath, {
    approval: swapPlan.plan.planDigest,
    validate: validateFixture,
    fault: crashAt('after_swap:managed'),
  }), /simulated abrupt termination/)
  assert.equal(recoverUpdate(swapCurrent, { validateRestored: validateFixture }).action, 'checkpoint_restored')
  assert.equal(JSON.parse(fs.readFileSync(path.join(swapCurrent, 'system', 'release-manifest.json'))).version, '9.0.0')
  pass('partial managed-root swaps recover from a verified checkpoint after abrupt termination')

  const checkpointCurrent = path.join(fixtureRoot, 'checkpoint-current')
  const checkpointIncoming = path.join(fixtureRoot, 'checkpoint-incoming')
  createRelease(checkpointCurrent, '9.2.0', 'b')
  createRelease(checkpointIncoming, '9.3.0', 'c')
  initializeUpdateState(checkpointCurrent)
  const checkpointPlan = prepareUpdate(checkpointCurrent, checkpointIncoming)
  assert.throws(() => applyPreparedUpdate(checkpointCurrent, checkpointIncoming, checkpointPlan.planPath, {
    approval: checkpointPlan.plan.planDigest,
    validate: validateFixture,
    fault: crashAt('committing'),
  }), /simulated abrupt termination/)
  const checkpointTreeFile = path.join(checkpointCurrent, '.home-base', 'state', 'transactions', checkpointPlan.plan.transactionId, 'checkpoint', 'tree', 'managed', 'skill.md')
  fs.appendFileSync(checkpointTreeFile, 'tampered checkpoint\n')
  assert.throws(() => recoverUpdate(checkpointCurrent, { validateRestored: validateFixture }), /checkpoint.*tampered/i)
  pass('checkpoint tampering blocks recovery instead of restoring unverified bytes')

  const validatorCurrent = path.join(fixtureRoot, 'validator-current')
  const validatorIncoming = path.join(fixtureRoot, 'validator-incoming')
  createRelease(validatorCurrent, '10.0.0', 'd')
  createRelease(validatorIncoming, '10.1.0', 'e')
  initializeUpdateState(validatorCurrent)
  const validatorPlan = prepareUpdate(validatorCurrent, validatorIncoming)
  let validationCalls = 0
  assert.throws(() => applyPreparedUpdate(validatorCurrent, validatorIncoming, validatorPlan.planPath, {
    approval: validatorPlan.plan.planDigest,
    validate: (target) => {
      validationCalls += 1
      validateFixture(target)
      if (validationCalls === 2) throw new Error('simulated post-commit validator failure')
    },
  }), /checkpoint was restored/)
  assert.equal(JSON.parse(fs.readFileSync(path.join(validatorCurrent, 'system', 'release-manifest.json'))).version, '10.0.0')
  pass('post-swap validator failure restores the checkpoint and never records update success')

  const rollbackCurrent = path.join(fixtureRoot, 'rollback-crash-current')
  const rollbackIncoming = path.join(fixtureRoot, 'rollback-crash-incoming')
  createRelease(rollbackCurrent, '10.2.0', 'd')
  createRelease(rollbackIncoming, '10.3.0', 'e')
  initializeUpdateState(rollbackCurrent)
  const rollbackPlan = prepareUpdate(rollbackCurrent, rollbackIncoming)
  applyPreparedUpdate(rollbackCurrent, rollbackIncoming, rollbackPlan.planPath, {
    approval: rollbackPlan.plan.planDigest,
    validate: validateFixture,
  })
  assert.throws(() => rollbackCommittedUpdate(rollbackCurrent, rollbackPlan.plan.transactionId, rollbackPlan.plan.transactionId, {
    validateRestored: validateFixture,
    fault: crashAt('rollback_restored'),
  }), /simulated abrupt termination/)
  assert.equal(recoverUpdate(rollbackCurrent, { validateRestored: validateFixture }).action, 'checkpoint_restored')
  assert.equal(JSON.parse(fs.readFileSync(path.join(rollbackCurrent, 'system', 'release-manifest.json'))).version, '10.2.0')
  pass('interrupted rollback is idempotently completed from the same verified checkpoint')

  const lockCurrent = path.join(fixtureRoot, 'lock-current')
  const lockIncoming = path.join(fixtureRoot, 'lock-incoming')
  createRelease(lockCurrent, '11.0.0', 'f')
  createRelease(lockIncoming, '11.1.0', '0')
  initializeUpdateState(lockCurrent)
  const lockRoot = path.join(lockCurrent, '.home-base', 'state', 'update.lock')
  fs.mkdirSync(lockRoot)
  write(lockRoot, 'owner.json', `${JSON.stringify({ pid: process.pid })}\n`)
  assert.throws(() => prepareUpdate(lockCurrent, lockIncoming), /Another Home Base update process owns the lock/)
  pass('a live exclusive lock rejects concurrent prepare/apply attempts')

  const instanceCurrent = path.join(fixtureRoot, 'instance-current')
  const instanceIncoming = path.join(fixtureRoot, 'instance-incoming')
  const instanceNext = path.join(fixtureRoot, 'instance-next')
  createRelease(instanceCurrent, '12.0.0', '1')
  createRelease(instanceIncoming, '12.1.0', '2', 'top\nbase-one\ninstance-one\nbottom\n')
  createRelease(instanceNext, '12.2.0', '3', 'top\nbase-one\ninstance-two\nbottom\n')
  plantPrivateFiles(instanceCurrent)
  const instanceDigest = treeDigest(path.join(instanceCurrent, 'instance'))
  initializeUpdateState(instanceCurrent)
  const instancePreview = previewUpdate(instanceCurrent, instanceIncoming)
  assert.ok(instancePreview.entries.every((entry) => !entry.file.startsWith('instance')))
  const instanceTx = applyFixture(instanceCurrent, instanceIncoming)
  assert.equal(versionOf(instanceCurrent), '12.1.0')
  assert.equal(treeDigest(path.join(instanceCurrent, 'instance')), instanceDigest)
  assert.equal(fs.existsSync(path.join(instanceCurrent, '.home-base', 'state', 'transactions', instanceTx, 'journal-old')), false)
  assertNoPrivateCopies(instanceCurrent, 'after commit')
  applyFixture(instanceCurrent, instanceNext)
  assertNoPrivateCopies(instanceCurrent, 'after second commit')
  const nextTx = stateOf(instanceCurrent).lastSuccessfulTransactionId
  rollbackCommittedUpdate(instanceCurrent, nextTx, nextTx, { validateRestored: validateFixture })
  assert.equal(versionOf(instanceCurrent), '12.1.0')
  assert.equal(treeDigest(path.join(instanceCurrent, 'instance')), instanceDigest)
  assertNoPrivateCopies(instanceCurrent, 'after rollback')
  pass('instance/ (symlink, image, private text) is never scanned, planned, staged, or copied; staging and journal-old are gone after commit and rollback')

  const failCurrent = path.join(fixtureRoot, 'private-fail-current')
  const failIncoming = path.join(fixtureRoot, 'private-fail-incoming')
  createRelease(failCurrent, '13.0.0', '4')
  createRelease(failIncoming, '13.1.0', '5', 'top\nbase-one\nfail\nbottom\n')
  plantPrivateFiles(failCurrent)
  initializeUpdateState(failCurrent)
  const failPlan = prepareUpdate(failCurrent, failIncoming)
  let failCalls = 0
  assert.throws(() => applyPreparedUpdate(failCurrent, failIncoming, failPlan.planPath, {
    approval: failPlan.plan.planDigest,
    validate: (target) => {
      failCalls += 1
      validateFixture(target)
      if (failCalls === 2) throw new Error('simulated post-swap validator failure')
    },
  }), /checkpoint was restored/)
  assert.equal(versionOf(failCurrent), '13.0.0')
  assertNoPrivateCopies(failCurrent, 'after failed apply')
  const abruptPlan = prepareUpdate(failCurrent, failIncoming)
  assert.throws(() => applyPreparedUpdate(failCurrent, failIncoming, abruptPlan.planPath, {
    approval: abruptPlan.plan.planDigest,
    validate: validateFixture,
    fault: crashAt('staged'),
  }), /simulated abrupt termination/)
  const abruptStaging = path.join(failCurrent, '.home-base', 'state', 'staging', abruptPlan.plan.transactionId)
  assert.ok(fs.existsSync(path.join(abruptStaging, 'user', 'preferences.md')), 'a killed apply leaves its short-lived user-owned copy')
  assert.equal(fs.existsSync(path.join(abruptStaging, 'instance')), false)
  recoverUpdate(failCurrent, { validateRestored: validateFixture })
  assertNoPrivateCopies(failCurrent, 'after recover')
  const staleStaging = path.join(failCurrent, '.home-base', 'state', 'staging', 'stale-from-older-updater')
  write(staleStaging, 'user/preferences.md', `${USER_MARKER}\n`)
  write(staleStaging, 'instance/notes.md', `${INSTANCE_MARKER}\n`)
  write(path.join(failCurrent, '.home-base', 'state', 'transactions', 'older-updater-tx', 'journal-old'), 'managed/skill.md', 'replaced root kept by an older updater\n')
  initializeUpdateState(failCurrent)
  assertNoPrivateCopies(failCurrent, 'after init sweep')
  pass('failed applies, killed applies plus recover, and init leave no user-owned or instance copy (and no stale journal-old) under .home-base/state')

  const doubleCurrent = path.join(fixtureRoot, 'double-failure-current')
  const doubleIncoming = path.join(fixtureRoot, 'double-failure-incoming')
  createRelease(doubleCurrent, '14.0.0', '6')
  createRelease(doubleIncoming, '14.1.0', '7', 'top\nbase-one\ndouble\nbottom\n')
  plantPrivateFiles(doubleCurrent)
  initializeUpdateState(doubleCurrent)
  const doublePlan = prepareUpdate(doubleCurrent, doubleIncoming)
  let doubleCalls = 0
  assert.throws(() => applyPreparedUpdate(doubleCurrent, doubleIncoming, doublePlan.planPath, {
    approval: doublePlan.plan.planDigest,
    validate: (target) => {
      doubleCalls += 1
      validateFixture(target)
      if (doubleCalls >= 2) throw new Error(`simulated validator failure ${doubleCalls}`)
    },
    validateRestored: () => { throw new Error('simulated restored-tree validator failure') },
  }), (error) => error.recoveryRequired === true && /tool\/system\/update\.mjs" recover --root/.test(error.message))
  const doubleState = stateOf(doubleCurrent)
  assert.equal(doubleState.activeTransactionId, doublePlan.plan.transactionId)
  assert.ok(fs.existsSync(path.join(doubleCurrent, '.home-base', 'state', 'recovery.json')))
  const doubleReceipt = JSON.parse(fs.readFileSync(path.join(doubleCurrent, '.home-base', 'state', 'transactions', doublePlan.plan.transactionId, 'transaction.json'), 'utf8'))
  assert.equal(doubleReceipt.phase, 'recovery_required')
  assert.throws(() => prepareUpdate(doubleCurrent, doubleIncoming), /must recover/)
  assert.equal(recoverUpdate(doubleCurrent, { validateRestored: validateFixture }).action, 'checkpoint_restored')
  assert.equal(versionOf(doubleCurrent), '14.0.0')
  assert.equal(stateOf(doubleCurrent).activeTransactionId, null)
  assert.equal(stateOf(doubleCurrent).lastSuccessfulTransactionId, null)
  assert.equal(fs.existsSync(path.join(doubleCurrent, '.home-base', 'state', 'recovery.json')), false)
  assertNoPrivateCopies(doubleCurrent, 'after double-failure recover')
  applyFixture(doubleCurrent, doubleIncoming)
  assert.equal(versionOf(doubleCurrent), '14.1.0')
  pass('a failure inside the failure handler leaves one recoverable state, and recover restores the verified checkpoint')

  const stackA = path.join(fixtureRoot, 'stack-current')
  const stackB = path.join(fixtureRoot, 'stack-b')
  const stackC = path.join(fixtureRoot, 'stack-c')
  createRelease(stackA, '15.0.0', '8')
  createRelease(stackB, '15.1.0', '9', 'top\nbase-one\nstack-b\nbottom\n')
  createRelease(stackC, '15.2.0', 'a', 'top\nbase-one\nstack-c\nbottom\n')
  initializeUpdateState(stackA)
  const tx1 = applyFixture(stackA, stackB)
  const tx2 = applyFixture(stackA, stackC)
  assert.deepEqual(stateOf(stackA).rollbackStack, [tx1])
  assert.throws(() => rollbackCommittedUpdate(stackA, tx1, tx1, { validateRestored: validateFixture }), /exact latest committed transaction/)
  rollbackCommittedUpdate(stackA, tx2, tx2, { validateRestored: validateFixture })
  assert.equal(versionOf(stackA), '15.1.0')
  assert.equal(stateOf(stackA).lastSuccessfulTransactionId, tx1)
  assert.deepEqual(stateOf(stackA).rollbackStack, [])
  rollbackCommittedUpdate(stackA, tx1, tx1, { validateRestored: validateFixture })
  assert.equal(versionOf(stackA), '15.0.0')
  assert.equal(stateOf(stackA).lastSuccessfulTransactionId, null)
  const tx3 = applyFixture(stackA, stackB)
  const tx4 = applyFixture(stackA, stackC)
  const statePath = path.join(stackA, '.home-base', 'state', 'update-state.json')
  const goodState = fs.readFileSync(statePath, 'utf8')
  const staleState = JSON.parse(goodState)
  staleState.lastSuccessfulTransactionId = tx3
  staleState.rollbackStack = []
  fs.writeFileSync(statePath, `${JSON.stringify(staleState, null, 2)}\n`)
  assert.throws(() => rollbackCommittedUpdate(stackA, tx3, tx3, { validateRestored: validateFixture }), /did not install the current release/)
  assert.equal(versionOf(stackA), '15.2.0')
  assert.equal(stateOf(stackA).activeTransactionId, null)
  fs.writeFileSync(statePath, goodState)
  assert.throws(() => rollbackCommittedUpdate(stackA, tx4, tx4, {
    validateRestored: validateFixture,
    fault: crashAt('rollback_restored'),
  }), /simulated abrupt termination/)
  recoverUpdate(stackA, { validateRestored: validateFixture })
  assert.equal(versionOf(stackA), '15.1.0')
  assert.equal(stateOf(stackA).lastSuccessfulTransactionId, tx3)
  assert.deepEqual(stateOf(stackA).rollbackStack, [])
  pass('rollback is a stack, an interrupted rollback recovers onto the previous entry, and a transaction that did not install the current release is refused')

  const refuseCurrent = path.join(fixtureRoot, 'refuse-instance-current')
  createRelease(refuseCurrent, '16.0.0', 'b')
  initializeUpdateState(refuseCurrent)
  const withInstance = path.join(fixtureRoot, 'refuse-instance-incoming')
  createRelease(withInstance, '16.1.0', 'c')
  write(withInstance, 'instance/leaked.md', 'must never ship\n')
  assert.throws(() => previewUpdate(refuseCurrent, withInstance), /may not contain an instance/)
  const claimsInstance = path.join(fixtureRoot, 'refuse-claim-incoming')
  createRelease(claimsInstance, '16.2.0', 'd')
  const claimManifest = manifest('16.2.0')
  claimManifest.maintainedPaths.push('instance')
  write(claimsInstance, 'system/release-manifest.json', `${JSON.stringify(claimManifest, null, 2)}\n`)
  assert.throws(() => previewUpdate(refuseCurrent, claimsInstance), /may not claim the instance zone/)
  const otherInstance = path.join(fixtureRoot, 'refuse-other-instance-incoming')
  createRelease(otherInstance, '16.3.0', 'e')
  const otherManifest = manifest('16.3.0')
  otherManifest.instancePaths = ['private']
  write(otherInstance, 'system/release-manifest.json', `${JSON.stringify(otherManifest, null, 2)}\n`)
  assert.throws(() => previewUpdate(refuseCurrent, otherInstance), /only supported instance path/)
  const legacy = path.join(fixtureRoot, 'refuse-legacy-incoming')
  createRelease(legacy, '16.4.0', 'f')
  const legacyManifest = manifest('16.4.0')
  delete legacyManifest.instancePaths
  write(legacy, 'system/release-manifest.json', `${JSON.stringify(legacyManifest, null, 2)}\n`)
  assert.equal(previewUpdate(refuseCurrent, legacy).candidateRelease.version, '16.4.0')
  pass('candidates containing instance/ or claiming the instance zone are refused; manifests without instancePaths (1.0.x) still load')

  // M1: manifest tricks that resolve onto instance/ or a user-owned root, on a
  // case-insensitive or case-sensitive disk, are refused before any mutation.
  const trickCurrent = path.join(fixtureRoot, 'trick-current')
  createRelease(trickCurrent, '17.0.0', '1')
  plantPrivateFiles(trickCurrent)
  write(trickCurrent, 'memory/MEMORY.md', `${USER_MARKER}\n`)
  initializeUpdateState(trickCurrent)
  const trickInstance = treeDigest(path.join(trickCurrent, 'instance'))
  const trickMemory = fs.readFileSync(path.join(trickCurrent, 'memory', 'MEMORY.md'), 'utf8')
  const tricks = ['x/../instance', 'Instance', 'INSTANCE', 'Memory', './you', 'system/../memory', '.home-base', '.Git', 'a\\b', '/abs', 'managed/', 'Instance']
  tricks.forEach((trick, index) => {
    const trickIncoming = path.join(fixtureRoot, `trick-incoming-${index}`)
    createRelease(trickIncoming, '17.1.0', '2')
    const trickManifest = manifest('17.1.0')
    trickManifest.maintainedPaths.push(trick)
    if (trick === './you') trickManifest.userOwnedPaths.push('you')
    write(trickIncoming, 'system/release-manifest.json', `${JSON.stringify(trickManifest, null, 2)}\n`)
    assert.throws(() => previewUpdate(trickCurrent, trickIncoming), /Unsafe update path|overlap|instance zone|reserved folder|single top-level/, `manifest trick ${JSON.stringify(trick)} must be refused`)
  })
  assert.throws(() => updateInternals.portable('x/../instance'), /Unsafe update path/)
  assert.throws(() => updateInternals.portable('./you'), /Unsafe update path/)
  // Defense in depth: a tampered checkpoint that names a case variant of a
  // protected folder is refused at the rename/delete site itself.
  const guardIncoming = path.join(fixtureRoot, 'trick-guard-incoming')
  createRelease(guardIncoming, '17.2.0', '3', 'top\nbase-one\nguard\nbottom\n')
  const guardTx = applyFixture(trickCurrent, guardIncoming)
  const guardCheckpointPath = path.join(trickCurrent, '.home-base', 'state', 'transactions', guardTx, 'checkpoint', 'checkpoint.json')
  const guardCheckpoint = fs.readFileSync(guardCheckpointPath, 'utf8')
  for (const alias of ['Instance', 'Memory', 'x/../instance']) {
    const tampered = JSON.parse(guardCheckpoint)
    tampered.maintainedPaths.push(alias)
    fs.writeFileSync(guardCheckpointPath, `${JSON.stringify(tampered, null, 2)}\n`)
    assert.throws(() => rollbackCommittedUpdate(trickCurrent, guardTx, guardTx, { validateRestored: validateFixture }), /protected folder|Unsafe update path/)
    assert.equal(treeDigest(path.join(trickCurrent, 'instance')), trickInstance)
    assert.equal(fs.readFileSync(path.join(trickCurrent, 'memory', 'MEMORY.md'), 'utf8'), trickMemory)
    assert.equal(stateOf(trickCurrent).activeTransactionId, null, 'the refusal happens before rollback starts')
  }
  fs.writeFileSync(guardCheckpointPath, guardCheckpoint)
  rollbackCommittedUpdate(trickCurrent, guardTx, guardTx, { validateRestored: validateFixture })
  assert.equal(treeDigest(path.join(trickCurrent, 'instance')), trickInstance)
  pass('manifest paths with ./.. segments, case or Unicode variants of instance/ or user-owned roots, reserved folders, backslashes, and absolute paths are refused; a tampered checkpoint cannot rename or delete them')

  // M2: an I/O failure while restoring, and a kill between the two renames of
  // system/, both leave a runnable recovery command that works without the
  // live system/ folder or its manifest.
  const stub = 'process.exit(0)\n'
  const createRunnableRelease = (root, version, commit, text) => {
    createRelease(root, version, commit, text)
    write(root, 'system/validate.mjs', stub)
    write(root, 'system/prove.mjs', stub)
  }
  const runCommand = (command) => spawnSync('sh', ['-c', command], { encoding: 'utf8' })
  const ioCurrent = path.join(fixtureRoot, 'restore-io-current')
  const ioIncoming = path.join(fixtureRoot, 'restore-io-incoming')
  createRunnableRelease(ioCurrent, '18.0.0', '4')
  createRunnableRelease(ioIncoming, '18.1.0', '5', 'top\nbase-one\nio\nbottom\n')
  plantPrivateFiles(ioCurrent)
  const ioInstance = treeDigest(path.join(ioCurrent, 'instance'))
  initializeUpdateState(ioCurrent)
  const ioPlan = prepareUpdate(ioCurrent, ioIncoming)
  let ioCalls = 0
  let ioError
  try {
    applyPreparedUpdate(ioCurrent, ioIncoming, ioPlan.planPath, {
      approval: ioPlan.plan.planDigest,
      validate: (target) => {
        ioCalls += 1
        validateFixture(target)
        if (ioCalls === 2) throw new Error('simulated post-swap validator failure')
      },
      fault: (phase) => {
        if (phase === 'restore_copy:system') {
          const error = new Error('ENOSPC: simulated disk full while restoring system')
          error.code = 'ENOSPC'
          throw error
        }
      },
    })
  } catch (error) {
    ioError = error
  }
  assert.equal(ioError?.recoveryRequired, true, ioError?.message)
  assert.match(ioError.message, /tool\/system\/update\.mjs" recover --root/)
  assert.ok(fs.existsSync(path.join(ioCurrent, 'system', 'release-manifest.json')), 'a failed restore copy never leaves system/ missing')
  const toolUpdate = path.join(ioCurrent, '.home-base', 'state', 'transactions', ioPlan.plan.transactionId, 'tool', 'system', 'update.mjs')
  assert.ok(fs.existsSync(toolUpdate))
  assert.equal(JSON.parse(fs.readFileSync(path.join(ioCurrent, '.home-base', 'state', 'recovery.json'), 'utf8')).recoverCommand, ioError.recoverCommand)
  // Break the live manifest too: recovery must work from the checkpoint's own list.
  fs.writeFileSync(path.join(ioCurrent, 'system', 'release-manifest.json'), '{ broken')
  const ioRecover = runCommand(ioError.recoverCommand)
  assert.equal(ioRecover.status, 0, `${ioRecover.stdout}${ioRecover.stderr}`)
  assert.equal(versionOf(ioCurrent), '18.0.0')
  assert.equal(stateOf(ioCurrent).activeTransactionId, null)
  assert.equal(treeDigest(path.join(ioCurrent, 'instance')), ioInstance)
  assertNoPrivateCopies(ioCurrent, 'after tool-copy recover')

  const killCurrent = path.join(fixtureRoot, 'mid-swap-current')
  const killIncoming = path.join(fixtureRoot, 'mid-swap-incoming')
  createRunnableRelease(killCurrent, '18.2.0', '6')
  createRunnableRelease(killIncoming, '18.3.0', '7', 'top\nbase-one\nkill\nbottom\n')
  plantPrivateFiles(killCurrent)
  const killInstance = treeDigest(path.join(killCurrent, 'instance'))
  initializeUpdateState(killCurrent)
  const killPlan = prepareUpdate(killCurrent, killIncoming)
  assert.throws(() => applyPreparedUpdate(killCurrent, killIncoming, killPlan.planPath, {
    approval: killPlan.plan.planDigest,
    validate: validateFixture,
    fault: crashAt('mid_swap:system'),
  }), /simulated abrupt termination/)
  assert.equal(fs.existsSync(path.join(killCurrent, 'system')), false, 'the kill lands between the two renames of system/')
  const killMarker = JSON.parse(fs.readFileSync(path.join(killCurrent, '.home-base', 'state', 'recovery.json'), 'utf8'))
  const killRecover = runCommand(killMarker.recoverCommand)
  assert.equal(killRecover.status, 0, `${killRecover.stdout}${killRecover.stderr}`)
  assert.equal(versionOf(killCurrent), '18.2.0')
  assert.equal(treeDigest(path.join(killCurrent, 'instance')), killInstance)
  applyFixture(killCurrent, killIncoming)
  assert.equal(versionOf(killCurrent), '18.3.0')
  pass('a restore-copy I/O failure keeps system/ in place, and both it and a kill between the renames of system/ recover with the updater copy kept with the transaction, even with a broken live manifest')

  // M8: a restore is confirmed by the checkpoint's recorded hashes. The
  // candidate validator never runs on a restored tree, and a restored tree that
  // differs from the checkpoint is never reported as restored.
  const hashCurrent = path.join(fixtureRoot, 'restore-hash-current')
  const hashIncoming = path.join(fixtureRoot, 'restore-hash-incoming')
  createRelease(hashCurrent, '21.0.0', 'c')
  createRelease(hashIncoming, '21.1.0', 'd', 'top\nbase-one\nhash\nbottom\n')
  plantPrivateFiles(hashCurrent)
  initializeUpdateState(hashCurrent)
  const hashPlan = prepareUpdate(hashCurrent, hashIncoming)
  const candidateChecks = []
  const restoredChecks = []
  let hashError
  try {
    applyPreparedUpdate(hashCurrent, hashIncoming, hashPlan.planPath, {
      approval: hashPlan.plan.planDigest,
      validate: (target) => {
        candidateChecks.push(target)
        validateFixture(target)
        if (candidateChecks.length === 2) throw new Error('simulated post-swap validator failure')
      },
      validateRestored: (target) => restoredChecks.push(target),
      fault: (phase) => {
        if (phase === 'restored') write(hashCurrent, 'managed/left-behind.md', 'not in the checkpoint\n')
      },
    })
  } catch (error) {
    hashError = error
  }
  assert.equal(hashError?.recoveryRequired, true, hashError?.message)
  assert.match(hashError.message, /do not match the checkpoint: managed\/left-behind\.md/)
  assert.equal(candidateChecks.length, 2, 'the candidate validator runs on the staged and swapped trees only')
  assert.deepEqual(restoredChecks, [], 'an unconfirmed restore is never handed to the restored-tree validator')
  assert.equal(recoverUpdate(hashCurrent, { validateRestored: (target) => restoredChecks.push(target) }).action, 'checkpoint_restored')
  assert.deepEqual(restoredChecks, [hashCurrent])
  assert.equal(fs.existsSync(path.join(hashCurrent, 'managed', 'left-behind.md')), false)
  assert.equal(versionOf(hashCurrent), '21.0.0')
  pass('a restore is confirmed by checkpoint hashes (a leftover file blocks it until recover restores again), and the candidate proof never runs on a restored tree')

  // M8: an install stuck by a 1.0.x updater. Its apply failed after the swap,
  // its restore copy finished, and then the restored tree's own 1.0.x proof
  // refused the personalized install, so the transaction stayed active and
  // 1.0.x recover repeated the same refusal. Simulated here in the exact shape
  // 1.0.x leaves: checkpoint without protectedPaths, transaction phase
  // rolling_back, recovery.json phase committing without a tool copy, plus the
  // whole-tree staging copy and journal-old.
  const makeLegacyStuck = (name, commit) => {
    const stuck = path.join(fixtureRoot, `${name}-current`)
    const incoming = path.join(fixtureRoot, `${name}-incoming`)
    createRelease(stuck, '22.0.0', commit)
    createRelease(incoming, '22.1.0', commit === 'e' ? 'f' : 'e', 'top\nincoming-one\nbase-two\nbottom\n')
    write(incoming, 'managed/added-by-candidate.md', 'candidate only\n')
    plantPrivateFiles(stuck)
    write(stuck, 'memory/MEMORY.md', `my memory ${USER_MARKER}\n`)
    initializeUpdateState(stuck)
    write(stuck, 'managed/skill.md', 'top\nbase-one\nlocal edit before the update\nbottom\n')
    const plan = prepareUpdate(stuck, incoming)
    let calls = 0
    assert.throws(() => applyPreparedUpdate(stuck, incoming, plan.planPath, {
      approval: plan.plan.planDigest,
      validate: (target) => {
        calls += 1
        if (calls === 2) throw new Error('simulated post-swap failure')
      },
      validateRestored: () => { throw new Error('Candidate contains personalized files outside the starter manifest') },
    }), (error) => error.recoveryRequired === true)
    const stateRoot = path.join(stuck, '.home-base', 'state')
    const txRoot = path.join(stateRoot, 'transactions', plan.plan.transactionId)
    const checkpointPath = path.join(txRoot, 'checkpoint', 'checkpoint.json')
    const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'))
    delete checkpoint.protectedPaths
    fs.writeFileSync(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`)
    const receiptPath = path.join(txRoot, 'transaction.json')
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'))
    fs.writeFileSync(receiptPath, `${JSON.stringify({ ...receipt, phase: 'rolling_back', error: 'prove.mjs failed', recoverCommand: undefined, restoreError: undefined }, null, 2)}\n`)
    fs.writeFileSync(path.join(stateRoot, 'recovery.json'), `${JSON.stringify({ schemaVersion: 1, transactionId: plan.plan.transactionId, planDigest: plan.plan.planDigest, checkpointDigest: checkpoint.digest, phase: 'committing' }, null, 2)}\n`)
    fs.rmSync(path.join(txRoot, 'tool'), { recursive: true })
    write(path.join(stateRoot, 'staging', plan.plan.transactionId), 'user/preferences.md', `whole-tree copy ${USER_MARKER}\n`)
    write(path.join(stateRoot, 'staging', plan.plan.transactionId), 'managed/skill.md', 'staged candidate\n')
    write(path.join(txRoot, 'journal-old'), 'managed/skill.md', 'replaced root kept by 1.0.x\n')
    assert.equal(stateOf(stuck).activeTransactionId, plan.plan.transactionId)
    return { stuck, incoming, transactionId: plan.plan.transactionId }
  }

  const refused = makeLegacyStuck('legacy-refuse', 'e')
  fs.appendFileSync(path.join(refused.stuck, 'managed', 'skill.md'), 'hand edit after the failed update\n')
  const refusedBefore = treeDigest(refused.stuck)
  assert.throws(() => recoverUpdate(refused.stuck, { validateRestored: () => { throw new Error('the restored tree must not be validated by the legacy repair') } }),
    /Recovery refused: .*managed\/skill\.md.*Nothing was changed/)
  assert.equal(treeDigest(refused.stuck), refusedBefore, 'a refused repair changes nothing, not even hidden updater state')
  assert.equal(stateOf(refused.stuck).activeTransactionId, refused.transactionId)
  write(refused.stuck, 'managed/added-by-candidate.md', 'candidate only\n')
  fs.writeFileSync(path.join(refused.stuck, 'managed', 'skill.md'), 'top\nbase-one\nlocal edit before the update\nbottom\n')
  const leftoverBefore = treeDigest(refused.stuck)
  assert.throws(() => recoverUpdate(refused.stuck, {}), /Recovery refused: .*managed\/added-by-candidate\.md/)
  assert.equal(treeDigest(refused.stuck), leftoverBefore)

  const stuckLegacy = makeLegacyStuck('legacy-repair', 'a')
  const legacyInstance = treeDigest(path.join(stuckLegacy.stuck, 'instance'))
  const legacyUser = treeDigest(path.join(stuckLegacy.stuck, 'user'))
  const legacyMemory = treeDigest(path.join(stuckLegacy.stuck, 'memory'))
  const legacyMaintained = treeDigest(path.join(stuckLegacy.stuck, 'managed'))
  const skillInode = fs.statSync(path.join(stuckLegacy.stuck, 'managed', 'skill.md')).ino
  const repaired = recoverUpdate(stuckLegacy.stuck, { validateRestored: () => { throw new Error('the restored tree must not be validated by the legacy repair') } })
  assert.deepEqual(repaired, { recovered: true, action: 'legacy_restore_verified' })
  assert.equal(stateOf(stuckLegacy.stuck).activeTransactionId, null)
  assert.equal(stateOf(stuckLegacy.stuck).currentRelease.version, '22.0.0')
  assert.equal(fs.existsSync(path.join(stuckLegacy.stuck, '.home-base', 'state', 'recovery.json')), false)
  assert.equal(fs.statSync(path.join(stuckLegacy.stuck, 'managed', 'skill.md')).ino, skillInode, 'nothing was restored or rewritten')
  assert.equal(treeDigest(path.join(stuckLegacy.stuck, 'managed')), legacyMaintained)
  assert.equal(treeDigest(path.join(stuckLegacy.stuck, 'instance')), legacyInstance)
  assert.equal(treeDigest(path.join(stuckLegacy.stuck, 'user')), legacyUser)
  assert.equal(treeDigest(path.join(stuckLegacy.stuck, 'memory')), legacyMemory, 'no user-owned file is written, not even update history')
  assertNoPrivateCopies(stuckLegacy.stuck, 'after legacy repair')
  assert.equal(recoverUpdate(stuckLegacy.stuck, {}).reason, 'no_active_transaction')
  applyFixture(stuckLegacy.stuck, stuckLegacy.incoming)
  assert.equal(versionOf(stuckLegacy.stuck), '22.1.0')
  assert.equal(fs.readFileSync(path.join(stuckLegacy.stuck, 'managed', 'skill.md'), 'utf8'), 'top\nincoming-one\nlocal edit before the update\nbottom\n')
  pass('an install stuck by a 1.0.x updater is repaired by recover only when every maintained file matches the checkpoint or base, without restoring or touching user-owned or instance files; a hand-edited or leftover file is refused with nothing changed')

  // A 1.0.x restore that was itself cut off: 1.0.x deletes every maintained
  // root first, then copies them back one by one, so a kill leaves whole roots
  // (system/ included) or some of their files missing. The repair puts back
  // only the maintained roots from the verified checkpoint, confirms every
  // hash, and clears the update; user-owned and instance files are untouched.
  const cut = makeLegacyStuck('legacy-cut', 'b')
  const cutInstance = treeDigest(path.join(cut.stuck, 'instance'))
  const cutUser = treeDigest(path.join(cut.stuck, 'user'))
  const cutMemory = treeDigest(path.join(cut.stuck, 'memory'))
  const cutManaged = treeDigest(path.join(cut.stuck, 'managed'))
  const cutSystem = treeDigest(path.join(cut.stuck, 'system'))
  fs.rmSync(path.join(cut.stuck, 'system'), { recursive: true })
  fs.rmSync(path.join(cut.stuck, 'managed', 'skill.md'))
  const cutRepaired = recoverUpdate(cut.stuck, { validateRestored: () => { throw new Error('the legacy repair is confirmed by hashes, not a validator') } })
  assert.deepEqual(cutRepaired, { recovered: true, action: 'legacy_checkpoint_restored' })
  assert.equal(treeDigest(path.join(cut.stuck, 'system')), cutSystem, 'system/ is back exactly as saved')
  assert.equal(treeDigest(path.join(cut.stuck, 'managed')), cutManaged, 'managed/ is back exactly as saved')
  assert.equal(stateOf(cut.stuck).activeTransactionId, null)
  assert.equal(fs.existsSync(path.join(cut.stuck, '.home-base', 'state', 'recovery.json')), false)
  assert.equal(treeDigest(path.join(cut.stuck, 'instance')), cutInstance)
  assert.equal(treeDigest(path.join(cut.stuck, 'user')), cutUser)
  assert.equal(treeDigest(path.join(cut.stuck, 'memory')), cutMemory)
  assertNoPrivateCopies(cut.stuck, 'after repairing a cut-off legacy restore')
  applyFixture(cut.stuck, cut.incoming)
  assert.equal(versionOf(cut.stuck), '22.1.0')

  // A saved copy that is damaged cannot be put back: a plain refusal, nothing changed.
  const damaged = makeLegacyStuck('legacy-damaged', 'c')
  fs.rmSync(path.join(damaged.stuck, 'system'), { recursive: true })
  const damagedCheckpointFile = path.join(damaged.stuck, '.home-base', 'state', 'transactions', damaged.transactionId, 'checkpoint', 'tree', 'managed', 'skill.md')
  fs.chmodSync(damagedCheckpointFile, 0o600)
  fs.writeFileSync(damagedCheckpointFile, 'tampered\n')
  const damagedBefore = treeDigest(damaged.stuck)
  assert.throws(() => recoverUpdate(damaged.stuck, {}), /^Error: Recovery refused: the copy of your Home Base files saved before the update is missing or damaged, so it cannot be checked or put back\. Nothing was changed\.$/)
  assert.equal(treeDigest(damaged.stuck), damagedBefore, 'nothing was changed')
  pass('a 1.0.x restore cut off with system/ and maintained files missing is finished from the verified checkpoint (maintained roots only, every hash confirmed); a damaged checkpoint is refused plainly with nothing changed')

  // init takes the update lock, so it cannot sweep staging under a live apply.
  const initLockCurrent = path.join(fixtureRoot, 'init-lock-current')
  createRelease(initLockCurrent, '19.0.0', '8')
  initializeUpdateState(initLockCurrent)
  const initLock = path.join(initLockCurrent, '.home-base', 'state', 'update.lock')
  write(initLock, 'owner.json', `${JSON.stringify({ pid: process.pid })}\n`)
  assert.throws(() => initializeUpdateState(initLockCurrent), /owns the lock/)
  fs.rmSync(path.join(initLock, 'owner.json'))
  assert.throws(() => initializeUpdateState(initLockCurrent), /acquiring the lock/)
  fs.rmSync(initLock, { recursive: true })
  pass('init takes the update lock, and a just-created lock without an owner record is not stolen')

  const credentialCurrent = path.join(fixtureRoot, 'credential-url-current')
  createRelease(credentialCurrent, '20.0.0', '9')
  fs.rmSync(path.join(credentialCurrent, 'system', 'distribution'), { recursive: true })
  const userinfo = ['https://', 'fixture-user', ':', 'not-a-real-secret', '@', 'example.test/home-base'].join('')
  assert.throws(() => initializeUpdateState(credentialCurrent, { sourceCommit: 'a'.repeat(40), sourceRef: 'main', sourceRepository: userinfo }), /may not contain a user name/)
  assert.equal(fs.existsSync(path.join(credentialCurrent, '.home-base', 'state', 'update-state.json')), false)
  initializeUpdateState(credentialCurrent, { sourceCommit: 'a'.repeat(40), sourceRef: 'main', sourceRepository: 'https://example.test/home-base' })
  pass('a source repository URL with a user name, password, or token is refused before anything is recorded')

  // Assistants capture command output through a pipe. A preview far larger
  // than the pipe buffer (64 KB on Node 20, 128 KB on Node 22) must reach a
  // slow reader whole, so the updater never exits before stdout is flushed.
  const largeCurrent = path.join(fixtureRoot, 'large-preview-current')
  const largeIncoming = path.join(fixtureRoot, 'large-preview-incoming')
  createRelease(largeCurrent, '23.0.0', 'e')
  createRelease(largeIncoming, '23.1.0', 'f')
  for (let index = 0; index < 1500; index += 1) {
    write(largeIncoming, `managed/large-preview/${String(index).padStart(4, '0')}-${'long-file-name-'.repeat(4)}.md`, `incoming ${index}\n`)
  }
  initializeUpdateState(largeCurrent)
  const updateScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'update.mjs')
  const piped = spawnSync('sh', ['-c', '"$0" "$1" preview --root "$2" --candidate "$3" | (sleep 1; cat)', process.execPath, updateScript, largeCurrent, largeIncoming], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  assert.equal(piped.status, 0, piped.stderr)
  assert.ok(Buffer.byteLength(piped.stdout) > 200 * 1024, `preview should be larger than 200 KB, got ${Buffer.byteLength(piped.stdout)} bytes`)
  const largePreview = JSON.parse(piped.stdout)
  assert.equal(largePreview.candidateRelease.version, '23.1.0')
  assert.ok(JSON.stringify(largePreview).includes('1499-long-file-name-'), 'the last planned file reaches the reader')
  pass(`a ${Math.round(Buffer.byteLength(piped.stdout) / 1024)} KB preview piped to a slow reader arrives complete and parses as JSON`)

  // The user's own folders may hold anything: a screenshot, a note with a
  // broken link, text that looks like a key. This release's real validator
  // reports those as notes, so an update, a rollback, and a recovery all
  // complete with them in place (they once stuck rollback in
  // recovery_required). Only --release, for a pristine release tree, fails.
  const homeBase = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const releaseManifest = loadReleaseManifest(homeBase)
  const realCurrent = path.join(fixtureRoot, 'real-current')
  const realIncoming = path.join(fixtureRoot, 'real-incoming')
  copyReleaseShapedTree(homeBase, realCurrent, releaseManifest)
  copyReleaseShapedTree(homeBase, realIncoming, releaseManifest)
  const currentVersion = releaseManifest.version
  const nextVersion = /-dev\.\d+$/.test(currentVersion)
    ? currentVersion.replace(/dev\.(\d+)$/, (_, number) => `dev.${Number(number) + 1}`)
    : currentVersion.replace(/^(\d+)\.(\d+)\.(\d+)$/, (_, major, minor, patch) => `${major}.${minor}.${Number(patch) + 1}-dev.1`)
  for (const file of ['VERSION.md', 'PROVENANCE.json', 'system/release-manifest.json']) {
    const target = path.join(realIncoming, file)
    let text = fs.readFileSync(target, 'utf8').replaceAll(currentVersion, nextVersion)
    if (file === 'VERSION.md') text = text.replace(/^- Status: public stable release$/m, '- Status: pre-release')
    fs.writeFileSync(target, text)
  }
  fs.appendFileSync(path.join(realIncoming, 'system', 'README.md'), '\n<!-- fixture: next pre-release -->\n')
  for (const [root, commit] of [[realCurrent, '1'], [realIncoming, '2']]) {
    write(root, 'system/distribution/release.json', `${JSON.stringify({ schemaVersion: 1, source: { repository: 'https://example.test/home-base', ref: 'fixture', commit: commit.repeat(40) } }, null, 2)}\n`)
  }
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
  write(realCurrent, 'projects/screenshot.png', png)
  write(realCurrent, 'knowledge/reading-notes.md', '# Reading notes (fictional)\n\nSee [the chapter summary](./chapter-summary.md), not written yet.\n')
  // Fake and assembled at runtime, so this file itself holds no such shape.
  write(realCurrent, 'memory/pasted-by-mistake.md', `${['Fixture', 'Only', '-', 'Not', 'A', 'Key', '-', '2026', '!'].join('')}\n`)
  // Outside every manifest folder: a stray screenshot at the top of the folder.
  write(realCurrent, 'screenshot.png', png)
  const runValidator = (target, extra = []) => spawnSync(process.execPath, [path.join(target, 'system', 'validate.mjs'), ...extra], { cwd: target, encoding: 'utf8' })
  const realValidate = (target) => {
    const result = runValidator(target)
    if (result.status !== 0) throw new Error(`validate.mjs failed:\n${result.stdout}${result.stderr}`)
  }
  const lenient = runValidator(realCurrent)
  assert.equal(lenient.status, 0, `${lenient.stdout}${lenient.stderr}`)
  for (const expected of ['projects/screenshot.png is a media file', 'knowledge/reading-notes.md has a broken local link', 'memory/pasted-by-mistake.md contains text shaped like', '\n- screenshot.png is a media file']) {
    assert.ok(lenient.stdout.includes(expected), `validator notes ${expected}\n${lenient.stdout}`)
  }
  assert.equal(runValidator(realCurrent, ['--release']).status, 1, '--release still fails on the same files')
  // Everything outside the maintained release roots and Home Base's own
  // state, except the update history the updater appends to. Links are
  // hashed as links, never followed.
  const maintainedFolded = new Set(releaseManifest.maintainedPaths.map((name) => name.toLowerCase()))
  const userDigest = (root) => {
    const hash = crypto.createHash('sha256')
    const visit = (relativePath) => {
      if (relativePath === 'memory/UPDATE-HISTORY.md') return
      const absolute = path.join(root, relativePath)
      const stat = fs.lstatSync(absolute)
      if (stat.isSymbolicLink()) hash.update(`L:${relativePath}->${fs.readlinkSync(absolute)}\n`)
      else if (stat.isFile()) hash.update(`F:${relativePath}:${crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex')}\n`)
      else for (const entry of fs.readdirSync(absolute).sort()) visit(`${relativePath}/${entry}`)
    }
    for (const entry of fs.readdirSync(root).sort()) {
      if (!maintainedFolded.has(entry.toLowerCase()) && entry !== '.home-base') visit(entry)
    }
    return hash.digest('hex')
  }

  // Update with the stray root screenshot in place (it once failed after the swap).
  let realUserBefore = userDigest(realCurrent)
  initializeUpdateState(realCurrent)
  const realTx = applyFixture(realCurrent, realIncoming, { validate: realValidate, validateRestored: realValidate })
  assert.equal(versionOf(realCurrent), nextVersion)
  assert.equal(userDigest(realCurrent), realUserBefore)

  // Before the rollback the user adds an editor folder with a source map, a
  // new folder with a broken link, links to a folder and to a file, a file
  // over 2 MB, and a small PDF whose digits look like a card number. None of
  // them may stop the rollback, crash the validator, or be followed.
  write(realCurrent, '.obsidian/plugins/x/main.js', `x()\n//# ${'sourceMapping'}URL=main.js.map\n`)
  write(realCurrent, 'Notes/a.md', '# A note (fictional)\n\nSee [gone](./gone.md).\n')
  fs.symlinkSync(path.join(fixtureRoot, 'large-preview-current'), path.join(realCurrent, 'projects', 'folder-link'))
  fs.symlinkSync('../README.md', path.join(realCurrent, 'Notes', 'readme-link.md'))
  write(realCurrent, 'projects/big.txt', Buffer.alloc(3 * 1024 * 1024, 'a'))
  write(realCurrent, 'projects/report.pdf', `%PDF-1.4\n${['4111', '1111', '1111', '1111'].join(' ')}\n%%EOF\n`)
  const noted = runValidator(realCurrent)
  assert.equal(noted.status, 0, `${noted.stdout}${noted.stderr}`)
  for (const expected of [
    '.obsidian/plugins/x/main.js is or references a source map',
    'Notes/a.md has a broken local link',
    'projects/folder-link is a symbolic link; Home Base never follows or reads it',
    'Notes/readme-link.md is a symbolic link',
    'projects/big.txt is larger than 2 MB',
    'projects/report.pdf is a binary file such as a PDF or an archive',
  ]) assert.ok(noted.stdout.includes(expected), `validator notes ${expected}\n${noted.stdout}`)
  assert.ok(!noted.stdout.includes('report.pdf contains text shaped like'), 'a PDF is not called a password')
  assert.doesNotMatch(noted.stdout + noted.stderr, /EISDIR|at file:/, 'no crash on a link to a folder')
  realUserBefore = userDigest(realCurrent)
  rollbackCommittedUpdate(realCurrent, realTx, realTx, { validateRestored: realValidate })
  assert.equal(versionOf(realCurrent), currentVersion)
  assert.equal(stateOf(realCurrent).activeTransactionId, null)
  assert.equal(userDigest(realCurrent), realUserBefore)

  // A link inside the user-owned folders is refused by the update engine up
  // front (it copies those folders while staging), so it is moved out before
  // the next update; the links outside them stay.
  fs.renameSync(path.join(realCurrent, 'projects', 'folder-link'), path.join(fixtureRoot, 'parked-folder-link'))
  realUserBefore = userDigest(realCurrent)
  // An update cut off between the renames of system/ is recovered with the
  // CLI, whose restore runs the restored tree's real validator.
  const realPlan = prepareUpdate(realCurrent, realIncoming)
  assert.throws(() => applyPreparedUpdate(realCurrent, realIncoming, realPlan.planPath, {
    approval: realPlan.plan.planDigest,
    validate: realValidate,
    fault: crashAt('mid_swap:system'),
  }), /simulated abrupt termination/)
  const realMarker = JSON.parse(fs.readFileSync(path.join(realCurrent, '.home-base', 'state', 'recovery.json'), 'utf8'))
  const realRecover = spawnSync('sh', ['-c', realMarker.recoverCommand], { encoding: 'utf8' })
  assert.equal(realRecover.status, 0, `${realRecover.stdout}${realRecover.stderr}`)
  assert.equal(versionOf(realCurrent), currentVersion)
  assert.equal(stateOf(realCurrent).activeTransactionId, null)
  assert.equal(userDigest(realCurrent), realUserBefore)

  // A link inside the maintained files is still fatal, in plain words.
  fs.symlinkSync('../README.md', path.join(realCurrent, 'system', 'stray-link.md'))
  const strict = runValidator(realCurrent)
  assert.equal(strict.status, 1)
  assert.match(strict.stderr, /Release files may not contain symbolic links, hard links, or special files: system\/stray-link\.md is a symbolic link/)
  assert.doesNotMatch(strict.stderr, /EISDIR|at file:/)
  fs.rmSync(path.join(realCurrent, 'system', 'stray-link.md'))
  // An older Node.js gets a plain message before the update engine loads.
  const olderNode = 'data:text/javascript,Object.defineProperty(process.versions,"node",{value:"18.20.4"})'
  const realStateBefore = fs.readFileSync(path.join(realCurrent, '.home-base', 'state', 'update-state.json'))
  const refusedOld = spawnSync(process.execPath, ['--import', olderNode, updateScript, 'preview', '--root', realCurrent, '--candidate', realIncoming], { encoding: 'utf8' })
  assert.equal(refusedOld.status, 1)
  assert.match(refusedOld.stderr, /needs Node\.js 20 or later; this computer has Node\.js 18\.20\.4\. Install the current LTS version from https:\/\/nodejs\.org/)
  assert.equal(refusedOld.stdout, '')
  assert.doesNotMatch(refusedOld.stderr, /at file:/, 'no stack trace')
  assert.deepEqual(fs.readFileSync(path.join(realCurrent, '.home-base', 'state', 'update-state.json')), realStateBefore)
  pass('on Node.js older than 20 the updater says so plainly, with no stack trace, before loading the engine, and changes nothing')
  pass('with a screenshot at the top of the folder and in projects/, an editor folder with a source map, a new folder with a broken link, links to a folder and a file, a 3 MB file, a PDF, and key-shaped text, the real validator only notes them (never following a link) and update, rollback, and recovery complete with all of them byte-identical; a link inside the maintained files is still fatal, and --release refuses the rest')
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true })
}

console.log(`Safe updater fixtures passed (${checks.length} groups):`)
for (const check of checks) console.log(`- ${check}`)
