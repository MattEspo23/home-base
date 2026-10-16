#!/usr/bin/env node
// Dashboard tests: hardened server, status parsing, identity, sample data.
// Every server here runs against a temporary fixture, never this folder.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { COOKIE_MAX_AGE, cookieValueFor, createDashboardServer } from './lib/server.mjs'
import {
  BLOCKED_PORTS, IDENTITY_FILE, deriveIdentity, loadIdentity, newKey, parseAssistants, parseIndex, parseSetup,
  portAllowed, readInstanceModules, readStatus, resolveHomeBase,
} from './lib/status.mjs'

const dashboardDir = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.join(dashboardDir, 'dist')
const SENTINEL = ['PRIVATE', 'BODY', 'SENTINEL', '9c41'].join('_')
const OUTSIDE = ['OUTSIDE', 'FOLDER', 'SENTINEL', '27d0'].join('_')
const sample = await import(pathToFileURL(path.join(distDir, 'sample.js')).href)
const copy = await import(pathToFileURL(path.join(distDir, 'copy.js')).href)
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'home-base-dashboard-test-'))
const fixture = path.join(scratch, 'home-base')

function write(root, relative, contents) {
  const target = path.join(root, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, contents)
}

write(fixture, 'you/SETUP.md', `---\nsetup_status: in_progress\nstage: orient\ndiscovery_path: personal\norientation_completed: 3\nnext_question: proof\nprivate_note: ${SENTINEL}\n---\n\n${SENTINEL}\n`)
write(fixture, 'you/ABOUT.md', SENTINEL)
write(fixture, 'work/PEOPLE.md', SENTINEL)
write(fixture, 'memory/MEMORY.md', SENTINEL)
write(fixture, 'AGENTS.md', '# Agents\n')
write(fixture, 'CLAUDE.md', '@AGENTS.md\n')
write(fixture, 'systems/INDEX.md', `# System index\n\n## Active\n\n- [Weekly review](weekly-review/BLUEPRINT.md) — runs Fridays ${SENTINEL}\n- ${SENTINEL} unlinked\n\n## Building or testing\n\n- [Packing list](packing/BLUEPRINT.md)\n\n## Designing\n\nNone.\n`)
write(fixture, 'projects/INDEX.md', `# Project index\n\n## Active\n\n- [Lake trip](lake-trip.md)\n- [External](https://example.com/${SENTINEL})\n- Plain ${SENTINEL}\n\n## Waiting\n\n- [Not active](x.md)\n`)
write(fixture, 'capabilities/INDEX.md', [
  '# Capability index', '',
  '## Available and verified', '',
  '- [Claude Code opens Home Base](claude-code.md) — checked 2026-10-12',
  `- [Browser control works](browser.md) — checked 2026-10-12 ${SENTINEL}`,
  '', '## Available but unverified', '',
  '| Capability | Checked |', '|---|---|', '| [Codex opens Home Base](codex.md) | checked 2026-02-30 |',
  '', '## Missing or blocked', '',
  '- [Phone assistant reaches Home Base](phone.md) — checked 2026-10-08',
  `- Unlinked Assistant opens Home Base — checked 2026-10-01 ${SENTINEL}`,
  '', '## Superseded', '', '- [Old Tool opens Home Base](old.md) — checked 2025-01-01', '',
].join('\n'))
write(fixture, 'tools/INDEX.md', '# Tool index\n')
write(fixture, 'skills/INDEX.md', '# Skill index\n\n## Active\n\n- [Packing check](packing-check/SKILL.md)\n- Unlinked skill\n\n## Draft\n\n- [Draft one](d/SKILL.md)\n')
for (const name of ['start-home-base', 'deepen-home-base']) {
  write(fixture, `.claude/skills/${name}/SKILL.md`, 'x')
  write(fixture, `.agents/skills/${name}/SKILL.md`, 'x')
}
write(fixture, '.agents/skills/codex-only/SKILL.md', 'x')
write(fixture, 'instance/dashboard/modules.json', JSON.stringify({ modules: [{ id: 'demo', title: 'Demo', entry: 'index.js' }, { id: '../bad', entry: 'x.js' }, { id: 'linkedfolder', entry: 'index.js' }] }))
write(fixture, 'instance/dashboard/modules/demo/index.js', 'export function mount(el) { el.textContent = "demo" }\n')
write(fixture, 'instance/dashboard/modules/demo/data.json', '{"sample": true}\n')
write(fixture, 'instance/dashboard/modules/undeclared/x.js', `export const leak = "${SENTINEL}"\n`)
write(scratch, 'outside/secret.js', `export const leak = "${OUTSIDE}"\n`)
write(scratch, 'outside/index.js', `export const leak = "${OUTSIDE}"\n`)
fs.symlinkSync(path.join(scratch, 'outside', 'secret.js'), path.join(fixture, 'instance/dashboard/modules/demo/linked.js'))
fs.symlinkSync(path.join(scratch, 'outside'), path.join(fixture, 'instance/dashboard/modules/linkedfolder'))

// ------------------------------------------------------------- helpers

const seenHeaders = []
const NONCE_HEADER = 'X-Home-Base-Token'

async function freePort() {
  for (;;) {
    const port = await new Promise((resolve) => {
      const probe = net.createServer()
      probe.listen(0, '127.0.0.1', () => { const { port: chosen } = probe.address(); probe.close(() => resolve(chosen)) })
    })
    if (portAllowed(port)) return port
  }
}

// Resolves with the running child once it prints its address; rejects with
// the exit code and output if it stops instead. `child.output()` returns
// everything it printed so far.
function startServer(args) {
  const child = spawn(process.execPath, [path.join(dashboardDir, 'serve.mjs'), ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.output = () => output
  return new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => { output += chunk; if (output.includes('Press Ctrl+C')) resolve(child) })
    child.stderr.on('data', (chunk) => { output += chunk })
    child.on('exit', (code) => reject(Object.assign(new Error(`exited ${code}: ${output}`), { code, output })))
  })
}

// Runs the launcher to completion and returns its exit code and output.
function runLauncher(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(dashboardDir, 'serve.mjs'), ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })
    child.on('exit', (code) => resolve({ code, output }))
  })
}

const keyFrom = (output) => output.match(/#key=([A-Za-z0-9_-]{43})/)?.[1]

test('an older Node.js gets a plain refusal before any dashboard code loads', async () => {
  // Pretend to be Node 18 before serve.mjs runs.
  const olderNode = 'data:text/javascript,Object.defineProperty(process.versions,"node",{value:"18.20.4"})'
  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', olderNode, path.join(dashboardDir, 'serve.mjs'), '--help'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })
    child.on('exit', (code) => resolve({ code, output }))
  })
  assert.equal(result.code, 2)
  assert.match(result.output, /needs Node\.js 20 or later; this computer has Node\.js 18\.20\.4\. Install the current LTS version from https:\/\/nodejs\.org/)
  assert.doesNotMatch(result.output, /Usage:|at file:/, 'no usage text and no stack trace')
})

async function signIn(port, key) {
  const session = await request(port, { pathname: '/session', headers: { 'sec-fetch-site': 'same-origin', 'x-home-base-key': key } })
  assert.equal(session.status, 204)
  return session.headers['set-cookie'][0].split(';')[0]
}

function request(port, { method = 'GET', pathname = '/', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: pathname, agent: false, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => { seenHeaders.push(res.headers); resolve({ status: res.statusCode, headers: res.headers, body }) })
    })
    req.on('error', reject)
    req.end()
  })
}

const api = (port, pathname, extra = {}) => request(port, { pathname, headers: { cookie, 'x-home-base-token': nonce, 'sec-fetch-site': 'same-origin', ...extra } })
const signedIn = (port, pathname = '/', extra = {}) => request(port, { pathname, headers: { cookie, ...extra } })
const HELP_TITLE = 'Open your Home Base dashboard'

