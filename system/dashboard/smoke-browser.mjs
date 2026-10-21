#!/usr/bin/env node
// Browser smoke test for the dashboard. No dependencies: it drives a local
// Chrome or Chromium over the DevTools protocol with Node's built-in
// WebSocket (Node 22.4 or later). Without a browser it says so and skips.
//
//   node system/dashboard/smoke-browser.mjs
//
// It builds a temporary synthetic Home Base, starts the dashboard on a free
// port, and checks in a throwaway headless profile: the #key address signs in
// and leaves the address bar; the page renders under the strict CSP and
// Trusted Types with no console errors; a declared instance module loads
// through import(); the cookie is HttpOnly and SameSite=Strict; localhost and
// a browser without the cookie get the help page with no data; no request
// leaves 127.0.0.1; nothing scrolls sideways at 375 px; a link from another
// site that carries the key still signs in.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dashboardDir = path.dirname(fileURLToPath(import.meta.url))

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ]
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const found = spawnSync('which', [name], { encoding: 'utf8' })
    if (found.status === 0) candidates.push(found.stdout.trim())
  }
  return candidates.find((candidate) => candidate && fs.existsSync(candidate))
}

const browserPath = findBrowser()
if (!browserPath || typeof WebSocket !== 'function') {
  console.log('Skipped: no Chrome or Chromium found (set CHROME_PATH), or this Node has no built-in WebSocket.')
  process.exit(0)
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'home-base-dashboard-smoke-'))
const home = path.join(scratch, 'home-base')
const write = (relative, contents) => {
  fs.mkdirSync(path.dirname(path.join(home, relative)), { recursive: true })
  fs.writeFileSync(path.join(home, relative), contents)
}
const PRIVATE = ['SMOKE', 'PRIVATE', 'BODY'].join('_')
write('AGENTS.md', '# Agents\n')
write('you/SETUP.md', `---\nsetup_status: in_progress\nstage: opportunity_map\n---\n${PRIVATE}\n`)
write('projects/INDEX.md', '## Active\n\n- [Lake trip](lake-trip.md) — book the cabin\n- Unlinked plan\n')
write('capabilities/INDEX.md', '## Available and verified\n\n- [Codex opens Home Base directly](codex.md) — reads AGENTS.md; checked 2026-10-12\n')
write('instance/dashboard/modules.json', JSON.stringify({ modules: [{ id: 'smoke', title: 'Smoke module', entry: 'index.js' }] }))
write('instance/dashboard/modules/smoke/index.js', 'export function mount(element) { const p = document.createElement("p"); p.textContent = "Smoke module mounted"; element.append(p) }\n')

const freePort = () => new Promise((resolve) => {
  const probe = net.createServer().listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)) })
})

