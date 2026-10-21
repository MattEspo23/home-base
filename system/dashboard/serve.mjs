#!/usr/bin/env node
// Start the local Home Base dashboard.
//
//   node system/dashboard/serve.mjs [--home-base <folder>] [--port <port>] [--new-key]
//
// It serves only http://127.0.0.1:<port>/, where the port belongs to this
// Home Base folder. At first launch it saves its settings (port, browser
// database name, and a random per-install key) in
// .home-base/state/dashboard.json, readable only by you. It prints the
// address with the key every time it starts. It refuses a port that anything
// else already answers on instead of picking another one, reads only a few
// index names and setup fields, and makes no outside requests.
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Home Base needs Node.js 20 or later. This check runs before the dashboard
// code is loaded (dynamic imports below), so an older Node gets a plain
// message instead of a stack trace. Exit code 2: refused before starting.
const nodeMajor = Number(process.versions.node.split('.')[0])
if (nodeMajor < 20) {
  console.error(`The Home Base dashboard needs Node.js 20 or later; this computer has Node.js ${process.versions.node}. Install the current LTS version from https://nodejs.org, then run the command again. Nothing was written.`)
  process.exit(2)
}

const { createDashboardServer, instanceTagFor } = await import('./lib/server.mjs')
const { BLOCKED_PORTS, deriveIdentity, loadIdentity, looksLikeHomeBase, portAllowed, resolveHomeBase } = await import('./lib/status.mjs')

const dashboardDir = path.dirname(fileURLToPath(import.meta.url))
const COMMAND = 'node system/dashboard/serve.mjs'
const USAGE = `Usage: ${COMMAND} [--home-base <folder>] [--port <port>] [--new-key]

  --home-base <folder>  show another Home Base folder (default: the one this file is in)
  --port <port>         use and save a different port, for example 24680
  --new-key             make a new key; browsers signed in before must open the new address`

const PERMISSION_CODES = new Set(['EACCES', 'EPERM', 'EROFS'])
const SANDBOX_HINT = `If an assistant started this inside a sandbox, run it yourself in a Terminal window from your Home Base folder:\n  ${COMMAND}`

function parseArguments(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--help') return { help: true }
    if (flag === '--new-key') { options[flag] = true; continue }
    if (flag !== '--home-base' && flag !== '--port') throw new Error(`Unknown argument at position ${index + 1}`)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`)
    if (options[flag] !== undefined) throw new Error(`${flag} may be given once`)
    options[flag] = value
    index += 1
  }
  return options
}

function fail(code, message) {
  console.error(message)
  process.exit(code)
}

// True when anything accepts a TCP connection on 127.0.0.1:<port>. This also
// catches a program listening on the wildcard address 0.0.0.0 or [::], which
// some systems would otherwise let this dashboard shadow on 127.0.0.1.
function portAnswers(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' })
    const done = (answer) => { socket.destroy(); resolve(answer) }
    socket.setTimeout(1500, () => done(true))
    socket.once('connect', () => done(true))
    socket.once('error', (error) => done(error.code !== 'ECONNREFUSED'))
  })
}

// True when the program on the port is this Home Base's own dashboard: its
// help page carries a tag only this install's key can produce.
function isOwnDashboard(port, key) {
  return new Promise((resolve) => {
    const request = http.get({ host: '127.0.0.1', port, path: '/', agent: false, timeout: 2000, headers: { host: `127.0.0.1:${port}` } }, (response) => {
      response.resume()
      resolve(response.headers['x-home-base-instance'] === instanceTagFor(key))
    })
    request.on('timeout', () => { request.destroy(); resolve(false) })
    request.on('error', () => resolve(false))
  })
}

async function suggestPort(seed) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const { port } = deriveIdentity(`${seed}|suggest|${attempt}`)
    if (!(await portAnswers(port))) return port
  }
  return null
}

function printAddress(port, key, intro) {
  console.log(intro)
  console.log('Open this address. It includes your private key, so keep it to yourself:')
  console.log(`  http://127.0.0.1:${port}/#key=${key}`)
  console.log(`After the first visit, this browser also opens http://127.0.0.1:${port}/ directly. Use 127.0.0.1, not localhost.`)
}

let options
try {
  options = parseArguments(process.argv.slice(2))
} catch (error) {
  fail(2, `${error.message}\n${USAGE}`)
}
if (options.help) {
  console.log(USAGE)
  process.exit(0)
}

let root
try {
  root = resolveHomeBase(options['--home-base'] ?? path.join(dashboardDir, '..', '..'))
} catch {
  fail(2, 'Refusing to start: the Home Base folder could not be opened.')
}
if (!looksLikeHomeBase(root)) {
  fail(2, 'Refusing to start: that folder is not a Home Base (it needs AGENTS.md and you/SETUP.md). Nothing was written.')
}

const requestedPort = options['--port'] === undefined ? undefined : Number(options['--port'])
if (requestedPort !== undefined && !portAllowed(requestedPort)) {
  fail(2, `Refusing to start: port ${options['--port']} is reserved or invalid. Choose a whole number from 1024 to 65535 other than ${[...BLOCKED_PORTS].sort((a, b) => a - b).join(', ')}, for example 24680.`)
}

function identityFor(settings) {
  try {
    return loadIdentity(root, settings)
  } catch (error) {
    return fail(2, PERMISSION_CODES.has(error?.code)
      ? `Refusing to start: permission denied while saving the dashboard settings in .home-base/state/.\n${SANDBOX_HINT}`
      : 'Refusing to start: the dashboard could not save its settings in .home-base/state/.')
  }
}

let identity = identityFor({})
const port = requestedPort ?? identity.port

if (await portAnswers(port)) {
  if (await isOwnDashboard(port, identity.key)) {
    if (options['--new-key']) fail(3, 'The dashboard is running. Stop it first (Ctrl+C in its window), then run the command with --new-key again.')
    printAddress(port, identity.key, 'The Home Base dashboard is already running.')
    process.exit(0)
  }
  const suggestion = await suggestPort(identity.dbName)
  fail(3, [
    `Refusing to start: another program is already using port ${port}. Home Base never shares a port or picks one silently.`,
    'Close that program and try again, or choose a different port. The choice is saved for next time:',
    `  ${COMMAND} --port ${suggestion ?? 24680}`,
    'A new port starts with an empty browser storage for the dashboard.',
  ].join('\n'))
}

if (options['--new-key']) identity = identityFor({ rotateKey: true })

const { server, expectedOrigin } = createDashboardServer({ root, port, dbName: identity.dbName, key: identity.key, distDir: path.join(dashboardDir, 'dist') })
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') fail(3, `Refusing to start: port ${port} is busy. Close the other program, or choose a different port:\n  ${COMMAND} --port <port>`)
  if (PERMISSION_CODES.has(error.code)) fail(4, `Refusing to start: this computer did not allow the dashboard to open port ${port} (permission denied).\n${SANDBOX_HINT}`)
  fail(3, 'The dashboard stopped because of an unexpected error.')
})
server.listen({ port, host: '127.0.0.1', exclusive: true }, () => {
  if (requestedPort !== undefined && requestedPort !== identity.port) {
    try {
      loadIdentity(root, { port: requestedPort })
      console.log(`Saved port ${requestedPort} for next time.`)
    } catch {
      console.log(`Could not save port ${requestedPort}; add --port ${requestedPort} next time too.`)
    }
  }
  printAddress(port, identity.key, `Home Base dashboard: ${expectedOrigin}/`)
  console.log('It runs only on this computer. Press Ctrl+C to stop it.')
})
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 1000).unref()
  })
}
