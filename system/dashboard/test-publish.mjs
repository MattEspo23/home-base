#!/usr/bin/env node
// Tests for putting the dashboard online (publish.mjs, lib/online.mjs). No
// network and no Vercel: every folder is a temporary fixture, and the lock
// check runs against small local servers that imitate Vercel's answers.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { freePort } from './lib/chrome.mjs'
import {
  MANIFEST, PROBE_PATHS, PublishRefused, VERCEL_CLI, VERCEL_IGNORE, buildPlaceholder, buildSnapshot, checkLocked,
  lockCheckOrigin, onlinePolicy, prepareOutput, scanFiles, staticPage, writeOutput,
} from './lib/online.mjs'
import { SECURITY_HEADERS } from './lib/server.mjs'
import { readStatus, resolveHomeBase } from './lib/status.mjs'

const dashboardDir = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.join(dashboardDir, 'dist')
const publishScript = path.join(dashboardDir, 'publish.mjs')
const SENTINEL = ['PRIVATE', 'BODY', 'SENTINEL', '5e1f'].join('_')
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'home-base-publish-test-')))
after(() => fs.rmSync(scratch, { recursive: true, force: true }))

function write(root, relative, contents) {
  const target = path.join(root, ...relative.split('/'))
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, contents)
}

let fixtureCount = 0
function fixture() {
  const root = path.join(scratch, `home-base-${(fixtureCount += 1)}`)
  write(root, 'AGENTS.md', '# Agents\n')
  write(root, 'you/SETUP.md', `---\nsetup_status: in_progress\nstage: opportunity_map\nprivate_note: ${SENTINEL}\n---\n${SENTINEL}\n`)
  write(root, 'you/ABOUT.md', SENTINEL)
  write(root, 'memory/MEMORY.md', SENTINEL)
  write(root, 'projects/INDEX.md', `## Active\n\n- [Lake trip](lake-trip.md) — ${SENTINEL}\n- Unlinked ${SENTINEL}\n`)
  write(root, 'capabilities/INDEX.md', '## Available and verified\n\n- [Codex opens Home Base directly](codex.md) — checked 2026-10-12\n')
  write(root, 'instance/dashboard/modules.json', JSON.stringify({ modules: [{ id: 'reading', title: 'Reading list', entry: 'index.js' }] }))
  write(root, 'instance/dashboard/modules/reading/index.js', 'export function mount(element) { element.textContent = "Reading list mounted" }\n')
  write(root, 'instance/dashboard/modules/reading/style.css', '.reading { color: inherit; }\n')
  write(root, 'instance/dashboard/modules/reading/data/books.json', '{ "books": ["A fictional book"] }\n')
  write(root, 'instance/dashboard/modules/undeclared/index.js', `export const leak = "${SENTINEL}"\n`)
  write(root, 'instance/dashboard/theme.json', fs.readFileSync(path.join(dashboardDir, 'themes', 'soft.json')))
  write(root, 'instance/dashboard/theme.css', '.brand { letter-spacing: 0.3em; }\n')
  return resolveHomeBase(root)
}

function listFiles(root) {
  const found = []
  const walk = (relative) => {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const child = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(child)
      else found.push(child)
    }
  }
  walk('')
  return found.sort()
}

// The same steps publish.mjs takes.
function placeholder(root, out) {
  const { realOut, previous } = prepareOutput(out, root)
  const files = buildPlaceholder()
  assert.deepEqual(scanFiles(files), [])
  return writeOutput(realOut, previous, files, { kind: 'placeholder', createdAt: new Date().toISOString() })
}

function snapshot(root, out) {
  const { realOut, previous } = prepareOutput(out, root, { requireManifest: true })
  const { files } = buildSnapshot(root, { distDir })
  const reasons = scanFiles(files)
  if (reasons.length) throw new PublishRefused(reasons)
  return writeOutput(realOut, previous, files, { kind: 'snapshot', createdAt: new Date().toISOString() })
}