// Raw bytes on the socket, for inputs Node's client refuses to send.
function raw(port, bytes) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1')
    const chunks = []
    socket.on('data', (chunk) => chunks.push(chunk))
    socket.on('end', () => {
      const text = Buffer.concat(chunks).toString('latin1')
      const [head, ...rest] = text.split('\r\n\r\n')
      const lines = head.split('\r\n')
      const headers = Object.fromEntries(lines.slice(1).map((line) => [line.slice(0, line.indexOf(':')).toLowerCase(), line.slice(line.indexOf(':') + 1).trim()]))
      seenHeaders.push(headers)
      resolve({ status: Number(lines[0].split(' ')[1]), headers, body: rest.join('\r\n\r\n') })
    })
    socket.on('error', reject)
    socket.end(bytes)
  })
}

const rawGet = (port, target, headerLines, extraBytes = Buffer.alloc(0)) => raw(port, Buffer.concat([
  Buffer.from(`GET ${target} HTTP/1.1\r\n${headerLines.map((line) => `${line}\r\n`).join('')}Connection: close\r\n`, 'latin1'),
  extraBytes,
  Buffer.from('\r\n', 'latin1'),
]))

let port
let server
let nonce
let key
let cookie
before(async () => {
  port = await freePort()
  server = await startServer(['--home-base', fixture, '--port', String(port)])
  key = keyFrom(server.output())
  cookie = await signIn(port, key)
  const page = await signedIn(port)
  nonce = page.body.match(/name="home-base-token" content="([^"]+)"/)[1]
})
after(() => {
  server?.kill()
  fs.rmSync(scratch, { recursive: true, force: true })
})

// ---------------------------------------------------- server hardening

test('serves the page only with the sign-in cookie, with a launch nonce meta tag and strict CSP', async () => {
  const page = await signedIn(port)
  assert.equal(page.status, 200)
  assert.match(nonce, /^[A-Za-z0-9_-]{43}$/)
  assert.match(page.body, /name="home-base-db" content="home-base-[0-9a-f]{12}"/)
  assert.ok(!page.body.includes('__HOME_BASE_'), 'placeholders are filled')
  assert.match(page.headers['content-security-policy'], /default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'/)
  assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/)
  assert.equal(page.headers['x-frame-options'], 'DENY')
  assert.equal(page.headers['cache-control'], 'no-store')
  assert.equal(page.headers['set-cookie'], undefined)
  const again = await signedIn(port)
  assert.ok(again.body.includes(nonce), 'one nonce per launch')
  for (const pathname of ['/app/main.js', '/app/styles.css', '/api/status', '/instance-modules/demo/index.js']) {
    const refused = await request(port, { pathname, headers: { 'x-home-base-token': nonce, 'sec-fetch-site': 'same-origin' } })
    assert.equal(refused.status, 403, `${pathname} needs the cookie`)
    assert.equal(refused.body, 'no-session')
  }
  for (const wrong of [`hb_${port}=${'x'.repeat(43)}`, `hb_${port + 1}=${cookieValueFor(key)}`, `${cookie}; ${cookie}`, `hb_${port}=${key}`]) {
    assert.equal((await api(port, '/api/status', { cookie: wrong })).status, 403, wrong.slice(0, 12))
  }
})

test('trades the per-install key for an HttpOnly, SameSite=Strict cookie, never echoing the key', async () => {
  const session = await request(port, { pathname: '/session', headers: { 'sec-fetch-site': 'same-origin', 'x-home-base-key': key } })
  assert.equal(session.status, 204)
  const [setCookie] = session.headers['set-cookie']
  const parts = setCookie.split(';').map((part) => part.trim())
  assert.equal(parts[0], `hb_${port}=${cookieValueFor(key)}`)
  assert.ok(!setCookie.includes(key), 'the cookie is derived from the key, not the key itself')
  assert.deepEqual(parts.slice(1).sort(), ['HttpOnly', `Max-Age=${COOKIE_MAX_AGE}`, 'Path=/', 'SameSite=Strict'])
  assert.ok(!/secure/i.test(setCookie), 'no Secure flag: browsers refuse Secure cookies over http://127.0.0.1 in Safari')
  assert.equal((await request(port, { pathname: '/session', headers: { 'sec-fetch-site': 'same-origin', 'x-home-base-key': key.slice(0, -1) } })).body, 'bad-key')
  assert.equal((await request(port, { pathname: '/session', headers: { 'sec-fetch-site': 'same-origin' } })).status, 403)
  const old = await request(port, { pathname: '/session', headers: { 'x-home-base-key': key } })
  assert.deepEqual([old.status, old.body], [403, 'no-fetch-metadata'], 'browsers without fetch metadata get a specific reason')
  assert.equal((await request(port, { pathname: '/session', headers: { 'sec-fetch-site': 'cross-site', 'x-home-base-key': key } })).status, 403)
  assert.equal((await request(port, { pathname: `/session?key=${key}`, headers: { 'sec-fetch-site': 'same-origin' } })).status, 403, 'a key in the query is ignored')
  const launch = server.output()
  assert.equal(launch.split(key).length - 1, 1, 'the launcher prints the key once, in the address')
  assert.match(launch, new RegExp(`^  http://127\\.0\\.0\\.1:${port}/#key=${key}$`, 'm'))
  const saved = fs.statSync(path.join(fixture, IDENTITY_FILE))
  assert.equal(saved.mode & 0o777, 0o600)
})

test('refused page loads get a static help page with no data, no key, and no nonce', async () => {
  const cases = [
    { headers: {} },
    { headers: { cookie: `hb_${port}=wrong` } },
    { headers: { cookie, 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' } },
    { headers: { cookie, 'sec-fetch-site': 'same-site' } },
    { headers: { cookie, origin: 'https://evil.example' } },
    { headers: { cookie, host: `localhost:${port}` }, wrongHost: true },
    { headers: { cookie, host: `127.0.0.1.:${port}` }, wrongHost: true },
    { headers: { cookie, host: 'evil.example' }, wrongHost: true },
  ]
  for (const { headers, wrongHost } of cases) {
    const help = await request(port, { headers })
    const label = JSON.stringify(headers).slice(0, 80)
    assert.equal(help.status, 200, label)
    assert.match(help.headers['content-type'], /^text\/html/)
    assert.ok(help.body.includes(HELP_TITLE), label)
    assert.ok(help.body.includes(`http://127.0.0.1:${port}/`), 'names the exact address')
    assert.ok(help.body.includes('node system/dashboard/serve.mjs'), 'says how to get the address again')
    for (const secret of [SENTINEL, 'Lake trip', 'Weekly review', 'Claude Code', nonce, key, cookieValueFor(key), 'home-base-token', 'home-base-db']) {
      assert.ok(!help.body.includes(secret), `${label} carries no ${secret.slice(0, 12)}`)
    }
    assert.equal(help.headers['set-cookie'], undefined)
    assert.match(help.headers['content-security-policy'], /default-src 'none'/)
    assert.match(help.headers['content-security-policy'], wrongHost ? /script-src 'none'/ : /script-src 'sha256-[A-Za-z0-9+/=]+'/)
    assert.equal(help.body.includes('<script>'), !wrongHost, 'only the right address runs the sign-in script')
    assert.equal(help.headers['x-home-base-instance'] !== undefined, !wrongHost, 'no stable instance tag for another Host')
  }
  assert.ok((await request(port, { headers: { 'sec-fetch-site': 'none' } })).body.includes(HELP_TITLE), 'a typed address without the cookie')
})

test('rejects every Host but the exact 127.0.0.1:<port>, including localhost and [::1]', async () => {
  for (const host of [`localhost:${port}`, `[::1]:${port}`, `127.0.0.1:${port + 1}`, '127.0.0.1', 'evil.example', `evil.example:${port}`, `127.0.0.1:${port}.evil.example`, `127.0.0.1:0${port}`, `LOCALHOST:${port}`]) {
    const response = await request(port, { pathname: '/api/status', headers: { host, cookie, 'x-home-base-token': nonce, 'sec-fetch-site': 'same-origin' } })
    assert.equal(response.status, 421, host)
    assert.ok(!response.body.includes('setup'), host)
  }
  const page = await request(port, { headers: { host: `localhost:${port}`, cookie } })
  assert.ok(page.body.includes(HELP_TITLE), 'a page load on another Host gets the help page')
  assert.ok(!page.body.includes(nonce), 'the nonce is never served to another Host')
  assert.equal((await request(port, { pathname: '/app/main.js', headers: { host: `localhost:${port}`, cookie } })).status, 421)
  const noHost = await raw(port, Buffer.from('GET / HTTP/1.0\r\n\r\n', 'latin1'))
  assert.ok(noHost.body.includes(HELP_TITLE) && !noHost.body.includes(nonce), 'a page load without a Host gets only the help page')
  const noHostApi = await raw(port, Buffer.from(`GET /api/status HTTP/1.0\r\nCookie: ${cookie}\r\n\r\n`, 'latin1'))
  assert.ok([400, 421].includes(noHostApi.status))
})

test('accepts GET only: POST, PUT, DELETE, PATCH, HEAD, and OPTIONS get 405', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']) {
    for (const pathname of ['/', '/api/status']) {
      const response = await request(port, { method, pathname, headers: { cookie, 'x-home-base-token': nonce, 'sec-fetch-site': 'same-origin', origin: `http://127.0.0.1:${port}` } })
      assert.equal(response.status, 405, `${method} ${pathname}`)
      assert.equal(response.headers.allow, 'GET')
    }
  }
})

