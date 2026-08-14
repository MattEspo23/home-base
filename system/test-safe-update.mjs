#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
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
    starterFiles: [],
  }
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
  rollbackCommittedUpdate(current, prepared.plan.transactionId, prepared.plan.transactionId, { validate: validateFixture })
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
  rollbackCommittedUpdate(newRootCurrent, newRootPlan.plan.transactionId, newRootPlan.plan.transactionId, { validate: validateFixture })
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
  recoverUpdate(toctouCurrent, { validate: validateFixture })
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
    const recovered = recoverUpdate(crashCurrent, { validate: validateFixture })
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
  assert.equal(recoverUpdate(swapCurrent, { validate: validateFixture }).action, 'checkpoint_restored')
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
  assert.throws(() => recoverUpdate(checkpointCurrent, { validate: validateFixture }), /checkpoint.*tampered/i)
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
    validate: validateFixture,
    fault: crashAt('rollback_restored'),
  }), /simulated abrupt termination/)
  assert.equal(recoverUpdate(rollbackCurrent, { validate: validateFixture }).action, 'checkpoint_restored')
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
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true })
}

console.log(`Safe updater fixtures passed (${checks.length} groups):`)
for (const check of checks) console.log(`- ${check}`)