function refusedWith(action, pattern) {
  assert.throws(action, (error) => error instanceof PublishRefused && error.reasons.some((reason) => pattern.test(reason)), `expected a refusal matching ${pattern}`)
}

// ------------------------------------------------------------- placeholder

test('the placeholder holds no personal data, no script, and only the allowlisted files', () => {
  const root = fixture()
  const out = path.join(scratch, 'out-placeholder', 'home-base-dashboard')
  const manifest = placeholder(root, out)
  assert.deepEqual(manifest.files.map((item) => item.path), ['index.html', 'vercel.json'])
  assert.equal(manifest.kind, 'placeholder')
  assert.equal(manifest.vercelCli, VERCEL_CLI)
  assert.deepEqual(listFiles(out), [VERCEL_IGNORE, MANIFEST, 'index.html', 'vercel.json'].sort())
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8')
  assert.match(html, /This Home Base is locked/)
  assert.ok(!/<script/i.test(html), 'no script')
  for (const name of listFiles(out)) {
    const text = fs.readFileSync(path.join(out, name), 'utf8')
    for (const secret of [SENTINEL, 'Lake trip', 'Codex', root]) assert.ok(!text.includes(secret), `${name} holds no Home Base data`)
  }
  const policy = JSON.parse(fs.readFileSync(path.join(out, 'vercel.json'), 'utf8')).headers[0].headers.find((item) => item.key === 'Content-Security-Policy').value
  assert.match(policy, /script-src 'none'/)
  assert.equal(fs.readFileSync(path.join(out, VERCEL_IGNORE), 'utf8').split('\n').filter((line) => line && !line.startsWith('#')).join(' '), '/* !index.html !vercel.json')
})

// ---------------------------------------------------------------- snapshot

test('the snapshot goes only where the placeholder went first', () => {
  const root = fixture()
  refusedWith(() => snapshot(root, path.join(scratch, 'out-fresh')), /build the placeholder here first/)
  assert.ok(!fs.existsSync(path.join(scratch, 'out-fresh')), 'nothing written')
})

