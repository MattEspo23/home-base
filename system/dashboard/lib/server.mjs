// Hardened local dashboard request handling (Decision 6). Zero dependencies.
//
// - Only the exact Host `127.0.0.1:<port>` is served (DNS-rebinding defence).
// - Only GET. HEAD, OPTIONS, and everything else get 405, and no response ever
//   carries a CORS header.
// - Every route except the help page needs this install's sign-in cookie. The
//   browser gets it once by presenting the per-install key from the address
//   the launcher prints (`#key=…`, kept in the fragment so it is never sent in
//   a request line or a Referer), through `/session`.
// - A foreign Origin, or fetch metadata other than same-origin (or `none` for
//   a typed address), is refused. The JSON endpoints, `/session`, and instance
//   modules require `same-origin`.
// - The JSON endpoints also require the per-launch nonce from the page's meta
//   tag, compared as fixed-length digests so any byte length is safe.
// - A refused page load of `/` gets a small static help page with no data and
//   no key. Other refused requests keep their 421, 403, or 401 status.
// - Static files are an exact in-memory allowlist built from dist/ at startup.
// - Instance modules are served only for ids declared in modules.json.
// - Errors return a short generic message, never a stack trace.
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { readInside, readInstanceModules, readStatus, resolveInstanceModuleFile } from './status.mjs'

const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
}

const COMMON_HEADERS = Object.freeze({
  'x-content-type-options': 'nosniff',
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cross-origin-resource-policy': 'same-origin',
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
})

function policy(scriptSource, styleSource) {
  return [
    "default-src 'none'",
    `script-src ${scriptSource}`,
    `style-src ${styleSource}`,
    "connect-src 'self'",
    "img-src 'none'",
    "font-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "require-trusted-types-for 'script'",
    "trusted-types 'none'",
  ].join('; ')
}

export const SECURITY_HEADERS = Object.freeze({ 'content-security-policy': policy("'self'", "'self'"), ...COMMON_HEADERS })

// About 400 days, the longest lifetime current browsers keep a cookie.
export const COOKIE_MAX_AGE = 34_560_000

// Reasons sent with refusals, so the page can explain them in plain words.
export const REASONS = Object.freeze({
  noSession: 'no-session',
  noFetchMetadata: 'no-fetch-metadata',
  badKey: 'bad-key',
  staleNonce: 'stale-page',
})

const digest = (buffer) => crypto.createHash('sha256').update(buffer).digest()
const sha256Source = (text) => `'sha256-${crypto.createHash('sha256').update(text, 'utf8').digest('base64')}'`
const hmac = (key, label) => crypto.createHmac('sha256', key).update(label).digest()

// Derived values, so the key itself never travels after the first visit.
export const cookieValueFor = (key) => hmac(key, 'home-base-dashboard-cookie-v1').toString('base64url')
export const instanceTagFor = (key) => hmac(key, 'home-base-dashboard-instance-v1').toString('hex').slice(0, 32)

function loadDist(distDir, launchNonce, dbName) {
  const files = new Map()
  for (const entry of fs.readdirSync(distDir, { withFileTypes: true })) {
    if (!entry.isFile() || !/^[a-z0-9-]+\.(?:js|css)$/.test(entry.name)) continue
    files.set(`/app/${entry.name}`, { body: fs.readFileSync(path.join(distDir, entry.name)), type: MIME[path.extname(entry.name)] })
  }
  const page = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8')
  if (!page.includes('__HOME_BASE_LAUNCH__') || !page.includes('__HOME_BASE_DB__')) throw new Error('dist/index.html is missing its launch placeholders')
  const html = Buffer.from(page.replace('__HOME_BASE_LAUNCH__', launchNonce).replace('__HOME_BASE_DB__', dbName))
  return { files, html }
}

// ------------------------------------------------------------ help page

const HELP_STYLE = [
  ':root{color-scheme:light dark;--bg:#f6f7f9;--ink:#0e1116;--muted:#5a6370;--rule:#d8dce2}',
  '@media (prefers-color-scheme:dark){:root{--bg:#0a0c0f;--ink:#e7eaee;--muted:#96a0ac;--rule:#232a33}}',
  'body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}',
  'main{max-width:620px;margin:0 auto;padding:48px 16px}',
  'h1{font-size:24px;line-height:1.25;margin:0 0 16px}h2{font-size:17px;margin:28px 0 6px}',
  'p{margin:0 0 12px}code{font:14px ui-monospace,"SF Mono",Menlo,Consolas,monospace;overflow-wrap:anywhere}',
  '.status{padding:10px 12px;border:1px solid var(--rule)}.note{color:var(--muted);font-size:14px}',
].join('')

