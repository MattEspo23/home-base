#!/usr/bin/env node
// Put the Home Base dashboard online, locked to your own Vercel sign-in.
// Lock first: placeholder, lock, check, then the real copy, then check again.
// The steps are in system/workflows/put-the-dashboard-online.md.
//
//   node system/dashboard/publish.mjs --placeholder --out <folder>
//   node system/dashboard/publish.mjs --check-locked <https address> [<https address> ...] --out <folder>
//   node system/dashboard/publish.mjs --out <folder> [--home-base <folder>]
//
// --placeholder writes a harmless "This Home Base is locked" page and reads
// nothing from Home Base. --check-locked asks each address for the page, the
// data, and an asset without any sign-in, and passes only when every answer is
// Vercel's own sign-in wall, and records the pass in the --out folder.
// --out writes a static copy of exactly what the local dashboard shows (names
// and counts, never file contents) into a folder the placeholder was uploaded
// from, only within 30 minutes after a passing check recorded there, and
// lists every file that will go online. The output folder must be outside the
// Home Base folder.
//
// This script never contacts Vercel and never uploads anything; the official
// Vercel CLI does that. It never reads Vercel sign-in files or tokens.
// Exit codes: 0 done (or locked), 1 refused (or not locked), 2 usage.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const nodeMajor = Number(process.versions.node.split('.')[0])
if (nodeMajor < 20) {
  console.error(`Putting the dashboard online needs Node.js 20 or later; this computer has Node.js ${process.versions.node}. Install the current LTS version from https://nodejs.org. Nothing was written.`)
  process.exit(2)
}

const online = await import('./lib/online.mjs')
const { looksLikeHomeBase, resolveHomeBase } = await import('./lib/status.mjs')

const dashboardDir = path.dirname(fileURLToPath(import.meta.url))
const COMMAND = 'node system/dashboard/publish.mjs'
const NPX = `npx --yes ${online.VERCEL_CLI}`
const USAGE = `Usage:
  ${COMMAND} --placeholder --out <folder>
  ${COMMAND} --check-locked <https address> [<https address> ...] --out <folder>
  ${COMMAND} --out <folder> [--home-base <folder>]

  --placeholder          write the harmless locked page (reads nothing from Home Base)
  --check-locked         pass only if every address asks for a Vercel sign-in, and
                         record the pass in the --out folder (the real copy needs one
                         from the last 30 minutes)
  --out <folder>         the folder to upload from, outside your Home Base folder
  --home-base <folder>   another Home Base folder (default: the one this file is in);
                         with --placeholder it only names the folder to stay out of`

class UsageError extends Error {}

function parseArguments(argv) {
  const options = { addresses: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--help') return { help: true }
    if (flag === '--placeholder') { options.placeholder = true; continue }
    if (flag === '--check-locked') {
      options.checkLocked = true
      while (argv[index + 1] !== undefined && !argv[index + 1].startsWith('--')) options.addresses.push(argv[(index += 1)])
      continue
    }
    if (flag !== '--out' && flag !== '--home-base') throw new UsageError(`Unknown argument at position ${index + 1}`)
    const value = argv[index + 1]
    if (value === undefined || value === '' || value.startsWith('--')) throw new UsageError(`${flag} needs a value`)
    const key = flag === '--out' ? 'out' : 'homeBase'
    if (options[key] !== undefined) throw new UsageError(`${flag} may be given once`)
    options[key] = value
    index += 1
  }
  if (options.checkLocked) {
    if (options.placeholder) throw new UsageError('--check-locked is used without --placeholder')
    if (options.addresses.length === 0) throw new UsageError('--check-locked needs at least one https address')
    if (options.addresses.some((address) => !online.lockCheckOrigin(address))) throw new UsageError('--check-locked takes https addresses only, such as https://<your-project>.vercel.app')
    if (!options.out) throw new UsageError('--check-locked needs --out <folder>, the folder you upload from, so the result is recorded there')
    return options
  }
  if (!options.out) throw new UsageError('--out <folder> is required')
  return options
}

function homeBaseRoot(candidate) {
  let realRoot
  try { realRoot = resolveHomeBase(candidate) } catch { throw new online.PublishRefused(['that Home Base folder does not exist']) }
  if (!looksLikeHomeBase(realRoot)) throw new online.PublishRefused(['that folder is not a Home Base (it needs AGENTS.md and you/SETUP.md)'])
  return realRoot
}