test('a CORS preflight gets 405 and no access-control headers', async () => {
  const preflight = await request(port, {
    method: 'OPTIONS',
    pathname: '/api/status',
    headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET', 'access-control-request-headers': 'x-home-base-token', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors' },
  })
  assert.equal(preflight.status, 405)
  assert.deepEqual(Object.keys(preflight.headers).filter((name) => name.startsWith('access-control-')), [])
})

test('requires the launch nonce on the JSON endpoints', async () => {
  const missing = await request(port, { pathname: '/api/status', headers: { cookie, 'sec-fetch-site': 'same-origin' } })
  assert.deepEqual([missing.status, missing.body], [401, 'stale-page'])
  assert.equal((await api(port, '/api/status', { 'x-home-base-token': '' })).status, 401)
  assert.equal((await api(port, '/api/status', { 'x-home-base-token': 'x'.repeat(nonce.length) })).status, 401)
  assert.equal((await api(port, '/api/status', { 'x-home-base-token': nonce.slice(0, -1) })).status, 401)
  assert.equal((await api(port, '/api/status', { 'x-home-base-token': `${nonce}x` })).status, 401)
  assert.equal((await api(port, '/api/status', { 'x-home-base-token': `${nonce}, ${nonce}` })).status, 401)
  assert.equal((await api(port, '/api/status', { 'x-home-base-token': 'a'.repeat(4000) })).status, 401)
  assert.equal((await request(port, { pathname: '/api/modules', headers: { cookie: `${cookie}; t=${nonce}`, 'sec-fetch-site': 'same-origin' } })).status, 401)
  const queryName = 'token'
  assert.equal((await request(port, { pathname: `/api/status?${queryName}=${nonce}`, headers: { cookie, 'sec-fetch-site': 'same-origin' } })).status, 401)
  assert.equal((await api(port, '/api/status')).status, 200)
})

test('compares multi-byte nonces by bytes without failing', async () => {
  const head = [`Host: 127.0.0.1:${port}`, 'Sec-Fetch-Site: same-origin', `Cookie: ${cookie}`]
  const sameBytes = Buffer.concat([Buffer.from('X-Home-Base-Token: ', 'latin1'), Buffer.from(`é${nonce.slice(2)}`, 'utf8'), Buffer.from('\r\n', 'latin1')])
  assert.equal(Buffer.byteLength(`é${nonce.slice(2)}`), Buffer.byteLength(nonce), 'same byte length, different character length')
  const sameChars = Buffer.concat([Buffer.from('X-Home-Base-Token: ', 'latin1'), Buffer.from(`é${nonce.slice(1)}`, 'utf8'), Buffer.from('\r\n', 'latin1')])
  const emoji = Buffer.concat([Buffer.from('X-Home-Base-Token: ', 'latin1'), Buffer.from(`${nonce}😀`, 'utf8'), Buffer.from('\r\n', 'latin1')])
  for (const header of [sameBytes, sameChars, emoji]) {
    const response = await rawGet(port, '/api/status', head, header)
    assert.ok([400, 401].includes(response.status), `status ${response.status}`)
    assert.ok(!response.body.includes('setup'))
    assert.doesNotMatch(response.body, /\n\s+at |Error:/)
  }
  assert.equal((await api(port, '/api/status')).status, 200, 'the server is still up')
})

test('refuses cross-site fetch metadata and foreign origins', async () => {
  for (const site of ['cross-site', 'same-site', 'none']) {
    assert.equal((await api(port, '/api/status', { 'sec-fetch-site': site })).status, 403, site)
  }
  const missing = await request(port, { pathname: '/api/status', headers: { cookie, 'x-home-base-token': nonce } })
  assert.deepEqual([missing.status, missing.body], [403, 'no-fetch-metadata'], 'the JSON endpoints need same-origin fetch metadata')
  assert.equal((await api(port, '/api/status', { origin: 'https://evil.example' })).status, 403)
  assert.equal((await api(port, '/api/status', { origin: 'null' })).status, 403)
  const crossSite = await signedIn(port, '/', { 'sec-fetch-site': 'cross-site' })
  assert.ok(crossSite.body.includes(HELP_TITLE) && !crossSite.body.includes(nonce), 'a cross-site navigation gets the help page')
  assert.equal((await signedIn(port, '/app/main.js', { 'sec-fetch-site': 'cross-site' })).status, 403)
  const typed = await signedIn(port, '/', { 'sec-fetch-site': 'none' })
  assert.ok(typed.body.includes(nonce), 'a typed address works')
})

test('returns only allowlisted setup fields and linked index names, never bodies', async () => {
  const response = await api(port, '/api/status')
  const status = JSON.parse(response.body)
  assert.ok(!response.body.includes(SENTINEL), 'no file bodies, unlinked text, or other frontmatter keys')
  assert.deepEqual(status.setup, { status: 'in_progress', stage: 'orient', discoveryPath: 'personal', orientationCompleted: 3, nextQuestion: 'proof' })
  assert.deepEqual(status.projects.active, ['Lake trip'])
  assert.deepEqual(status.systems, { active: ['Weekly review'], building: ['Packing list'], designing: [] })
  assert.deepEqual(status.assistants, [
    { name: 'Claude Code', reach: 'opens', state: 'verified', checked: '2026-10-12' },
    { name: 'Codex', reach: 'opens', state: 'unverified', checked: null },
    { name: 'Phone assistant', reach: 'reaches', state: 'blocked', checked: '2026-10-08' },
  ])
  assert.deepEqual(status.skills, { repository: 3, user: 1 })
  assert.deepEqual(status.unlinked, { projects: 2, systems: 1, skills: 1, assistants: 1 }, 'unlinked entries are counted, never shown')
  assert.deepEqual(status.adapters, { agentsMd: true, claudeMd: true, agentsSkills: true, claudeSkills: true })
  assert.match(response.headers['content-type'], /^application\/json/)
})