// The help page's only script. It reads `#key=…` from the address (also when
// the address is pasted into a tab already showing this page, which changes
// only the fragment), removes it from the address bar, trades it for the
// sign-in cookie, and opens the dashboard. It never writes HTML.
const HELP_SCRIPT = `(() => {
  const status = document.getElementById('status')
  const tryKey = () => {
  const match = /(?:^#|&)key=([A-Za-z0-9_-]{20,100})(?:&|$)/.exec(location.hash)
  if (!match) return
  history.replaceState(null, '', location.pathname + location.search)
  status.textContent = 'Opening your dashboard…'
  const say = (text) => { status.textContent = text }
  fetch('/session', { headers: { 'x-home-base-key': match[1] }, credentials: 'same-origin', cache: 'no-store', redirect: 'error' }).then(async (response) => {
    if (response.ok) { location.replace('/' + location.search); return }
    const reason = (await response.text()).trim()
    if (reason === '${REASONS.noFetchMetadata}') say('This browser is too old to open the dashboard safely. Update Safari to version 16.4 or later, or use Chrome, Edge, or Firefox, then open the address again.')
    else if (reason === '${REASONS.badKey}') say('That address does not match this Home Base. Run the launch command again and open the new address it prints.')
    else say('The dashboard could not sign this browser in. Reload the page. If it keeps happening, run the launch command again.')
  }, () => say('The dashboard is not running. Run the launch command again, then open the address it prints.'))
  }
  window.addEventListener('hashchange', tryKey)
  tryKey()
})()`

function helpPage(port, { wrongHost }) {
  const address = `http://127.0.0.1:${port}/`
  const first = wrongHost
    ? `This address uses a different name for this computer, such as localhost. Your dashboard answers only at <code>${address}</code>, so open the exact address your assistant printed.`
    : 'This page shows nothing from your Home Base. To see your dashboard, open the exact address your assistant printed when it started the dashboard.'
  const html = [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light dark"><meta name="referrer" content="no-referrer">',
    `<title>Open your Home Base dashboard</title><style>${HELP_STYLE}</style></head><body><main>`,
    '<h1>Open your Home Base dashboard</h1>',
    `<p class="status" id="status" role="status">${first}</p>`,
    `<p>It looks like <code>${address}#key=…</code>. Copy all of it, including the part after #, and paste it into the address bar.</p>`,
    `<p>Opened it before in this browser? Type <code>${address}</code> into the address bar. Use 127.0.0.1, not localhost.</p>`,
    '<h2>Lost the address?</h2>',
    '<p>Ask your assistant to “open my dashboard” again, or run <code>node system/dashboard/serve.mjs</code> in your Home Base folder. It prints the address every time, and again when the dashboard is already running.</p>',
    '<p class="note">The dashboard runs only on this computer. This page holds no information from your Home Base.</p>',
    wrongHost ? '' : `<script>${HELP_SCRIPT}</script>`,
    '</main></body></html>',
  ].join('')
  const csp = policy(wrongHost ? "'none'" : sha256Source(HELP_SCRIPT), sha256Source(HELP_STYLE))
  return { body: Buffer.from(html), csp }
}

// --------------------------------------------------------------- server