test('the snapshot is exactly what the local dashboard shows, and nothing else', () => {
  const root = fixture()
  const out = path.join(scratch, 'out-snapshot')
  placeholder(root, out)
  fs.mkdirSync(path.join(out, '.vercel'))
  fs.writeFileSync(path.join(out, '.vercel', 'README.txt'), 'made by the Vercel CLI when it links a folder\n')
  fs.writeFileSync(path.join(out, '.gitignore'), '.vercel\n')
  const manifest = snapshot(root, out)
  const appFiles = fs.readdirSync(distDir).filter((name) => /^[a-z0-9-]+\.(?:js|css)$/.test(name)).map((name) => `app/${name}`)
  const expected = [
    ...appFiles, 'index.html', 'status.json', 'modules.json', 'theme-status.json', 'vercel.json',
    'instance-theme/tokens.css', 'instance-theme/theme.css',
    'instance-modules/reading/index.js', 'instance-modules/reading/style.css', 'instance-modules/reading/data/books.json',
  ].sort()
  assert.deepEqual(manifest.files.map((item) => item.path), expected)
  // The placeholder's files were replaced, the CLI's link files kept.
  assert.deepEqual(listFiles(out), [...expected, VERCEL_IGNORE, MANIFEST, '.gitignore', '.vercel/README.txt'].sort())
  for (const item of manifest.files) {
    const bytes = fs.readFileSync(path.join(out, ...item.path.split('/')))
    assert.equal(item.bytes, bytes.length)
    assert.equal(item.sha256, crypto.createHash('sha256').update(bytes).digest('hex'))
    const text = bytes.toString('utf8')
    assert.ok(!text.includes(SENTINEL), `${item.path} holds no file bodies or unlinked text`)
    assert.ok(!text.includes(root), `${item.path} holds no folder path`)
  }
  // The data is the status reader's own output.
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'status.json'), 'utf8')), readStatus(root))
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'modules.json'), 'utf8')).modules, [{ id: 'reading', title: 'Reading list', url: '/instance-modules/reading/index.js' }])
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'theme-status.json'), 'utf8')).name, 'Soft')
  // The page is in static mode: no key, cookie, or launch nonce, and the
  // theme stylesheets are linked like the local server links them.
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8')
  assert.match(html, /<meta name="home-base-mode" content="static" \/>/)
  assert.match(html, /<meta name="home-base-published" content="\d{4}-\d{2}-\d{2}T[^"]+" \/>/)
  assert.ok(!html.includes('__HOME_BASE_') && !html.includes('home-base-token') && !html.includes('<!-- home-base-theme -->'))
  assert.ok(html.indexOf('http-equiv="Content-Security-Policy"') < html.indexOf('<link'), 'the meta policy comes before any stylesheet or script')
  assert.ok(html.indexOf('/instance-theme/tokens.css') < html.indexOf('/instance-theme/theme.css'))
  // The same policy the local server sends.
  const headers = JSON.parse(fs.readFileSync(path.join(out, 'vercel.json'), 'utf8')).headers
  assert.deepEqual(headers.map((item) => item.source), ['/(.*)'])
  const sent = Object.fromEntries(headers[0].headers.map((item) => [item.key.toLowerCase(), item.value]))
  const directives = (policy) => policy.split(';').map((part) => part.trim()).sort()
  assert.deepEqual(directives(sent['content-security-policy']), directives(SECURITY_HEADERS['content-security-policy']))
  for (const name of ['x-content-type-options', 'referrer-policy', 'x-frame-options', 'cross-origin-opener-policy', 'cross-origin-resource-policy', 'permissions-policy']) {
    assert.equal(sent[name], SECURITY_HEADERS[name], name)
  }
  assert.equal(sent['x-robots-tag'], 'noindex, nofollow')
  assert.deepEqual(directives(onlinePolicy({ meta: true })), directives(SECURITY_HEADERS['content-security-policy']).filter((item) => !item.startsWith('frame-ancestors')))
  // Only the listed top-level names can be uploaded.
  const allow = fs.readFileSync(path.join(out, VERCEL_IGNORE), 'utf8').split('\n').filter((line) => line.startsWith('!')).map((line) => line.slice(1))
  assert.deepEqual(allow, [...new Set(expected.map((name) => name.split('/')[0]))].sort())

  // Back to the placeholder removes every snapshot file.
  placeholder(root, out)
  assert.deepEqual(listFiles(out), [VERCEL_IGNORE, MANIFEST, 'index.html', 'vercel.json', '.gitignore', '.vercel/README.txt'].sort())
})

test('without a theme or modules, the page links no theme files and lists no modules', () => {
  const root = fixture()
  fs.rmSync(path.join(root, 'instance'), { recursive: true })
  const out = path.join(scratch, 'out-plain')
  placeholder(root, out)
  const manifest = snapshot(root, out)
  assert.ok(!manifest.files.some((item) => item.path.startsWith('instance-')))
  assert.ok(!fs.readFileSync(path.join(out, 'index.html'), 'utf8').includes('/instance-theme/'))
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'modules.json'), 'utf8')), { modules: [] })
})

test('a page without its placeholders is refused, not published half-converted', () => {
  assert.throws(() => staticPage('<html></html>', { themeLinks: '', publishedAt: 'x' }), /missing a placeholder/)
})

// ---------------------------------------------------------------- refusals

