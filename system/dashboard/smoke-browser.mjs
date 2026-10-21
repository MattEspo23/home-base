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
// site that carries the key still signs in; a theme applies through
// same-origin stylesheets and an invalid one is explained in the footer.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findBrowser, freePort, openBrowser, startDashboard } from './lib/chrome.mjs'

const dashboardDir = path.dirname(fileURLToPath(import.meta.url))

const browserPath = findBrowser()
if (!browserPath) {
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

const cleanups = []
async function main() {
  const port = await freePort()
  const key = await startDashboard(dashboardDir, home, port, cleanups)
  const origin = `http://127.0.0.1:${port}`
  const { page, evaluate, open, text, sleep, events } = await openBrowser(browserPath, path.join(scratch, 'profile'), cleanups)

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

  // 3b. A theme applies on reload as same-origin stylesheets, under the same
  //     CSP; theme.css loads after it; an invalid theme is explained in the
  //     footer and the default look stays.
  const defaultBackground = await evaluate('getComputedStyle(document.body).backgroundColor')
  assert.equal(await evaluate("document.querySelectorAll('link[href^=\"/instance-theme/\"]').length"), 0, 'no theme links without a theme')
  write('instance/dashboard/theme.json', fs.readFileSync(path.join(dashboardDir, 'themes', 'soft.json')))
  write('instance/dashboard/theme.css', '.brand { letter-spacing: 0.3em; }\n')
  await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
  await open(`${origin}/`, `!document.getElementById('foot-theme').hidden`)
  assert.equal(await evaluate("getComputedStyle(document.body).backgroundColor"), 'rgb(247, 243, 238)', 'soft background applied')
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.domain')).borderTopLeftRadius"), '16px', 'large radius applied')
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.brand')).letterSpacing"), `${0.3 * 15}px`, 'theme.css applied after the tokens')
  assert.equal(await evaluate("document.getElementById('foot-theme').textContent"), 'Theme: Soft. Your theme.css is applied.')
  assert.deepEqual(await evaluate("[...document.querySelectorAll('link[rel=stylesheet]')].map((link) => new URL(link.href).pathname)"), ['/app/styles.css', '/instance-theme/tokens.css', '/instance-theme/theme.css'])
  fs.rmSync(path.join(home, 'instance/dashboard/theme.css'))
  write('instance/dashboard/theme.json', JSON.stringify({ schemaVersion: 1, colors: { light: { accent: 'blue' } } }))
  await open(`${origin}/`, `!document.getElementById('foot-theme').hidden`)
  const note = await evaluate("document.getElementById('foot-theme').textContent")
  assert.ok(note.startsWith('Theme not applied: colors.light.accent “blue” is not a colour like #1d4ed8'), note)
  assert.equal(await evaluate("getComputedStyle(document.body).backgroundColor"), defaultBackground, 'the default look stays')
  assert.equal(await evaluate("document.querySelectorAll('link[href^=\"/instance-theme/\"]').length"), 0, 'no theme links for an invalid theme')
  fs.rmSync(path.join(home, 'instance/dashboard/theme.json'))
  await page('Emulation.setEmulatedMedia', { features: [] })

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