test('never serves Home Base files and blocks traversal', async () => {
  const targets = [
    '/you/ABOUT.md', '/work/PEOPLE.md', '/memory/MEMORY.md', '/you/SETUP.md', '/index.html', '/app/index.html',
    '/app/../you/ABOUT.md', '/app/%2e%2e/you/ABOUT.md', '/app/..%2f..%2fyou%2fABOUT.md', '/app/%2e%2e%2f%2e%2e%2fyou%2fABOUT.md',
    '/app/..\\..\\you\\ABOUT.md', '/instance-modules/demo/..%2f..%2f..%2f..%2fyou%2fABOUT.md', '/instance-modules/demo/../../../../you/ABOUT.md',
    '/instance-modules/demo/linked.js', '/instance-modules/..%2f/index.js', '/instance-modules/demo/modules.json',
    '/%2e%2e/%2e%2e/etc/passwd', '//etc/passwd', '/.home-base/state/dashboard.json', '/.git/config',
  ]
  for (const pathname of targets) {
    const response = await request(port, { pathname, headers: { cookie, 'x-home-base-token': nonce, 'sec-fetch-site': 'same-origin' } })
    assert.ok([400, 404].includes(response.status), `${pathname} -> ${response.status}`)
    assert.ok(!response.body.includes(SENTINEL) && !response.body.includes(OUTSIDE), pathname)
  }
  const absoluteForm = await rawGet(port, `http://evil.example/api/status`, [`Host: 127.0.0.1:${port}`, 'Sec-Fetch-Site: same-origin', `Cookie: ${cookie}`, `${NONCE_HEADER}: ${nonce}`])
  assert.equal(absoluteForm.status, 400, 'absolute-form request targets are refused')
  const asterisk = await rawGet(port, '*', [`Host: 127.0.0.1:${port}`])
  assert.ok([400, 404].includes(asterisk.status))
})

test('serves declared instance modules only to signed-in same-origin requests, never through links', async () => {
  const modules = JSON.parse((await api(port, '/api/modules')).body)
  assert.deepEqual(modules.modules, [{ id: 'demo', title: 'Demo', url: '/instance-modules/demo/index.js' }])
  const moduleRequest = (pathname, headers) => request(port, { pathname, headers: { cookie, 'sec-fetch-site': 'same-origin', ...headers } })
  assert.equal((await signedIn(port, '/instance-modules/demo/index.js')).status, 403, 'no fetch metadata')
  assert.equal((await moduleRequest('/instance-modules/demo/index.js', { 'sec-fetch-site': 'cross-site' })).status, 403)
  const noCookie = await request(port, { pathname: '/instance-modules/demo/index.js', headers: { 'sec-fetch-site': 'same-origin' } })
  assert.deepEqual([noCookie.status, noCookie.body], [403, 'no-session'], 'a module needs the cookie')
  const data = await request(port, { pathname: '/instance-modules/demo/data.json', headers: { 'sec-fetch-site': 'same-origin' } })
  assert.equal(data.status, 403, 'module data needs the cookie')
  const ok = await moduleRequest('/instance-modules/demo/index.js')
  assert.equal(ok.status, 200)
  assert.match(ok.headers['content-type'], /text\/javascript/)
  assert.equal((await moduleRequest('/instance-modules/demo/data.json')).status, 200)
  for (const pathname of ['/instance-modules/demo/linked.js', '/instance-modules/undeclared/x.js', '/instance-modules/linkedfolder/index.js', '/instance-modules/linkedfolder/secret.js']) {
    const refused = await moduleRequest(pathname)
    assert.equal(refused.status, 404, pathname)
    assert.ok(!refused.body.includes(OUTSIDE) && !refused.body.includes(SENTINEL), pathname)
  }
})

test('malformed requests and internal errors return short messages, never stack traces', async () => {
  const garbage = await raw(port, Buffer.from('NOT HTTP AT ALL\r\n\r\n', 'latin1'))
  assert.equal(garbage.status, 400)
  assert.equal(garbage.body, '')
  const withBody = await raw(port, Buffer.from(`GET / HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello`, 'latin1'))
  assert.equal(withBody.status, 400)

  // An in-process server with an unusable root: reading status throws inside
  // the handler, and the client sees only a generic 500.
  const brokenPort = await freePort()
  const brokenKey = newKey()
  const { server: broken } = createDashboardServer({ root: 42, port: brokenPort, dbName: 'home-base-000000000000', distDir, key: brokenKey })
  await new Promise((resolve) => broken.listen({ port: brokenPort, host: '127.0.0.1', exclusive: true }, resolve))
  try {
    const brokenCookie = await signIn(brokenPort, brokenKey)
    const brokenNonce = (await request(brokenPort, { headers: { cookie: brokenCookie } })).body.match(/name="home-base-token" content="([^"]+)"/)[1]
    const failed = await request(brokenPort, { pathname: '/api/status', headers: { cookie: brokenCookie, 'x-home-base-token': brokenNonce, 'sec-fetch-site': 'same-origin' } })
    assert.equal(failed.status, 500)
    assert.equal(failed.body, 'Internal error')
  } finally {
    broken.close()
  }
})

test('refuses a port another program answers on, including a wildcard listener', async () => {
  for (const host of ['127.0.0.1', '0.0.0.0', '::']) {
    const busy = await freePort()
    const blocker = net.createServer().listen({ port: busy, host })
    await new Promise((resolve, reject) => { blocker.once('listening', resolve); blocker.once('error', reject) })
    try {
      const { code, output } = await runLauncher(['--home-base', fixture, '--port', String(busy)])
      assert.equal(code, 3, `${host}: ${output}`)
      assert.match(output, /another program is already using port/)
      assert.match(output, /serve\.mjs --port \d{5}/, 'suggests a saved --port')
      assert.ok(!output.includes(key), 'never prints the key to another program on the port')
    } finally {
      blocker.close()
    }
  }
})

test('a second launch while running prints the same address instead of failing', async () => {
  const { code, output } = await runLauncher(['--home-base', fixture, '--port', String(port)])
  assert.equal(code, 0, output)
  assert.match(output, /already running/)
  assert.equal(keyFrom(output), key)
  assert.equal((await signedIn(port)).status, 200, 'the running dashboard is untouched')
})

test('--port is saved for next time, and folders that are not a Home Base are refused before writing', async () => {
  const home = path.join(scratch, 'port-home')
  write(home, 'AGENTS.md', '# Agents\n')
  write(home, 'you/SETUP.md', '---\nsetup_status: not_started\n---\n')
  const chosen = await freePort()
  const child = await startServer(['--home-base', home, '--port', String(chosen)])
  try {
    assert.match(child.output(), new RegExp(`Saved port ${chosen}`))
  } finally {
    child.kill()
    await new Promise((resolve) => child.once('exit', resolve))
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, IDENTITY_FILE), 'utf8')).port, chosen)
  const again = await startServer(['--home-base', home])
  try {
    assert.ok(again.output().includes(`http://127.0.0.1:${chosen}/#key=`), 'the saved port is used without --port')
  } finally {
    again.kill()
    await new Promise((resolve) => again.once('exit', resolve))
  }

  for (const [name, files] of [['not-home-a', ['README.md']], ['not-home-b', ['AGENTS.md']], ['not-home-c', ['you/SETUP.md']]]) {
    const folder = path.join(scratch, name)
    for (const file of files) write(folder, file, 'x\n')
    const { code, output } = await runLauncher(['--home-base', folder])
    assert.equal(code, 2, output)
    assert.match(output, /not a Home Base/)
    assert.ok(!fs.existsSync(path.join(folder, '.home-base')), 'nothing written')
  }
})

test('a permission error says so and how to run it outside a sandbox', async (t) => {
  if (process.getuid?.() === 0) return t.skip('root ignores folder permissions')
  const home = path.join(scratch, 'locked-home')
  write(home, 'AGENTS.md', '# Agents\n')
  write(home, 'you/SETUP.md', '---\nsetup_status: not_started\n---\n')
  fs.mkdirSync(path.join(home, '.home-base', 'state'), { recursive: true })
  fs.chmodSync(path.join(home, '.home-base', 'state'), 0o500)
  try {
    const { code, output } = await runLauncher(['--home-base', home])
    assert.equal(code, 2, output)
    assert.match(output, /permission denied/)
    assert.match(output, /run it yourself in a Terminal window/)
  } finally {
    fs.chmodSync(path.join(home, '.home-base', 'state'), 0o700)
  }
})

