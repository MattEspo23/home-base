#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  canReopenDeclinedIdea,
  compareRuns,
  consumeSuggestion,
  credentialDecision,
  missingActionPreviewFields,
  selectOpportunitySet,
} from './lib/contracts.mjs'
import {
  buildFromFiles,
  buildBrief,
  renderDataScript,
  renderMarkdown,
} from './examples/daily-follow-up-brief/build.mjs'
import {
  applyUpdate,
  loadReleaseManifest,
  planUpdate,
  releaseFiles,
  releaseSourcePath,
  rollbackUpdate,
} from './lib/update-contract.mjs'

const systemDir = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(systemDir, '..')
const checks = []

function pass(message) {
  checks.push(message)
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

const candidates = [
  {
    id: 'fast-win',
    timing: 'now',
    evidenceSource: 'user_statement',
    evidence: 'User repeats a daily review and misses the next follow-up.',
    scores: {
      fit: 5,
      value: 4,
      existingAccess: 5,
      lowEffort: 5,
      lowMaintenance: 4,
      lowRisk: 5,
      clearProof: 5,
    },
  },
  {
    id: 'meaningful-system',
    timing: 'now',
    evidenceSource: 'reviewed_work',
    evidence: 'User wants one queue built from approved email and calendar data.',
    scores: {
      fit: 5,
      value: 5,
      existingAccess: 3,
      lowEffort: 3,
      lowMaintenance: 4,
      lowRisk: 4,
      clearProof: 5,
    },
  },
  {
    id: 'later-system',
    timing: 'later',
    evidenceSource: 'durable_file',
    evidence: 'User may want a private hosted view after the local workflow proves useful.',
    scores: {
      fit: 3,
      value: 4,
      existingAccess: 2,
      lowEffort: 2,
      lowMaintenance: 3,
      lowRisk: 3,
      clearProof: 3,
    },
  },
  {
    id: 'extra-now',
    timing: 'now',
    evidenceSource: 'user_statement',
    evidence: 'User mentioned a lower-priority reporting annoyance.',
    scores: {
      fit: 2,
      value: 2,
      existingAccess: 5,
      lowEffort: 4,
      lowMaintenance: 4,
      lowRisk: 5,
      clearProof: 3,
    },
  },
]

const selected = selectOpportunitySet(candidates)
assert.equal(selected.length, 3)
assert.equal(selected.filter((item) => item.timing === 'now').length, 2)
assert.equal(selected.filter((item) => item.timing === 'later').length, 1)
assert.ok(selected.every((item) => item.evidence.length > 0))
pass('Reference opportunity selector enforces two now plus one saved-later')

const credentialFixture = `${['pass', 'word'].join('')}=${'x'.repeat(16)}`
const credentialResult = credentialDecision(credentialFixture)
assert.equal(credentialResult.refuse, true)
assert.equal(credentialResult.message.includes(credentialFixture), false)
assert.equal(credentialDecision('Sign in directly on the provider page.').refuse, false)
for (const secretLikeFixture of [
  `${['xox', 'b-'].join('')}${'A'.repeat(12)}-${'7'.repeat(12)}`,
  `${['AI', 'za'].join('')}${'A'.repeat(35)}`,
  ['4111', '1111', '1111', '1111'].join(' '),
  ['123', '45', '6789'].join('-'),
  ['My passcode is', 'KeepIt9!'].join(' '),
  ['Recovery codes:', '8fj2-99ka', '2kd8-1ldd'].join(' '),
  ['Solo', 'Token8!'].join(''),
]) {
  const decision = credentialDecision(secretLikeFixture)
  assert.equal(decision.refuse, true)
  assert.equal(decision.message.includes(secretLikeFixture), false)
}
pass('Reference credential detector refuses known secret shapes without echo')

const suggestionOne = consumeSuggestion({ unsolicitedCount: 0 })
const suggestionTwo = consumeSuggestion({ unsolicitedCount: suggestionOne.unsolicitedCount })
assert.equal(suggestionOne.allowed, true)
assert.equal(suggestionTwo.allowed, false)
pass('Reference suggestion budget allows one unsolicited idea per session')

assert.deepEqual(canReopenDeclinedIdea({ tool: 'New verified connector exists' }, false), {
  material: true,
  allowed: false,
})
assert.deepEqual(canReopenDeclinedIdea({ tool: 'New verified connector exists' }, true), {
  material: true,
  allowed: true,
})
assert.deepEqual(canReopenDeclinedIdea({ wording: 'Different phrasing' }, true), {
  material: false,
  allowed: false,
})
pass('Reference decline contract requires material evidence and confirmation')

const preview = {
  system: 'Daily Follow-Up Brief',
  task: 'Build a synthetic local queue',
  accountEnvironment: 'Local reference',
  readDataScope: 'sample-data.json',
  exclusions: 'Real accounts and PII',
  volumeCeiling: 'Three messages and two events',
  thirdParties: 'None',
  outsideChanges: 'None',
  worstCase: 'Incorrect local ordering',
  stopConditions: 'Any real data, send, deploy, or expanded scope',
  undo: 'Discard temporary output and stop local server',
  remainingAccess: 'Local files only',
}
assert.deepEqual(missingActionPreviewFields(preview), [])
assert.deepEqual(missingActionPreviewFields({ ...preview, worstCase: '' }), ['worstCase'])
pass('Reference Build Mode preview check requires the complete bounded-action fields')

const sampleData = JSON.parse(
  read('system/examples/daily-follow-up-brief/sample-data.json'),
)
const firstBrief = buildBrief(sampleData, { summaryStyle: 'detailed' })
const secondBrief = buildBrief(sampleData, { summaryStyle: 'concise' })
assert.equal(firstBrief.queueCount, 2)
assert.deepEqual(firstBrief.queue.map((item) => item.id), ['message-001', 'message-002'])
assert.equal(firstBrief.sendEnabled, false)
assert.ok(firstBrief.queue.every((item) => item.sendStatus === 'blocked_pending_user_approval'))
assert.ok(secondBrief.queue.every((item) => item.draft.startsWith('Quick follow-up')))
assert.ok(
  secondBrief.queue.every(
    (item, index) => item.draft.length < firstBrief.queue[index].draft.length,
  ),
)

const learningProofDir = fs.mkdtempSync(
  path.join(os.tmpdir(), 'home-base-learning-proof-'),
)
try {
  const inputPath = path.join(learningProofDir, 'input.json')
  const preferencesPath = path.join(learningProofDir, 'preferences.json')
  const runtimeOutput = path.join(learningProofDir, 'runtime-output')
  fs.writeFileSync(inputPath, `${JSON.stringify(sampleData, null, 2)}\n`)
  fs.writeFileSync(
    preferencesPath,
    `${JSON.stringify({ summaryStyle: 'detailed' }, null, 2)}\n`,
  )
  const firstRuntimeBrief = buildFromFiles({
    input: inputPath,
    preferences: preferencesPath,
    output: runtimeOutput,
  })
  fs.writeFileSync(
    preferencesPath,
    `${JSON.stringify({ summaryStyle: 'concise' }, null, 2)}\n`,
  )
  const secondRuntimeBrief = buildFromFiles({
    input: inputPath,
    preferences: preferencesPath,
    output: runtimeOutput,
  })
  const comparison = compareRuns(
    { input: sampleData, result: firstRuntimeBrief },
    {
      input: sampleData,
      result: secondRuntimeBrief,
      userRestatedCorrection: false,
    },
  )
  assert.equal(comparison.proven, true)
  assert.equal(secondRuntimeBrief.summaryStyle, 'concise')
} finally {
  fs.rmSync(learningProofDir, { recursive: true, force: true })
}
pass('Reference runtime reads a durable preference and changes the repeated task')

const proofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'home-base-proof-'))
try {
  fs.writeFileSync(path.join(proofDir, 'BRIEF.md'), renderMarkdown(firstBrief))
  fs.writeFileSync(
    path.join(proofDir, 'brief.json'),
    `${JSON.stringify(firstBrief, null, 2)}\n`,
  )
  fs.writeFileSync(path.join(proofDir, 'demo-data.js'), renderDataScript(firstBrief))
  assert.ok(fs.statSync(path.join(proofDir, 'BRIEF.md')).size > 200)
  assert.ok(fs.statSync(path.join(proofDir, 'brief.json')).size > 200)
  assert.ok(fs.statSync(path.join(proofDir, 'demo-data.js')).size > 200)
} finally {
  fs.rmSync(proofDir, { recursive: true, force: true })
}
pass('Reference build creates reviewable artifacts in a disposable directory')

const updateFixtureRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), 'home-base-update-proof-'),
)
try {
  const currentRoot = path.join(updateFixtureRoot, 'current')
  const candidateRoot = path.join(updateFixtureRoot, 'candidate')
  const checkpointRoot = path.join(updateFixtureRoot, 'checkpoint')
  fs.cpSync(root, currentRoot, { recursive: true })
  fs.cpSync(root, candidateRoot, { recursive: true })

  const originalReadme = read('README.md')
  const personalPreference = '# Preferences\n\n- Keep this personal choice.\n'
  fs.writeFileSync(
    path.join(candidateRoot, 'README.md'),
    `${originalReadme}\n<!-- update fixture -->\n`,
  )
  fs.writeFileSync(
    path.join(currentRoot, 'you', 'PREFERENCES.md'),
    personalPreference,
  )
  fs.writeFileSync(
    path.join(candidateRoot, 'you', 'PREFERENCES.md'),
    '# Preferences\n\n- Candidate must not replace this file.\n',
  )

  const updatePlan = planUpdate(currentRoot, candidateRoot)
  assert.ok(
    updatePlan.changes.some(
      (item) => item.file === 'README.md' && item.action === 'update',
    ),
  )
  assert.ok(updatePlan.ignoredUserOwned.includes('you/PREFERENCES.md'))
  applyUpdate(currentRoot, candidateRoot, checkpointRoot)
  assert.ok(
    fs.readFileSync(path.join(currentRoot, 'README.md'), 'utf8').includes(
      'update fixture',
    ),
  )
  assert.equal(
    fs.readFileSync(path.join(currentRoot, 'you', 'PREFERENCES.md'), 'utf8'),
    personalPreference,
  )
  rollbackUpdate(currentRoot, checkpointRoot)
  assert.equal(
    fs.readFileSync(path.join(currentRoot, 'README.md'), 'utf8'),
    originalReadme,
  )
  assert.equal(
    fs.readFileSync(path.join(currentRoot, 'you', 'PREFERENCES.md'), 'utf8'),
    personalPreference,
  )
  const outsideFixture = path.join(updateFixtureRoot, 'outside.txt')
  fs.writeFileSync(outsideFixture, 'must not enter a release\n')
  fs.symlinkSync(
    outsideFixture,
    path.join(candidateRoot, 'system', 'release-escape.txt'),
  )
  assert.throws(
    () => planUpdate(currentRoot, candidateRoot),
    /Release paths may not be symbolic links/,
  )

  const maliciousRoot = path.join(updateFixtureRoot, 'malicious')
  fs.cpSync(root, maliciousRoot, { recursive: true })
  const maliciousManifestPath = path.join(
    maliciousRoot,
    'system',
    'release-manifest.json',
  )
  const maliciousManifest = JSON.parse(
    fs.readFileSync(maliciousManifestPath, 'utf8'),
  )
  maliciousManifest.maintainedPaths.push('you', 'memory')
  fs.writeFileSync(
    maliciousManifestPath,
    `${JSON.stringify(maliciousManifest, null, 2)}\n`,
  )
  assert.throws(
    () => planUpdate(currentRoot, maliciousRoot),
    /overlap protected user-owned paths/,
  )
  assert.equal(
    fs.readFileSync(path.join(currentRoot, 'you', 'PREFERENCES.md'), 'utf8'),
    personalPreference,
  )

  const deletionRoot = path.join(updateFixtureRoot, 'deletion')
  const deletionCheckpoint = path.join(updateFixtureRoot, 'deletion-checkpoint')
  fs.cpSync(root, deletionRoot, { recursive: true })
  fs.rmSync(path.join(deletionRoot, 'system', 'workflows', 'deepen.md'))
  const deletionPlan = planUpdate(currentRoot, deletionRoot)
  assert.ok(deletionPlan.deletes.includes('system/workflows/deepen.md'))
  assert.throws(
    () => applyUpdate(currentRoot, deletionRoot, deletionCheckpoint),
    /explicit deletion approval/,
  )
  applyUpdate(currentRoot, deletionRoot, deletionCheckpoint, {
    approveDeletes: true,
  })
  assert.equal(
    fs.existsSync(path.join(currentRoot, 'system', 'workflows', 'deepen.md')),
    false,
  )
  rollbackUpdate(currentRoot, deletionCheckpoint)
  assert.equal(
    fs.existsSync(path.join(currentRoot, 'system', 'workflows', 'deepen.md')),
    true,
  )

  const partialFailureRoot = path.join(updateFixtureRoot, 'partial-failure')
  const partialFailureCheckpoint = path.join(
    updateFixtureRoot,
    'partial-failure-checkpoint',
  )
  fs.cpSync(root, partialFailureRoot, { recursive: true })
  fs.writeFileSync(
    path.join(partialFailureRoot, 'README.md'),
    `${originalReadme}\n<!-- partial failure fixture -->\n`,
  )
  fs.mkdirSync(path.join(partialFailureRoot, 'system', 'zz-newdir'))
  fs.writeFileSync(
    path.join(partialFailureRoot, 'system', 'zz-newdir', 'new.md'),
    'new maintained file\n',
  )
  fs.writeFileSync(
    path.join(currentRoot, 'system', 'zz-newdir'),
    'file blocks candidate directory\n',
  )
  assert.throws(
    () =>
      applyUpdate(
        currentRoot,
        partialFailureRoot,
        partialFailureCheckpoint,
        { approveDeletes: true },
      ),
    (error) => error.updateRolledBack === true,
  )
  assert.equal(
    fs.readFileSync(path.join(currentRoot, 'README.md'), 'utf8'),
    originalReadme,
  )
  assert.equal(
    fs.readFileSync(path.join(currentRoot, 'system', 'zz-newdir'), 'utf8'),
    'file blocks candidate directory\n',
  )
} finally {
  fs.rmSync(updateFixtureRoot, { recursive: true, force: true })
}
pass('Reference updater rejects ownership attacks, gates deletes, and rolls back partial copies')

const packagingProofRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), 'home-base-package-proof-'),
)
try {
  const personalizedRoot = path.join(packagingProofRoot, 'personalized')
  const stagedRoot = path.join(packagingProofRoot, 'staged')
  fs.cpSync(root, personalizedRoot, { recursive: true })
  const privateMarker = 'PRIVATE_PERSONALIZED_MARKER'
  fs.writeFileSync(
    path.join(personalizedRoot, 'you', 'ABOUT.md'),
    `${privateMarker}\n`,
  )
  const manifest = loadReleaseManifest(personalizedRoot)
  for (const relativePath of releaseFiles(personalizedRoot, manifest)) {
    const source = releaseSourcePath(
      personalizedRoot,
      manifest,
      relativePath,
    )
    const destination = path.join(stagedRoot, relativePath)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(source, destination)
  }
  assert.equal(
    fs.readFileSync(path.join(stagedRoot, 'you', 'ABOUT.md'), 'utf8').includes(
      privateMarker,
    ),
    false,
  )
} finally {
  fs.rmSync(packagingProofRoot, { recursive: true, force: true })
}
pass('Reference packager replaces personalized starter targets with pristine sources')

for (const requiredUiSignal of [
  'Sends disabled',
  'Synthetic',
  'STOP GATE',
]) {
  assert.ok(
    read('system/examples/daily-follow-up-brief/interface/index.html').includes(
      requiredUiSignal,
    ),
  )
}
assert.ok(
  read('system/examples/daily-follow-up-brief/DEPLOYMENT.md').includes(
    'Production deployment remains stopped',
  ),
)
assert.ok(
  read('system/examples/daily-follow-up-brief/INTERFACE.md').includes(
    'No-UI receipt',
  ),
)
pass('Reference UI shows synthetic mode, no-send authority, no-UI decision, and rollback')

for (const workflow of [
  'discover-opportunities.md',
  'blueprint-a-system.md',
  'build-a-system.md',
  'inspect-capabilities.md',
  'enter-build-mode.md',
  'review-interface-and-deployment.md',
  'improve-a-system.md',
]) {
  assert.ok(fs.existsSync(path.join(root, 'system/workflows', workflow)))
}
pass('Complete 1.0 workflow chain exists from discovery through improvement')

console.log(`Home Base proof passed (${checks.length} checks):`)
for (const check of checks) console.log(`- ${check}`)