const cleanups = []
async function main() {
  let port = await freePort()
  while (port < 1024 || [4173, 5173, 3000, 5000, 8000, 8080, 8888].includes(port)) port = await freePort()
  const server = spawn(process.execPath, [path.join(dashboardDir, 'serve.mjs'), '--home-base', home, '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] })
  cleanups.push(() => server.kill())
  const launch = await new Promise((resolve, reject) => {
    let output = ''
    server.stdout.on('data', (chunk) => { output += chunk; if (output.includes('Press Ctrl+C')) resolve(output) })
    server.on('exit', (code) => reject(new Error(`dashboard exited ${code}: ${output}`)))
  })
  const key = launch.match(/#key=([A-Za-z0-9_-]{43})/)[1]
  const origin = `http://127.0.0.1:${port}`

  const profile = path.join(scratch, 'profile')
  const browser = spawn(browserPath, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync',
    '--disable-component-update', '--metrics-recording-only', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  cleanups.push(() => browser.kill())
  const endpoint = await new Promise((resolve, reject) => {
    let output = ''
    browser.stderr.on('data', (chunk) => { output += chunk; const match = output.match(/DevTools listening on (ws:\/\/\S+)/); if (match) resolve(match[1]) })
    browser.on('exit', (code) => reject(new Error(`browser exited ${code}`)))
    setTimeout(() => reject(new Error('browser did not start')), 15000).unref()
  })

  const socket = new WebSocket(endpoint)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  cleanups.push(() => socket.close())
  let nextId = 1
  const pending = new Map()
  const events = []
  socket.onmessage = (message) => {
    const data = JSON.parse(message.data)
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id)
      pending.delete(data.id)
      if (data.error) reject(new Error(data.error.message))
      else resolve(data.result)
    } else if (data.method) {
      events.push(data)
    }
  }
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const page = (method, params) => send(method, params, sessionId)
  await page('Runtime.enable')
  await page('Log.enable')
  await page('Network.enable')
  await page('Page.enable')
  const evaluate = async (expression) => (await page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  async function open(url, ready) {
    await page('Page.navigate', { url })
    for (let waited = 0; waited < 10000; waited += 100) {
      await sleep(100)
      if (await evaluate(ready).catch(() => false)) return
    }
    throw new Error(`Timed out waiting on ${url}: ${await evaluate('document.body ? document.body.innerText.slice(0, 300) : ""')}`)
  }
  const text = () => evaluate('document.body.innerText')

  // 1. The printed address signs in and opens the dashboard.
  await open(`${origin}/#key=${key}`, `document.querySelector('#home-body .next') !== null && document.body.innerText.includes('Smoke module mounted')`)
  assert.equal(await evaluate('location.href'), `${origin}/`, 'the key leaves the address bar')
  const dashboard = await text()
  // innerText follows CSS text-transform, so compare without case.
  for (const expected of ['Your Home Base', 'Lake trip', 'Codex', 'Verified', '1 more entry not shown', 'Smoke module mounted']) {
    assert.ok(dashboard.toLowerCase().includes(expected.toLowerCase()), `${expected} in: ${dashboard.slice(0, 400)}`)
  }
  assert.ok(!dashboard.includes(PRIVATE), 'no file bodies')
  assert.ok(!/\b(null|undefined|NaN)\b/.test(dashboard), `no stray null, undefined or NaN in: ${dashboard.slice(0, 400)}`)

  // 2. The cookie flags as the browser stored them.
  const { cookies } = await page('Network.getCookies', { urls: [origin] })
  const cookie = cookies.find((item) => item.name === `hb_${port}`)
  assert.ok(cookie, 'signed in')
  assert.equal(cookie.httpOnly, true)
  assert.equal(cookie.sameSite, 'Strict')
  assert.equal(cookie.secure, false)
  assert.equal(await evaluate('document.cookie'), '', 'scripts cannot read it')

  // 3. A typed plain address works once signed in, and nothing scrolls sideways at 375 px.
  await page('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true })
  await open(`${origin}/`, `document.querySelector('#home-body .next') !== null`)
  assert.ok(await evaluate('document.documentElement.scrollWidth <= 375'), 'no horizontal scroll at 375 px')
  await page('Emulation.clearDeviceMetricsOverride')

  // 4. localhost gets the help page, with no data.
  await open(`http://localhost:${port}/`, `document.body.innerText.includes('Open your Home Base dashboard')`)
  const helpText = await text()
  assert.ok(helpText.includes(`${origin}/`) && !helpText.includes('Lake trip') && !helpText.includes(key))

  // 5. Without the cookie, the plain address gets the help page.
  await page('Network.clearBrowserCookies')
  await open(`${origin}/`, `document.body.innerText.includes('Open your Home Base dashboard')`)
  assert.ok(!(await text()).includes('Lake trip'))

  // 5b. A link from another site (here localhost, which is cross-site to
  //     127.0.0.1) to the printed address still signs in: the help page
  //     trades the key with a same-origin request.
  await open(`http://localhost:${port}/`, `document.body.innerText.includes('Open your Home Base dashboard')`)
  await evaluate(`location.href = ${JSON.stringify(`${origin}/#key=${key}`)}; true`)
  for (let waited = 0; waited < 10000 && !(await evaluate(`document.querySelector('#home-body .next') !== null`).catch(() => false)); waited += 100) await sleep(100)
  assert.ok((await text()).includes('Lake trip'), 'signed in after a cross-site link')
  assert.equal(await evaluate('location.href'), `${origin}/`)
  await page('Network.clearBrowserCookies')
  await open(`${origin}/`, `document.body.innerText.includes('Open your Home Base dashboard')`)

  // 6. A wrong key is explained, not accepted.
  await open(`${origin}/#key=${'A'.repeat(43)}`, `document.getElementById('status').textContent.includes('does not match')`)

  // 7. No console errors (CSP or Trusted Types violations surface here), and
  //    no request left 127.0.0.1 or localhost on this port.
  const problems = events.filter((event) =>
    event.method === 'Runtime.exceptionThrown' ||
    (event.method === 'Log.entryAdded' && event.params.entry.level === 'error' && !/status of 403/.test(event.params.entry.text)) ||
    (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error'))
  assert.deepEqual(problems.map((event) => JSON.stringify(event.params).slice(0, 200)), [])
  const requested = events.filter((event) => event.method === 'Network.requestWillBeSent').map((event) => event.params.request.url)
  const outside = requested.filter((url) => !url.startsWith(`${origin}/`) && !url.startsWith(`http://localhost:${port}/`) && url !== 'about:blank')
  assert.deepEqual(outside, [], 'no outside requests')
  console.log(`Browser smoke test passed (${path.basename(browserPath)}, ${requested.length} requests, all local).`)
}

try {
  await main()
} catch (error) {
  console.error(`Browser smoke test failed: ${error.message}`)
  process.exitCode = 1
} finally {
  for (const cleanup of cleanups.reverse()) { try { cleanup() } catch {} }
  setTimeout(() => {
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    process.exit()
  }, 500)
}