test('--new-key replaces the key, and old sign-ins stop working', async () => {
  const home = path.join(scratch, 'rekey-home')
  write(home, 'AGENTS.md', '# Agents\n')
  write(home, 'you/SETUP.md', '---\nsetup_status: not_started\n---\n')
  const first = loadIdentity(resolveHomeBase(home))
  const child = await startServer(['--home-base', home, '--port', String(await freePort()), '--new-key'])
  child.kill()
  const rotated = JSON.parse(fs.readFileSync(path.join(home, IDENTITY_FILE), 'utf8'))
  assert.notEqual(rotated.key, first.key)
  assert.equal(rotated.dbName, first.dbName, 'the browser database stays')
  assert.notEqual(cookieValueFor(rotated.key), cookieValueFor(first.key))
})

test('refuses the protected ports and unknown arguments', async () => {
  for (const reserved of ['4173', '5173', '80', '70000', 'abc']) {
    await assert.rejects(startServer(['--home-base', fixture, '--port', reserved]), (error) => error.code === 2 && /Choose a whole number from 1024 to 65535 other than 3000, 4173, 5000, 5173, 8000, 8080, 8888/.test(error.output), reserved)
  }
  await assert.rejects(startServer(['--home-base', fixture, '--host', '0.0.0.0']), (error) => error.code === 2)
  await assert.rejects(startServer(['--home-base', path.join(scratch, 'missing')]), (error) => error.code === 2)
})

test('no response ever carried a CORS header', () => {
  assert.ok(seenHeaders.length > 50)
  for (const headers of seenHeaders) {
    assert.deepEqual(Object.keys(headers).filter((name) => name.toLowerCase().startsWith('access-control-')), [])
  }
})

// -------------------------------------------------- identity and ports

test('derived ports are never 4173, 5173, or another blocked port', () => {
  assert.ok(BLOCKED_PORTS.has(4173) && BLOCKED_PORTS.has(5173))
  assert.equal(portAllowed(4173), false)
  assert.equal(portAllowed(5173), false)
  for (let index = 0; index < 20000; index += 1) {
    const { port: derived, dbName } = deriveIdentity(`seed-${index}`)
    assert.ok(portAllowed(derived) && derived >= 20000 && derived < 40010, String(derived))
    assert.match(dbName, /^home-base-[0-9a-f]{12}$/)
  }
})