test('the output folder must be outside Home Base, plain, and hold only this tool’s files', () => {
  const root = fixture()
  refusedWith(() => prepareOutput(path.join(root, 'online'), root), /inside your Home Base folder/)
  refusedWith(() => prepareOutput(path.join(root, 'you', 'deeper', 'online'), root), /inside your Home Base folder/)
  refusedWith(() => prepareOutput(root, root), /inside your Home Base folder/)
  refusedWith(() => prepareOutput(path.dirname(root), root), /contains your Home Base folder/)
  // A link to a folder inside Home Base is still inside.
  fs.symlinkSync(path.join(root, 'projects'), path.join(scratch, 'link-into-home-base'))
  refusedWith(() => prepareOutput(path.join(scratch, 'link-into-home-base'), root), /inside your Home Base folder/)
  // A link that points outside is refused as a link.
  fs.mkdirSync(path.join(scratch, 'plain-target'))
  fs.symlinkSync(path.join(scratch, 'plain-target'), path.join(scratch, 'link-out'))
  refusedWith(() => prepareOutput(path.join(scratch, 'link-out'), root), /is a link/)
  // Stray files are refused, also deep inside a folder this tool made.
  const out = path.join(scratch, 'out-stray')
  write(out, 'notes.txt', 'mine')
  refusedWith(() => prepareOutput(out, root), /files Home Base did not put there \(notes\.txt\)/)
  fs.rmSync(path.join(out, 'notes.txt'))
  placeholder(root, out)
  write(out, 'app/extra.js', 'x')
  refusedWith(() => prepareOutput(out, root), /did not put there \(app\/extra\.js\)/)
  assert.ok(fs.existsSync(path.join(out, 'index.html')), 'the refusal leaves the folder as it was')
})

test('links, undeclared files, and private or credential-shaped text are refused before anything is written', () => {
  const cases = [
    ['a link in a module folder', (root) => fs.symlinkSync(path.join(root, 'you', 'ABOUT.md'), path.join(root, 'instance/dashboard/modules/reading/about.js')), /reading\/about\.js is a link/],
    ['a linked module folder', (root) => {
      fs.renameSync(path.join(root, 'instance/dashboard/modules/reading'), path.join(scratch, `moved-${crypto.randomUUID()}`))
      fs.symlinkSync(path.join(root, 'you'), path.join(root, 'instance/dashboard/modules/reading'))
    }, /modules\/reading is a link/],
    ['a linked theme.json', (root) => {
      fs.rmSync(path.join(root, 'instance/dashboard/theme.json'))
      fs.symlinkSync(path.join(root, 'you', 'SETUP.md'), path.join(root, 'instance/dashboard/theme.json'))
    }, /theme\.json is a link/],
    ['a hard-linked theme.css', (root) => {
      fs.rmSync(path.join(root, 'instance/dashboard/theme.css'))
      fs.linkSync(path.join(root, 'you', 'ABOUT.md'), path.join(root, 'instance/dashboard/theme.css'))
    }, /theme\.css is a hard link/],
    ['an undeclared file in a module folder', (root) => write(root, 'instance/dashboard/modules/reading/notes.txt', 'my notes'), /notes\.txt is not a file the dashboard uses/],
    ['credential-shaped text in a module', (root) => write(root, 'instance/dashboard/modules/reading/config.js', `export const key = "${['ghp', 'A'.repeat(30)].join('_')}"\n`), /config\.js contains text shaped like a password, key, or token/],
    ['a private folder path in a module', (root) => write(root, 'instance/dashboard/modules/reading/where.js', `export const from = "/${'Users'}/someone/Documents"\n`), /where\.js has a folder path from this computer on line 1/],
    ['an email address in a module', (root) => write(root, 'instance/dashboard/modules/reading/who.json', `{ "owner": "someone@${'gmail'}.com" }\n`), /who\.json has an email address on line 1/],
  ]
  for (const [label, damage, pattern] of cases) {
    const root = fixture()
    const out = path.join(scratch, `out-refused-${crypto.randomUUID()}`)
    placeholder(root, out)
    const before = listFiles(out)
    damage(root)
    refusedWith(() => snapshot(root, out), pattern)
    assert.deepEqual(listFiles(out), before, `${label}: the folder still holds the placeholder`)
  }
})

