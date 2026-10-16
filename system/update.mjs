#!/usr/bin/env node

import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Home Base needs Node.js 20 or later. This check runs before the update
// engine is loaded (a dynamic import below), so an older Node gets a plain
// message instead of a stack trace, and nothing is read or written.
const nodeMajor = Number(process.versions.node.split('.')[0])
if (nodeMajor < 20) {
  console.error(`Home Base needs Node.js 20 or later; this computer has Node.js ${process.versions.node}. Install the current LTS version from https://nodejs.org, then run the command again. Nothing was changed.`)
  process.exit(1)
}

const {
  applyPreparedUpdate,
  initializeUpdateState,
  prepareUpdate,
  previewUpdate,
  recoverUpdate,
  rollbackCommittedUpdate,
  sealResolution,
} = await import('./lib/safe-update-contract.mjs')

const args = process.argv.slice(2)
const command = args[0]

function valueAfter(flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

// --root lets the copy of this script kept with a transaction
// (.home-base/state/transactions/<id>/tool/system/update.mjs) recover the
// Home Base folder when its own system/ folder is missing or broken.
const systemDir = path.dirname(fileURLToPath(import.meta.url))
const rootArgument = valueAfter('--root')
if (args.includes('--root') && !rootArgument) throw new Error('--root needs the Home Base folder')
const homeBaseRoot = rootArgument ? path.resolve(rootArgument) : path.resolve(systemDir, '..')

const usageText = `Home Base update engine

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

If system/update.mjs is missing or broken, run the copy kept with the
transaction named in .home-base/state/recovery.json:
  node .home-base/state/transactions/<id>/tool/system/update.mjs recover --root <home-base-folder>

If a 1.0.x updater left an update unfinished that its own recover cannot
finish, run this command from the newer release folder:
  node /path/to/new/home-base/system/update.mjs recover --root <home-base-folder>

Rollback the latest committed transaction:
  node system/update.mjs rollback --transaction <id> --approve <id>
`

function runScripts(targetRoot, scripts) {
  for (const script of scripts) {
    const result = spawnSync(process.execPath, [path.join(targetRoot, 'system', script)], {
      cwd: targetRoot,
      encoding: 'utf8',
    })
    if (result.status !== 0) throw new Error(`${script} failed:\n${result.stdout ?? ''}${result.stderr ?? ''}`)
  }
}

// The incoming release (staged, then live after the swap) runs its own
// validator and proof; both pass in an installed, personalized Home Base.
function proveCandidate(targetRoot) {
  runScripts(targetRoot, ['validate.mjs', 'prove.mjs'])
}

// A restored tree is confirmed by the checkpoint's recorded hashes inside the
// update engine. Only its validator runs here, never its own (possibly older)
// prove.mjs: the 1.0.x proof refuses any install that holds the user's files.
function validateRestored(targetRoot) {
  runScripts(targetRoot, ['validate.mjs'])
}

// Assistants capture command output through a pipe, which Node writes
// asynchronously on macOS. Exiting right after a large write cut a preview off
// at the pipe buffer (64 KB on Node 20, 128 KB on Node 22), so output is
// awaited until the operating system has taken every byte, and the script then
// ends on its own instead of calling process.exit. This stays inline: the
// recovery copy kept with a transaction holds only this file and the contract.
function writeStdout(text) {
  return new Promise((resolve) => {
    process.stdout.write(text, () => resolve())
  })
}

function printJson(value) {
  return writeStdout(`${JSON.stringify(value, null, 2)}\n`)
}

async function main() {
  if (!command || ['help', '--help'].includes(command)) {
    await writeStdout(usageText)
    return
  }

  if (command === 'init') {
    const override = valueAfter('--source-commit') ? {
      sourceCommit: valueAfter('--source-commit'),
      sourceRef: valueAfter('--source-ref') ?? 'developer-checkout',
      sourceRepository: valueAfter('--source-repository') ?? 'local-developer-checkout',
    } : {}
    const state = initializeUpdateState(homeBaseRoot, override)
    await printJson(state)
    return
  }

  if (command === 'preview') {
    const candidate = valueAfter('--candidate')
    if (!candidate) throw new Error('preview requires --candidate')
    await printJson(previewUpdate(homeBaseRoot, path.resolve(candidate)))
    return
  }

  if (command === 'prepare') {
    const candidate = valueAfter('--candidate')
    if (!candidate) throw new Error('prepare requires --candidate')
    const prepared = prepareUpdate(homeBaseRoot, path.resolve(candidate))
    await printJson({
      transactionId: prepared.plan.transactionId,
      planDigest: prepared.plan.planDigest,
      planPath: prepared.planPath,
      conflictRoots: prepared.plan.conflictRoots,
      resolutionRoot: prepared.plan.conflictRoots.length > 0 ? prepared.resolutionRoot : null,
    })
    return
  }

  if (command === 'seal-resolution') {
    const plan = valueAfter('--plan')
    if (!plan) throw new Error('seal-resolution requires --plan')
    await printJson(sealResolution(homeBaseRoot, path.resolve(plan)))
    return
  }

  if (command === 'apply') {
    const candidate = valueAfter('--candidate')
    const plan = valueAfter('--plan')
    const approval = valueAfter('--approve')
    if (!candidate || !plan || !approval) throw new Error('apply requires --candidate, --plan, and --approve')
    const result = applyPreparedUpdate(homeBaseRoot, path.resolve(candidate), path.resolve(plan), {
      approval,
      deletionApproval: valueAfter('--approve-deletes'),
      validate: proveCandidate,
      validateRestored,
    })
    await printJson({
      result: 'committed',
      transactionId: result.plan.transactionId,
      version: result.state.currentRelease.version,
      checkpoint: result.checkpoint,
    })
    return
  }

  if (command === 'recover') {
    await printJson(recoverUpdate(homeBaseRoot, { validateRestored }))
    return
  }

  if (command === 'rollback') {
    const transactionId = valueAfter('--transaction')
    const approval = valueAfter('--approve')
    if (!transactionId || !approval) throw new Error('rollback requires --transaction and --approve')
    await printJson(rollbackCommittedUpdate(homeBaseRoot, transactionId, approval, { validateRestored }))
    return
  }

  throw new Error(`Unknown update command: ${command}`)
}

await main()