test('identity is saved at first launch and survives init; a copied folder gets its own', () => {
  const first = path.join(scratch, 'identity-a')
  fs.mkdirSync(first)
  const root = resolveHomeBase(first)
  const created = loadIdentity(root)
  assert.equal(created.persisted, false)
  const saved = JSON.parse(fs.readFileSync(path.join(root, '.home-base/state/dashboard.json'), 'utf8'))
  assert.equal(saved.port, created.port)
  assert.ok(!JSON.stringify(saved).includes(root), 'the folder path itself is not stored')
  assert.match(saved.key, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(created.key, saved.key)
  assert.equal(fs.statSync(path.join(root, IDENTITY_FILE)).mode & 0o777, 0o600)
  const unsalted = crypto.createHash('sha256').update(`home-base-root:${root}`).digest('hex')
  assert.ok(!unsalted.startsWith(saved.rootFingerprint) && saved.rootFingerprint.length === 32, 'the fingerprint is salted with the key')
  write(root, '.home-base/state/update-state.json', JSON.stringify({ installationId: '6f1c2b8e-1d2a-4c3b-9e8f-0a1b2c3d4e5f' }))
  const reopened = loadIdentity(root)
  assert.equal(reopened.persisted, true)
  assert.equal(reopened.port, created.port, 'init does not move the port')
  assert.equal(reopened.dbName, created.dbName, 'init does not move the browser database')
  assert.equal(reopened.key, created.key, 'the key is kept')
  const copy = path.join(scratch, 'identity-copy')
  fs.cpSync(first, copy, { recursive: true })
  const copied = loadIdentity(resolveHomeBase(copy))
  assert.equal(copied.persisted, false)
  assert.notEqual(copied.dbName, created.dbName, 'a copied folder gets its own database name')
  assert.notEqual(copied.key, created.key, 'and its own key')

  // A 1.1.0-dev.2 file (unsalted fingerprint, no key) keeps its port and
  // database, gains a key, and is tightened to 0600.
  const legacy = path.join(scratch, 'identity-legacy')
  fs.mkdirSync(path.join(legacy, '.home-base', 'state'), { recursive: true })
  const legacyRoot = resolveHomeBase(legacy)
  const legacyFile = path.join(legacyRoot, IDENTITY_FILE)
  fs.writeFileSync(legacyFile, JSON.stringify({ schemaVersion: 1, rootFingerprint: crypto.createHash('sha256').update(`home-base-root:${legacyRoot}`).digest('hex').slice(0, 16), port: 23456, dbName: 'home-base-abcdefabcdef' }), { mode: 0o644 })
  const upgraded = loadIdentity(legacyRoot)
  assert.deepEqual([upgraded.port, upgraded.dbName, upgraded.persisted], [23456, 'home-base-abcdefabcdef', true])
  assert.equal(JSON.parse(fs.readFileSync(legacyFile, 'utf8')).key, upgraded.key)
  assert.equal(fs.statSync(legacyFile).mode & 0o777, 0o600)
})

test('identity refuses linked state folders and never writes through a link', () => {
  const linkedState = path.join(scratch, 'identity-linked')
  fs.mkdirSync(path.join(linkedState, '.home-base'), { recursive: true })
  fs.mkdirSync(path.join(scratch, 'elsewhere-state'))
  fs.symlinkSync(path.join(scratch, 'elsewhere-state'), path.join(linkedState, '.home-base', 'state'))
  assert.throws(() => loadIdentity(resolveHomeBase(linkedState)))
  assert.deepEqual(fs.readdirSync(path.join(scratch, 'elsewhere-state')), [])

  const linkedFile = path.join(scratch, 'identity-linked-file')
  fs.mkdirSync(path.join(linkedFile, '.home-base', 'state'), { recursive: true })
  const target = path.join(scratch, 'elsewhere.json')
  fs.writeFileSync(target, JSON.stringify({ schemaVersion: 1, rootFingerprint: 'x', port: 4173, dbName: 'home-base-aaaaaaaaaaaa' }))
  fs.symlinkSync(target, path.join(linkedFile, '.home-base', 'state', 'dashboard.json'))
  const identity = loadIdentity(resolveHomeBase(linkedFile))
  assert.notEqual(identity.port, 4173)
  assert.match(fs.readFileSync(target, 'utf8'), /"port":4173/, 'the link target is untouched')
  assert.equal(fs.lstatSync(path.join(linkedFile, '.home-base', 'state', 'dashboard.json')).isSymbolicLink(), false)
})

// ------------------------------------------------------ status parsing

test('symlinked or hard-linked indexes and adapters are never read', () => {
  const root = path.join(scratch, 'linked-home')
  const outside = path.join(scratch, 'outside-home')
  write(outside, 'capabilities/INDEX.md', `## Available and verified\n\n- [Leaky ${OUTSIDE} opens Home Base](x.md) — checked 2026-10-01\n`)
  write(outside, 'projects/INDEX.md', `## Active\n\n- [${OUTSIDE}](x.md)\n`)
  write(outside, 'skills/INDEX.md', `## Active\n\n- [${OUTSIDE}](x/SKILL.md)\n`)
  write(outside, 'claude-skills/one/SKILL.md', 'x')
  write(outside, 'AGENTS.md', '# outside\n')
  write(root, 'you/SETUP.md', '---\nsetup_status: complete\nstage: complete\n---\n')
  fs.mkdirSync(path.join(root, 'capabilities'))
  fs.symlinkSync(path.join(outside, 'capabilities', 'INDEX.md'), path.join(root, 'capabilities', 'INDEX.md'))
  fs.symlinkSync(path.join(outside, 'projects'), path.join(root, 'projects'))
  fs.mkdirSync(path.join(root, 'skills'))
  fs.linkSync(path.join(outside, 'skills', 'INDEX.md'), path.join(root, 'skills', 'INDEX.md'))
  fs.mkdirSync(path.join(root, '.claude'))
  fs.symlinkSync(path.join(outside, 'claude-skills'), path.join(root, '.claude', 'skills'))
  fs.symlinkSync(path.join(outside, 'AGENTS.md'), path.join(root, 'AGENTS.md'))
  const status = readStatus(resolveHomeBase(root))
  assert.ok(!JSON.stringify(status).includes(OUTSIDE))
  assert.deepEqual(status.assistants, [])
  assert.deepEqual(status.projects.active, [])
  assert.equal(status.skills.user, 0)
  assert.equal(status.skills.repository, 0)
  assert.equal(status.adapters.agentsMd, false)
  assert.equal(status.adapters.claudeSkills, false)
  assert.equal(status.setup.status, 'complete')
})

test('a fresh folder reports setup not started and no names', () => {
  const root = path.join(scratch, 'fresh-home')
  write(root, 'you/SETUP.md', '---\nsetup_status: not_started\ndiscovery_path: none\nstage: orient\norientation_completed: 0\nnext_question: scope\n---\n')
  for (const file of ['projects/INDEX.md', 'systems/INDEX.md', 'capabilities/INDEX.md', 'skills/INDEX.md']) write(root, file, '## Active\n\nNone.\n')
  const status = readStatus(resolveHomeBase(root))
  assert.equal(status.setup.status, 'not_started')
  assert.equal(status.setup.nextQuestion, 'scope')
  assert.deepEqual([status.projects.active, status.systems.active, status.assistants], [[], [], []])
  assert.deepEqual(readInstanceModules(resolveHomeBase(root)), [])
})

test('a byte-order mark does not hide setup notes or index entries', () => {
  const root = path.join(scratch, 'bom-home')
  write(root, 'you/SETUP.md', '\uFEFF---\nsetup_status: in_progress\nstage: opportunity_map\n---\n')
  write(root, 'projects/INDEX.md', '\uFEFF## Active\n\n- [Lake trip](lake-trip.md)\n')
  write(root, 'capabilities/INDEX.md', '\uFEFF## Available and verified\n\n- [Codex opens Home Base directly](codex.md) — reads AGENTS.md; checked 2026-10-12\n')
  const status = readStatus(resolveHomeBase(root))
  assert.deepEqual([status.setup.status, status.setup.stage], ['in_progress', 'opportunity_map'])
  assert.deepEqual(status.projects.active, ['Lake trip'])
  assert.equal(status.assistants[0]?.state, 'verified')
  assert.equal(parseSetup('\uFEFF---\nsetup_status: complete\n---\n').status, 'complete')
})

test('instance modules load side by side with a time limit', () => {
  const main = fs.readFileSync(path.join(distDir, 'main.js'), 'utf8')
  assert.match(main, /Promise\.allSettled\(modules\.map/)
  assert.match(main, /withTimeout\(import\(module\.url\), MODULE_TIMEOUT_MS\)/)
  assert.match(main, /const MODULE_TIMEOUT_MS = 8000/)
})

test('setup parsing keeps only known values', () => {
  assert.deepEqual(parseSetup('---\nsetup_status: done\nstage: anything\norientation_completed: 12\nnext_question: What is your salary?\n---\n'), { status: null, stage: null, discoveryPath: null, orientationCompleted: null, nextQuestion: null })
  assert.equal(parseSetup('---\nnext_question: favourite_colour\n---\n').nextQuestion, 'other')
  assert.equal(parseSetup('no frontmatter').status, null)
})

test('setup values allow quotes, trailing spaces, and comments', () => {
  const read = (text) => {
    const setup = parseSetup(text)
    return [setup.status, setup.stage, setup.discoveryPath, setup.orientationCompleted, setup.nextQuestion]
  }
  // Fictional notes only.
  assert.deepEqual(read('---\r\nsetup_status: "complete" \r\nstage: \'build\'\t\r\ndiscovery_path: work # Sam asked\r\norientation_completed: "4" # Jordan\r\nnext_question: proof\t# later\r\n---\r\n'), ['complete', 'build', 'work', 4, 'proof'])
  assert.deepEqual(read('---\nsetup_status: in_progress   # resumed\nstage: "blueprint" # Taylor\n---\n'), ['in_progress', 'blueprint', null, null, null])
  // Mismatched quotes, a `#` inside a word, and an empty value are refused.
  assert.deepEqual(read('---\nsetup_status: "complete\'\nstage: build#x\nnext_question: # nothing\n---\n'), [null, null, null, null, null])
  assert.equal(parseSetup('---\nnext_question: "What is #1 for Sam?"\n---\n').nextQuestion, null)
  // Long runs of spaces are read in linear time.
  const started = performance.now()
  assert.equal(parseSetup(`---\nsetup_status: a${' '.repeat(200000)}b\n---\n`).status, null)
  assert.ok(performance.now() - started < 2000, 'long spaces stay fast')
})

test('index parsing keeps linked local items only', () => {
  const sections = parseIndex([
    '## Active', '', 'None.', '- No tools recorded yet.', '- [Linked](a.md) — note', '* [Star](b.md)', '1. [Numbered](c.md)',
    '- [Web](https://example.com)', '- [Mail](mailto:someone@example.com)', '- [Absolute](/etc/passwd)', '- [Anchor](#x)',
    'A paragraph with [a link](d.md) is not a list item', '```', '- [Fenced](e.md)', '```', '| [Row](f.md) | x |',
  ].join('\n'))
  assert.deepEqual(sections.get('active').map((item) => item.name), ['Linked', 'Star', 'Numbered', 'Row'])
})

test('long names are shortened between characters and marked', () => {
  const nameOf = (text) => parseIndex(`## Active\n\n- [${text}](p.md)\n`).get('active')[0].name
  const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
  const exact = 'x'.repeat(80)
  assert.equal(nameOf(exact), exact)
  const emoji = nameOf(`${'x'.repeat(78)}\u{1F600}\u{1F600}tail`)
  assert.equal(emoji, `${'x'.repeat(78)}\u{1F600}\u2026`)
  assert.ok(!lone.test(emoji))
  const family = '\u{1F469}\u200D\u{1F467}\u200D\u{1F466}'
  assert.equal(nameOf(`${'y'.repeat(78)}${family}${'z'.repeat(5)}`), `${'y'.repeat(78)}${family}\u2026`)
  assert.equal(nameOf(`${'w'.repeat(78)}e\u0301e\u0301tail`), `${'w'.repeat(78)}e\u0301\u2026`)
  assert.equal(nameOf(`${'v'.repeat(78)} Sam Taylor`), `${'v'.repeat(78)}\u2026`)
  // A letter stacked with many combining marks ends the name.
  assert.equal(nameOf(`Sam${'\u0301'.repeat(150)}${'z'.repeat(40)}`), 'Sa\u2026')
})

test('unlinked entries in the shapes workflows used to write are counted, not shown', () => {
  const root = path.join(scratch, 'unlinked-home')
  write(root, 'you/SETUP.md', '---\nsetup_status: in_progress\nstage: blueprint\n---\n')
  write(root, 'skills/INDEX.md', `# Skill index\n\n## Active\n\n- Packing check — active — when packing — skills/packing-check/SKILL.md — 2026-10-01 ${SENTINEL}\n\n| Name | Status | Trigger | Path |\n|---|---|---|---|\n| Trip budget ${SENTINEL} | active | monthly | skills/trip-budget/SKILL.md |\n\n## Draft\n\nNo drafts.\n`)
  write(root, 'projects/INDEX.md', `## Active\n\nNo active projects yet.\n- None.\n- [Linked](linked.md)\n- Unlinked ${SENTINEL}\n`)
  write(root, 'systems/INDEX.md', `## Designing\n\n- Unlinked design ${SENTINEL}\n\n## Active\n\n- [Shown](s/BLUEPRINT.md)\n`)
  write(root, 'capabilities/INDEX.md', `## Available and verified\n\n- Codex opens Home Base directly — checked 2026-10-12 ${SENTINEL}\n- Browser control works ${SENTINEL}\n- [Claude Code opens Home Base directly](https://example.com/x) — checked 2026-10-12\n`)
  const status = readStatus(resolveHomeBase(root))
  assert.ok(!JSON.stringify(status).includes(SENTINEL), 'unlinked text never leaves')
  assert.deepEqual(status.unlinked, { projects: 1, systems: 0, skills: 2, assistants: 2 })
  assert.equal(status.skills.user, 0)
  assert.deepEqual(status.projects.active, ['Linked'])
  assert.deepEqual(status.assistants, [])
  assert.equal(copy.notShown(0), null)
  assert.equal(copy.notShown(1), '1 more entry not shown — add a link to show it.')
  assert.equal(copy.notShown(3), '3 more entries not shown — add a link to show them.')
})

test('the documented index line formats are the ones the dashboard reads', () => {
  const contract = fs.readFileSync(path.join(dashboardDir, '..', 'WORKSPACE-CONTRACT.md'), 'utf8')
  const line = contract.match(/`(- \[<Assistant> opens Home Base directly\]\(<file>\.md\) — <one line>; checked YYYY-MM-DD)`/)
  assert.ok(line, 'the contract defines the assistant line')
  const example = line[1].replace('<Assistant>', 'Codex').replace('<file>', 'codex').replace('<one line>', 'reads AGENTS.md').replace('YYYY-MM-DD', '2026-10-12')
  assert.deepEqual(parseAssistants(`## Available and verified\n\n${example}\n`), [{ name: 'Codex', reach: 'opens', state: 'verified', checked: '2026-10-12' }])
  for (const workflow of ['inspect-capabilities.md', 'build-a-skill.md', 'blueprint-a-system.md', 'start.md', 'build-a-system.md']) {
    const text = fs.readFileSync(path.join(dashboardDir, '..', 'workflows', workflow), 'utf8')
    assert.match(text, /linked\s+line/, `${workflow} asks for a linked index line`)
  }
  const template = fs.readFileSync(path.join(dashboardDir, '..', '..', 'templates', 'capability.md'), 'utf8')
  assert.ok(template.includes('opens Home Base directly](<file>.md) — <one line>; checked YYYY-MM-DD'))
})

test('assistant parsing reads state by section; verified needs a valid calendar date', () => {
  const assistants = parseAssistants([
    '## Available and verified',
    '- [Codex opens Home Base in this folder](c.md) — checked 2026-10-12',
    '- [**Claude Code** opens Home Base](c.md) checked 2026-13-01',
    '- [Grok opens Home Base directly](g.md) — checked 2026-13-45',
    '- [Gemini opens Home Base directly](g.md) — checked 2026-02-30',
    '- [Cursor opens Home Base directly](u.md) — works well',
    '- [Leap opens Home Base directly](l.md) — checked 2028-02-29',
    '## Missing or blocked',
    '- [X reaches Home Base](x.md)',
    '- [Not an assistant](n.md) — checked 2026-10-12',
  ].join('\n'))
  assert.deepEqual(assistants, [
    { name: 'Codex', reach: 'opens', state: 'verified', checked: '2026-10-12' },
    { name: 'Claude Code', reach: 'opens', state: 'unverified', checked: null },
    { name: 'Grok', reach: 'opens', state: 'unverified', checked: null },
    { name: 'Gemini', reach: 'opens', state: 'unverified', checked: null },
    { name: 'Cursor', reach: 'opens', state: 'unverified', checked: null },
    { name: 'Leap', reach: 'opens', state: 'verified', checked: '2028-02-29' },
    { name: 'X', reach: 'reaches', state: 'blocked', checked: null },
  ])
  // Fictional assistants. A long line that wraps onto an indented line keeps
  // its date; the wrapped text itself never leaves the parser.
  const wrapped = parseAssistants([
    '## Available and verified', '',
    '- [Sam Helper opens Home Base directly](sam.md) —',
    `  reads AGENTS.md ${SENTINEL}; checked`,
    '  2026-10-09',
    '- [Jordan Agent opens Home Base directly](jordan.md) —',
    '\tchecked 2026-10-13',
    '- [Avery Aide opens Home Base](avery.md) —',
    ' \t#notes, checked 2026-10-08',
    '  - [Taylor Bot opens Home Base](taylor.md) — nested, no date',
    '- [Robin Desk opens Home Base](robin.md) — no date yet',
    '',
    '  checked 2026-10-12',
    '- [Casey Tool opens Home Base](casey.md) — checked 2026-13-01',
    '  checked 2026-10-11',
    '| [Morgan Row opens Home Base](morgan.md) | x |',
    '  checked 2026-10-10',
  ].join('\r\n'))
  assert.deepEqual(wrapped, [
    { name: 'Sam Helper', reach: 'opens', state: 'verified', checked: '2026-10-09' },
    { name: 'Jordan Agent', reach: 'opens', state: 'verified', checked: '2026-10-13' },
    { name: 'Avery Aide', reach: 'opens', state: 'verified', checked: '2026-10-08' },
    { name: 'Taylor Bot', reach: 'opens', state: 'unverified', checked: null },
    { name: 'Robin Desk', reach: 'opens', state: 'unverified', checked: null },
    { name: 'Casey Tool', reach: 'opens', state: 'unverified', checked: null },
    { name: 'Morgan Row', reach: 'opens', state: 'unverified', checked: null },
  ])
  assert.ok(!JSON.stringify(parseIndex(`## Active\n\n- [Sam](s.md)\n  ${SENTINEL}\n`).get('active')).includes(SENTINEL))
  // A very long wrapped item is read only as far as a date could be.
  const started = performance.now()
  const longWrap = parseAssistants(`## Available and verified\n- [Sam Helper opens Home Base](s.md)\n${'  checked\n'.repeat(50000)}`)
  assert.deepEqual(longWrap.map((item) => item.checked), [null])
  assert.ok(performance.now() - started < 2000, 'long wrapped items stay fast')
  assert.equal(copy.stateLabel('verified', '2026-10-12'), 'Verified')
  assert.equal(copy.stateLabel('verified', null), 'Not verified yet (no valid check date)')
  assert.equal(copy.stateLabel('unverified', null), 'Not verified yet (no valid check date)')
  assert.equal(copy.stateLabel('unverified', '2026-10-09'), 'Not verified yet')
  assert.match(copy.howToOpen('Codex', 'unverified', null), /What can you access/)
  assert.match(copy.howToOpen('Codex', 'verified', null), /What can you access/)
})

// ------------------------------------------------ sample data and words


test('the sample generator is deterministic for a seed', () => {
  assert.deepEqual(sample.sampleFinance(), sample.sampleFinance(sample.SAMPLE_SEED))
  assert.deepEqual(sample.sampleHabits(7), sample.sampleHabits(7))
  assert.notDeepEqual(sample.sampleFinance(1), sample.sampleFinance(2))
  assert.notDeepEqual(sample.sampleHabits(1), sample.sampleHabits(2))
  const sequence = sample.mulberry32(99)
  const values = Array.from({ length: 5 }, () => sequence())
  const replay = sample.mulberry32(99)
  assert.deepEqual(Array.from({ length: 5 }, () => replay()), values)
  assert.ok(values.every((value) => value >= 0 && value < 1))
})

test('sample data is labeled fictional and stays in plausible ranges', () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const finance = sample.sampleFinance(seed)
    const habits = sample.sampleHabits(seed)
    assert.equal(finance.fictional, true)
    assert.equal(habits.fictional, true)
    for (const caption of [finance.totalCaption, finance.categoriesCaption, finance.trendCaption, finance.goal.caption, habits.todayCaption, habits.todayListCaption, habits.weekCaption, habits.walkCaption, habits.fullDaysCaption]) {
      assert.match(caption, /\bsample\b/i, caption)
    }
    assert.equal(finance.total, finance.categories.reduce((sum, item) => sum + item.amount, 0))
    assert.ok(finance.categories.every((item) => Number.isInteger(item.amount) && item.amount > 0 && item.amount < 1000))
    assert.ok(finance.goal.saved > 0 && finance.goal.saved < finance.goal.target)
    assert.equal(habits.person, 'Sam')
    assert.equal(habits.habits, 4)
    assert.deepEqual(habits.today.map((item) => item.name), ['Walk', 'Stretch', 'Read', 'Cook at home'], 'four plain habits')
    assert.equal(habits.today.filter((item) => item.done).length, habits.doneToday)
    assert.equal(habits.week.at(-1).done, habits.doneToday)
    assert.ok(habits.week.length === 7 && habits.week.every((day) => day.done >= 1 && day.done <= 4))
    assert.equal(habits.walkMinutes === habits.walkTarget, habits.today[0].done, 'the walk matches the walk habit')
    assert.ok([0, 10, 20, 30].includes(habits.walkMinutes) && habits.walkTarget === 30, 'round numbers')
    assert.equal(habits.fullDays, habits.week.filter((day) => day.done === 4).length)
    // A generic sample: no named program and nothing about sleep, steps, weight,
    // food, medical, or wearable data.
    assert.doesNotMatch(JSON.stringify(habits), /sleep|steps|weight|heart|calor|protein|water|diet|alcohol|bpm|medic|wearable|program|\d+ ?hard|\.(?:jpe?g|png|heic)\b|image/i)
  }
  assert.match(sample.SAMPLE_NOTICE, /^Fictional sample data/)
  assert.equal(sample.formatMoney(1234.4), '$1,234')
  const main = fs.readFileSync(path.join(distDir, 'main.js'), 'utf8')
  for (const label of ["'Sample'", 'pill-sample', 'Preview with sample data', 'SAMPLE_NOTICE', '(sample)', 'habits.walkCaption', 'habits.fullDaysCaption', 'commitmentList(habits.today']) assert.ok(main.includes(label), label)
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(main), 'text only')
})