test('Finder’s .DS_Store and undeclared module folders never go online', () => {
  const root = fixture()
  write(root, 'instance/dashboard/modules/reading/.DS_Store', '\u0000\u0001binary')
  const out = path.join(scratch, 'out-ds-store')
  placeholder(root, out)
  const names = snapshot(root, out).files.map((item) => item.path)
  assert.ok(!names.some((name) => name.includes('.DS_Store') || name.includes('undeclared')))
})

// -------------------------------------------------------------- lock check

async function fakeHost(answer) {
  const port = await freePort()
  const seen = []
  const server = http.createServer((request, response) => {
    seen.push({ url: request.url, cookie: request.headers.cookie ?? null, authorization: request.headers.authorization ?? null })
    const { status, headers = {}, body = '' } = answer(request.url)
    response.writeHead(status, headers)
    response.end(body)
  })
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))
  return { origin: `http://127.0.0.1:${port}`, seen, close: () => new Promise((resolve) => server.close(resolve)) }
}

const VERCEL_401 = { status: 401, headers: { server: 'Vercel', 'content-type': 'text/html' }, body: '<!doctype html><title>Authentication Required</title>' }

test('the lock check passes on Vercel’s 401 and on a redirect to its sign-in, with no cookies sent', async () => {
  for (const answer of [
    () => VERCEL_401,
    () => ({ status: 403, headers: { 'x-vercel-id': 'iad1::abc' } }),
    () => ({ status: 302, headers: { location: 'https://vercel.com/login?next=%2Fsso-api' } }),
    () => ({ status: 307, headers: { location: 'https://vercel.com/sso-api?url=x&nonce=y' } }),
  ]) {
    const host = await fakeHost(answer)
    try {
      const { locked, results } = await checkLocked([host.origin], { allowLocalHttp: true })
      assert.equal(locked, true, JSON.stringify(results))
      assert.deepEqual(host.seen.map((item) => item.url), PROBE_PATHS)
      assert.ok(host.seen.every((item) => item.cookie === null && item.authorization === null), 'anonymous')
    } finally {
      await host.close()
    }
  }
})

test('the lock check fails on any answer that is not Vercel’s sign-in wall', async () => {
  const failing = [
    ['200 with content', () => ({ status: 200, headers: { server: 'Vercel' }, body: '<p>hello</p>' })],
    ['mixed: the page is locked but an asset is not', (url) => (url === '/app/main.js' ? { status: 200, headers: { server: 'Vercel' }, body: 'export {}' } : VERCEL_401)],
    ['a 401 that is not from Vercel', () => ({ status: 401, body: 'no' })],
    ['a 401 that carries Home Base content', () => ({ ...VERCEL_401, body: '{ "schemaVersion": 1 }' })],
    ['a redirect elsewhere', () => ({ status: 302, headers: { location: 'https://evil.example/login' } })],
    ['a redirect to Vercel over http', () => ({ status: 302, headers: { location: 'http://vercel.com/login' } })],
    ['a redirect to a look-alike host', () => ({ status: 302, headers: { location: 'https://vercel.com.evil.example/login' } })],
    ['a redirect to another Vercel page', () => ({ status: 302, headers: { location: 'https://vercel.com/home-base-dashboard' } })],
    ['a 404', () => ({ status: 404, headers: { server: 'Vercel' } })],
  ]
  for (const [label, answer] of failing) {
    const host = await fakeHost(answer)
    try {
      const { locked } = await checkLocked([host.origin], { allowLocalHttp: true })
      assert.equal(locked, false, label)
    } finally {
      await host.close()
    }
  }
  // One locked address and one open address is not locked.
  const lockedHost = await fakeHost(() => VERCEL_401)
  const openHost = await fakeHost(() => ({ status: 200, body: 'open' }))
  try {
    assert.equal((await checkLocked([lockedHost.origin, openHost.origin], { allowLocalHttp: true })).locked, false)
  } finally {
    await lockedHost.close()
    await openHost.close()
  }
  // Nothing answering is not locked either.
  const port = await freePort()
  assert.equal((await checkLocked([`http://127.0.0.1:${port}`], { allowLocalHttp: true, timeoutMs: 2000 })).locked, false)
})