export function createDashboardServer({ root, port, dbName, distDir, key }) {
  if (typeof key !== 'string' || key.length < 32) throw new Error('A per-install key is required')
  const expectedHost = `127.0.0.1:${port}`
  const expectedOrigin = `http://${expectedHost}`
  const launchNonce = crypto.randomBytes(32).toString('base64url')
  const nonceDigest = digest(Buffer.from(launchNonce, 'latin1'))
  const keyDigest = digest(Buffer.from(key, 'latin1'))
  // Cookies are shared by every port on 127.0.0.1, so the name carries the port.
  const cookieName = `hb_${port}`
  const cookieDigest = digest(Buffer.from(cookieValueFor(key), 'latin1'))
  const instanceTag = instanceTagFor(key)
  const { files, html } = loadDist(distDir, launchNonce, dbName)
  const help = { right: helpPage(port, { wrongHost: false }), wrong: helpPage(port, { wrongHost: true }) }

  function send(response, status, body, type = 'text/plain; charset=utf-8', extra = {}) {
    const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body))
    response.writeHead(status, { ...SECURITY_HEADERS, 'content-type': type, 'content-length': payload.length, ...extra })
    response.end(payload)
  }

  // Static, with no data and no key. Served with 200 so every browser shows it.
  // Only the exact address carries the instance tag the launcher uses to
  // recognise its own dashboard; a page reached through another name (for
  // example by DNS rebinding) never sees this stable value.
  function sendHelp(response, wrongHost) {
    const page = wrongHost ? help.wrong : help.right
    send(response, 200, page.body, MIME['.html'], wrongHost
      ? { 'content-security-policy': page.csp }
      : { 'content-security-policy': page.csp, 'x-home-base-instance': instanceTag })
  }

  // Node exposes header bytes as latin1 text, so this recovers the exact bytes
  // the client sent. Both sides are hashed to 32 bytes before the constant-time
  // compare, so a multi-byte or wrong-length value can never throw.
  function matches(presented, expectedDigest) {
    if (typeof presented !== 'string' || presented.length === 0 || presented.length > 256) return false
    return crypto.timingSafeEqual(digest(Buffer.from(presented, 'latin1')), expectedDigest)
  }

  function signedIn(request) {
    const header = request.headers.cookie
    if (typeof header !== 'string' || header.length > 8192) return false
    const values = header.split(';').map((part) => part.trim()).filter((part) => part.startsWith(`${cookieName}=`))
    return values.length === 1 && matches(values[0].slice(cookieName.length + 1), cookieDigest)
  }

  function route(request, response) {
    const target = request.url ?? ''
    const isPage = target === '/' || target.startsWith('/?')
    if (request.headers.host !== expectedHost) {
      if (isPage && request.method === 'GET') return sendHelp(response, true)
      return send(response, 421, 'Misdirected request')
    }
    if (request.method !== 'GET') return send(response, 405, 'Method not allowed', undefined, { allow: 'GET' })
    if (!target.startsWith('/') || target.startsWith('//') || target.length > 2048) return send(response, 400, 'Bad request')
    if ((request.headers['content-length'] && request.headers['content-length'] !== '0') || request.headers['transfer-encoding']) return send(response, 400, 'Bad request')

    let url
    try { url = new URL(target, expectedOrigin) } catch { return send(response, 400, 'Bad request') }
    if (url.origin !== expectedOrigin) return send(response, 400, 'Bad request')
    const pathname = url.pathname

    const site = request.headers['sec-fetch-site']
    const foreign = (request.headers.origin !== undefined && request.headers.origin !== expectedOrigin) ||
      (site !== undefined && site !== 'same-origin' && site !== 'none')
    if (foreign) return pathname === '/' ? sendHelp(response, false) : send(response, 403, 'Forbidden')

    // Trade the per-install key for the sign-in cookie.
    if (pathname === '/session') {
      if (site === undefined) return send(response, 403, REASONS.noFetchMetadata)
      if (site !== 'same-origin') return send(response, 403, 'Forbidden')
      if (!matches(request.headers['x-home-base-key'], keyDigest)) return send(response, 403, REASONS.badKey)
      const cookie = `${cookieName}=${cookieValueFor(key)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE}`
      return send(response, 204, '', undefined, { 'set-cookie': cookie })
    }

    if (!signedIn(request)) {
      if (pathname === '/') return sendHelp(response, false)
      return send(response, 403, site === undefined && pathname.startsWith('/api/') ? REASONS.noFetchMetadata : REASONS.noSession)
    }

    if (pathname === '/') return send(response, 200, html, MIME['.html'])
    const file = files.get(pathname)
    if (file) return send(response, 200, file.body, file.type)

    if (pathname === '/api/status' || pathname === '/api/modules') {
      if (site === undefined) return send(response, 403, REASONS.noFetchMetadata)
      if (site !== 'same-origin') return send(response, 403, 'Forbidden')
      if (!matches(request.headers['x-home-base-token'], nonceDigest)) return send(response, 401, REASONS.staleNonce)
      const body = pathname === '/api/status' ? readStatus(root) : { modules: readInstanceModules(root) }
      return send(response, 200, JSON.stringify(body), MIME['.json'])
    }

    const moduleMatch = pathname.match(/^\/instance-modules\/([a-z0-9-]{1,40})\/([A-Za-z0-9._/-]{1,160})$/)
    if (moduleMatch) {
      if (site !== 'same-origin') return send(response, 403, site === undefined ? REASONS.noFetchMetadata : 'Forbidden')
      const declared = readInstanceModules(root).some((module) => module.id === moduleMatch[1])
      const relative = declared ? resolveInstanceModuleFile(root, moduleMatch[1], moduleMatch[2]) : null
      const contents = relative ? readInside(root, relative) : ''
      if (contents) return send(response, 200, contents, MIME[path.extname(relative)])
    }
    return send(response, 404, 'Not found')
  }

  const server = http.createServer({ maxHeaderSize: 16 * 1024 }, (request, response) => {
    try {
      route(request, response)
    } catch {
      if (!response.headersSent) send(response, 500, 'Internal error')
      else response.destroy()
    }
  })
  server.headersTimeout = 10_000
  server.requestTimeout = 15_000
  server.keepAliveTimeout = 5_000
  server.maxHeadersCount = 64
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
    else socket.destroy()
  })
  return { server, expectedOrigin, instanceTag }
}