test('text meets 4.5:1 and chart bars 3:1 in light and dark', () => {
  const css = fs.readFileSync(path.join(distDir, 'styles.css'), 'utf8')
  const linear = (channel) => { const c = channel / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  const luminance = (hex) => { const n = Number.parseInt(hex.slice(1), 16); return 0.2126 * linear(n >> 16) + 0.7152 * linear((n >> 8) & 255) + 0.0722 * linear(n & 255) }
  const ratio = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }
  const tokens = (block) => Object.fromEntries([...block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6});/gi)].map((match) => [match[1], match[2]]))
  const light = tokens(css.slice(0, css.indexOf('@media (prefers-color-scheme: dark)')))
  const dark = { ...light, ...tokens(css.slice(css.indexOf('@media (prefers-color-scheme: dark)'), css.indexOf('/* ------------------------------------------------------------- base'))) }
  for (const [mode, t] of [['light', light], ['dark', dark]]) {
    for (const background of ['surface', 'bg']) {
      for (const text of ['ink', 'muted', 'faint', 'ok', 'warn', 'bad', 'accent']) {
        assert.ok(ratio(t[text], t[background]) >= 4.5, `${mode} ${text} on ${background}: ${ratio(t[text], t[background]).toFixed(2)}`)
      }
      for (const mark of ['bar', 'accent']) assert.ok(ratio(t[mark], t[background]) >= 3, `${mode} ${mark} on ${background}`)
    }
  }
  for (const rule of ['.fineprint', '.chip-off']) {
    const block = css.slice(css.indexOf(`${rule} {`), css.indexOf('}', css.indexOf(`${rule} {`)))
    assert.match(block, /color: var\(--muted\)/, `${rule} uses the 4.5:1 text colour`)
  }
})