function printList(manifest, realOut) {
  const width = Math.max(...manifest.files.map((item) => item.path.length))
  const total = manifest.files.reduce((sum, item) => sum + item.bytes, 0)
  console.log('These files will go online:')
  for (const item of manifest.files) console.log(`  ${item.path.padEnd(width)}  ${online.formatBytes(item.bytes).padStart(9)}`)
  console.log(`Total: ${manifest.files.length} files, ${online.formatBytes(total)}.`)
  console.log(`They are in ${realOut}. Nothing has been uploaded.`)
}

async function runCheck(options) {
  // Refuse a bad output folder before any request is made.
  const realRoot = homeBaseRoot(options.homeBase ?? path.resolve(dashboardDir, '..', '..'))
  online.prepareOutput(options.out, realRoot, { requireManifest: true })
  const { locked, results } = await online.checkLocked(options.addresses)
  for (const result of results) console.log(`  ${result.ok ? 'ok     ' : 'NOT OK '} ${result.url}  ${result.status ?? '---'}  ${result.why}`)
  if (locked) {
    console.log(`Locked: every address asked for a Vercel sign-in (${results.length} anonymous requests, no cookies).`)
    const origins = options.addresses.map((address) => online.lockCheckOrigin(address))
    const realOut = online.recordLockCheck(options.out, realRoot, origins)
    console.log(`Recorded in ${realOut}: the real copy can be built there in the next 30 minutes.`)
    return 0
  }
  online.clearLockRecord(options.out, realRoot)
  console.log('NOT LOCKED: at least one address did not ask for a Vercel sign-in.')
  console.log('Stop. Do not upload your dashboard. Put the placeholder back now:')
  console.log(`  ${COMMAND} --placeholder --out <folder>`)
  console.log(`  ${NPX} deploy --cwd <folder> --prod --yes --scope <scope>`)
  console.log('Then turn on Vercel Authentication for All Deployments and check again.')
  return 1
}

async function main() {
  let options
  try {
    options = parseArguments(process.argv.slice(2))
  } catch (error) {
    if (!(error instanceof UsageError)) throw error
    console.error(`publish: ${error.message}\n${USAGE}`)
    return 2
  }
  if (options.help) { console.log(USAGE); return 0 }
  try {
    if (options.checkLocked) return await runCheck(options)
    const realRoot = homeBaseRoot(options.homeBase ?? path.resolve(dashboardDir, '..', '..'))
    const createdAt = new Date()
    if (options.placeholder) {
      const { realOut, previous } = online.prepareOutput(options.out, realRoot)
      const files = online.buildPlaceholder()
      const reasons = online.scanFiles(files)
      if (reasons.length) throw new online.PublishRefused(reasons)
      const manifest = online.writeOutput(realOut, previous, files, { kind: 'placeholder', createdAt: createdAt.toISOString() })
      printList(manifest, realOut)
      console.log('This is the locked placeholder. It holds nothing from your Home Base.')
      console.log(`Upload it (after a yes): ${NPX} deploy --cwd "${realOut}" --prod --yes --scope <scope>`)
      return 0
    }
    const { realOut, previous } = online.prepareOutput(options.out, realRoot, { requireManifest: true })
    online.requireLockCheck(realOut, createdAt)
    const { files } = online.buildSnapshot(realRoot, { distDir: path.join(dashboardDir, 'dist'), now: createdAt })
    const reasons = online.scanFiles(files)
    if (reasons.length) throw new online.PublishRefused(reasons)
    const manifest = online.writeOutput(realOut, previous, files, { kind: 'snapshot', createdAt: createdAt.toISOString() })
    printList(manifest, realOut)
    console.log('status.json holds only the names and counts your dashboard shows, never file contents.')
    console.log('Upload only if --check-locked passed on this project:')
    console.log(`  ${NPX} deploy --cwd "${realOut}" --prod --yes --scope <scope>`)
    console.log(`Then check again: ${COMMAND} --check-locked <production address> <new deployment address> --out "${realOut}"`)
    return 0
  } catch (error) {
    if (!(error instanceof online.PublishRefused)) throw error
    console.error('Refused. Nothing was written to the output folder.')
    for (const reason of error.reasons) console.error(`  - ${reason}`)
    return 1
  }
}

process.exitCode = await main().catch((error) => {
  console.error(`publish: could not finish (${error.code ?? error.name}). Nothing was uploaded.`)
  return 1
})
