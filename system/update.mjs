#!/usr/bin/env node

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
} from './lib/safe-update-contract.mjs'

const systemDir = path.dirname(fileURLToPath(import.meta.url))
const homeBaseRoot = path.resolve(systemDir, '..')
const args = process.argv.slice(2)
const command = args[0]

function valueAfter(flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

function usage() {
  console.log(`Home Base update engine

Initialize the immutable base after extracting a release:
  node system/update.mjs init

Read-only preview:
  node system/update.mjs preview --candidate /path/to/new/home-base

Prepare a transaction and conflict bundle:
  node system/update.mjs prepare --candidate /path/to/new/home-base

Seal reviewed conflict outputs (when the plan reports conflicts):
  node system/update.mjs seal-resolution --plan /path/to/plan.json

Apply only the exact reviewed plan:
  node system/update.mjs apply --candidate /path/to/new/home-base --plan /path/to/plan.json --approve <plan-digest>

Add --approve-deletes <plan-digest> when the reviewed plan retires maintained paths.

Recover an interrupted transaction:
  node system/update.mjs recover

Rollback the latest committed transaction:
  node system/update.mjs rollback --transaction <id> --approve <id>`)
}

function runProof(targetRoot) {
  for (const script of ['validate.mjs', 'prove.mjs']) {
    const result = spawnSync(process.execPath, [path.join(targetRoot, 'system', script)], {
      cwd: targetRoot,
      encoding: 'utf8',
    })
    if (result.status !== 0) throw new Error(`${script} failed:\n${result.stdout ?? ''}${result.stderr ?? ''}`)
  }
}

if (!command || ['help', '--help'].includes(command)) {
  usage()
  process.exit(0)
}

if (command === 'init') {
  const override = valueAfter('--source-commit') ? {
    sourceCommit: valueAfter('--source-commit'),
    sourceRef: valueAfter('--source-ref') ?? 'developer-checkout',
    sourceRepository: valueAfter('--source-repository') ?? 'local-developer-checkout',
  } : {}
  const state = initializeUpdateState(homeBaseRoot, override)
  console.log(JSON.stringify(state, null, 2))
  process.exit(0)
}

if (command === 'preview') {
  const candidate = valueAfter('--candidate')
  if (!candidate) throw new Error('preview requires --candidate')
  console.log(JSON.stringify(previewUpdate(homeBaseRoot, path.resolve(candidate)), null, 2))
  process.exit(0)
}

if (command === 'prepare') {
  const candidate = valueAfter('--candidate')
  if (!candidate) throw new Error('prepare requires --candidate')
  const prepared = prepareUpdate(homeBaseRoot, path.resolve(candidate))
  console.log(JSON.stringify({
    transactionId: prepared.plan.transactionId,
    planDigest: prepared.plan.planDigest,
    planPath: prepared.planPath,
    conflictRoots: prepared.plan.conflictRoots,
    resolutionRoot: prepared.plan.conflictRoots.length > 0 ? prepared.resolutionRoot : null,
  }, null, 2))
  process.exit(0)
}

if (command === 'seal-resolution') {
  const plan = valueAfter('--plan')
  if (!plan) throw new Error('seal-resolution requires --plan')
  console.log(JSON.stringify(sealResolution(homeBaseRoot, path.resolve(plan)), null, 2))
  process.exit(0)
}

if (command === 'apply') {
  const candidate = valueAfter('--candidate')
  const plan = valueAfter('--plan')
  const approval = valueAfter('--approve')
  if (!candidate || !plan || !approval) throw new Error('apply requires --candidate, --plan, and --approve')
  const result = applyPreparedUpdate(homeBaseRoot, path.resolve(candidate), path.resolve(plan), {
    approval,
    deletionApproval: valueAfter('--approve-deletes'),
    validate: runProof,
  })
  console.log(JSON.stringify({
    result: 'committed',
    transactionId: result.plan.transactionId,
    version: result.state.currentRelease.version,
    checkpoint: result.checkpoint,
  }, null, 2))
  process.exit(0)
}

if (command === 'recover') {
  console.log(JSON.stringify(recoverUpdate(homeBaseRoot, { validate: runProof }), null, 2))
  process.exit(0)
}

if (command === 'rollback') {
  const transactionId = valueAfter('--transaction')
  const approval = valueAfter('--approve')
  if (!transactionId || !approval) throw new Error('rollback requires --transaction and --approve')
  console.log(JSON.stringify(rollbackCommittedUpdate(homeBaseRoot, transactionId, approval, { validate: runProof }), null, 2))
  process.exit(0)
}

throw new Error(`Unknown update command: ${command}`)