test('the copy button announces the result through a status region', () => {
  const main = fs.readFileSync(path.join(distDir, 'main.js'), 'utf8')
  assert.ok(main.includes("setAttribute('role', 'status')") && main.includes('Copied “'), 'announces Copied')
  assert.ok(!main.includes("setAttribute('aria-label', `Copy"), 'no fixed label that hides the result')
})

test('the build check names the Node version to rebuild with', async () => {
  const copyDir = path.join(scratch, 'build-copy')
  fs.mkdirSync(copyDir)
  for (const entry of ['build.mjs', 'src', 'dist']) fs.cpSync(path.join(dashboardDir, entry), path.join(copyDir, entry), { recursive: true })
  const recorded = JSON.parse(fs.readFileSync(path.join(distDir, 'build-info.json'), 'utf8'))
  assert.match(recorded.node, /^v\d+\.\d+\.\d+$/)
  assert.deepEqual(Object.keys(recorded.outputs).sort(), fs.readdirSync(distDir).filter((name) => name !== 'build-info.json').sort())
  assert.ok(!fs.readdirSync(distDir).some((name) => name.endsWith('.map')), 'no source maps')
  const runCheck = () => new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(copyDir, 'build.mjs'), '--check'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })
    child.on('exit', (code) => resolve({ code, output }))
  })
  assert.equal((await runCheck()).code, 0)
  fs.appendFileSync(path.join(copyDir, 'src', 'types.ts'), '// changed\n')
  const changed = await runCheck()
  assert.equal(changed.code, 1)
  assert.match(changed.output, /src\/types\.ts changed since dist was built/)
  assert.ok(changed.output.includes(`Rebuild with Node ${recorded.node}`), changed.output)
  fs.copyFileSync(path.join(dashboardDir, 'src', 'types.ts'), path.join(copyDir, 'src', 'types.ts'))
  fs.appendFileSync(path.join(copyDir, 'dist', 'main.js'), '// edited by hand\n')
  const edited = await runCheck()
  assert.equal(edited.code, 1)
  assert.match(edited.output, /dist\/main\.js does not match its recorded fingerprint/)
})

test('next steps use plain words for every stage', () => {
  const base = { status: 'in_progress', stage: 'orient', discoveryPath: 'personal', orientationCompleted: 2, nextQuestion: 'name' }
  assert.equal(copy.nextStep({ ...base, status: 'not_started' }).say, 'Start')
  assert.equal(copy.progress({ ...base, status: 'not_started' }).label, 'Step 1 of 5: Get to know you')
  assert.match(copy.nextStep(base).headline, /What should I call you\?/)
  assert.equal(copy.nextStep({ ...base, nextQuestion: 'other' }).say, 'Continue my setup')
  for (const [stage, say] of [['opportunity_map', 'Review my opportunities'], ['blueprint', 'Blueprint it'], ['build', 'Build this system'], ['complete', 'Make Home Base better']]) {
    assert.equal(copy.nextStep({ ...base, stage }).say, say)
  }
  assert.deepEqual(copy.progress({ ...base, stage: 'blueprint' }), { current: 2, done: 2, label: 'Step 3 of 5: Design one' })
  assert.equal(copy.checkedLabel('2026-10-12'), 'Checked 12 Oct 2026')
  assert.match(copy.howToOpen('Codex', 'verified', '2026-10-12'), /Open Codex/)
  assert.match(copy.howToOpen('Grok Build CLI', 'verified', '2026-10-15'), /run grok, trust the folder/)
  assert.match(copy.howToOpen('Grok Build CLI', 'unverified', '2026-10-15'), /What can you access/)
  assert.match(copy.howToOpen('Something new', 'verified', '2026-10-12'), /AGENTS\.md/)
})