test('the lock check takes https addresses only', async () => {
  assert.equal(lockCheckOrigin('https://home-base-dashboard.vercel.app/some/path?x=1'), 'https://home-base-dashboard.vercel.app')
  for (const address of ['http://home-base-dashboard.vercel.app', 'http://127.0.0.1:1234', `https://user:${'pass'}@example.vercel.app`,'not a url', 'ftp://example.com']) {
    assert.equal(lockCheckOrigin(address), null, address)
  }
  assert.equal(lockCheckOrigin('http://localhost:1234', { allowLocalHttp: true }), null, 'only 127.0.0.1 in tests')
  await assert.rejects(checkLocked(['http://example.com']), PublishRefused)
  const cli = spawnSync(process.execPath, [publishScript, '--check-locked', 'http://example.com'], { encoding: 'utf8' })
  assert.equal(cli.status, 2)
  assert.match(cli.stderr, /https addresses only/)
})

// --------------------------------------------------------------------- CLI

test('the command lists every file that will go online, and refuses plainly', () => {
  const root = fixture()
  const out = path.join(scratch, 'out-cli', 'home-base-dashboard')
  const run = (...args) => spawnSync(process.execPath, [publishScript, '--home-base', root, ...args], { encoding: 'utf8' })
  const early = run('--out', out)
  assert.equal(early.status, 1)
  assert.match(early.stderr, /build the placeholder here first/)
  const first = run('--placeholder', '--out', out)
  assert.equal(first.status, 0, first.stderr)
  assert.match(first.stdout, /^These files will go online:\n {2}index\.html +\d+ B\n {2}vercel\.json +[\d.]+ KB\nTotal: 2 files/m)
  assert.match(first.stdout, new RegExp(`npx --yes ${VERCEL_CLI.replace('.', '\\.')} deploy --cwd`))
  // Every printed upload names the team or account the user chose, never the CLI's default.
  assert.match(first.stdout, /deploy --cwd "[^"]+" --prod --yes --scope <scope>$/m)
  const second = run('--out', out)
  assert.equal(second.status, 0, second.stderr)
  assert.match(second.stdout, /These files will go online:/)
  assert.match(second.stdout, /status\.json/)
  assert.match(second.stdout, /deploy --cwd "[^"]+" --prod --yes --scope <scope>$/m)
  assert.match(second.stdout, /instance-modules\/reading\/index\.js/)
  assert.ok(!second.stdout.includes(SENTINEL))
  const inside = run('--out', path.join(root, 'online'))
  assert.equal(inside.status, 1)
  assert.match(inside.stderr, /inside your Home Base folder/)
  assert.ok(!fs.existsSync(path.join(root, 'online')))
  assert.equal(spawnSync(process.execPath, [publishScript, '--bogus'], { encoding: 'utf8' }).status, 2)
})

test('the pinned Vercel CLI is an exact version', () => {
  assert.match(VERCEL_CLI, /^vercel@\d+\.\d+\.\d+$/)
})

test('the online copy says when it was published, and never shows a broken date', async () => {
  const copy = await import(new URL('./dist/copy.js', import.meta.url).href)
  assert.equal(copy.onlineNote(null, ''), 'A copy of your Home Base. It changes when your assistant updates it.')
  assert.equal(copy.onlineNote('1.1.0', 'not a date'), 'Home Base 1.1.0. A copy of your Home Base. It changes when your assistant updates it.')
  assert.match(copy.onlineNote('1.1.0', '2026-10-16T17:50:00.000Z'), /^Home Base 1\.1\.0\. A copy of your Home Base from .*2026.*\. It changes when your assistant updates it\.$/)
  assert.equal(copy.ONLINE_WHERE, 'Online, locked to your Vercel sign-in')
})
