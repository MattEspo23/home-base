// A tiny DevTools-protocol driver for a local Chrome or Chromium, shared by
// the browser smoke test and the theme preview. No dependencies: it uses
// Node's built-in WebSocket (Node 22.4 or later). It only ever opens pages
// on a temporary fictional fixture, in a throwaway headless profile.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'

const RESERVED_PORTS = [4173, 5173, 3000, 5000, 8000, 8080, 8888]

export function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ]
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const found = spawnSync('which', [name], { encoding: 'utf8' })
    if (found.status === 0) candidates.push(found.stdout.trim())
  }
  const browserPath = candidates.find((candidate) => candidate && fs.existsSync(candidate))
  return browserPath && typeof WebSocket === 'function' ? browserPath : null
}

// A free local port that is never one of the reserved ports.
export async function freePort() {
  for (;;) {
    const port = await new Promise((resolve) => {
      const probe = net.createServer().listen(0, '127.0.0.1', () => { const { port: chosen } = probe.address(); probe.close(() => resolve(chosen)) })
    })
    if (port >= 1024 && !RESERVED_PORTS.includes(port)) return port
  }
}

// Starts the dashboard on a fixture folder and resolves with its key.
export async function startDashboard(dashboardDir, home, port, cleanups) {
  const server = spawn(process.execPath, [path.join(dashboardDir, 'serve.mjs'), '--home-base', home, '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] })
  cleanups.push(() => server.kill())
  const launch = await new Promise((resolve, reject) => {
    let output = ''
    server.stdout.on('data', (chunk) => { output += chunk; if (output.includes('Press Ctrl+C')) resolve(output) })
    server.stderr.on('data', (chunk) => { output += chunk })
    server.on('exit', (code) => reject(new Error(`dashboard exited ${code}: ${output}`)))
  })
  return launch.match(/#key=([A-Za-z0-9_-]{43})/)[1]
}

// Launches a headless browser and returns one attached page with helpers.
export async function openBrowser(browserPath, profile, cleanups) {
  const browser = spawn(browserPath, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync',
    '--disable-component-update', '--metrics-recording-only', '--hide-scrollbars', 'about:blank',
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

  // A full-page PNG at the given CSS width and color scheme. Returns how wide
  // the page really is, so a caller can spot sideways scrolling.
  async function screenshot(file, { width, mobile = false, scheme = 'light' }) {
    await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: 'reduce' }] })
    await page('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: mobile ? 2 : 1, mobile })
    await sleep(300)
    const height = Math.ceil(await evaluate('Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)'))
    const scrollWidth = await evaluate('document.documentElement.scrollWidth')
    await page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile })
    await sleep(300)
    const { data } = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    fs.writeFileSync(file, Buffer.from(data, 'base64'))
    await page('Emulation.clearDeviceMetricsOverride')
    await page('Emulation.setEmulatedMedia', { features: [] })
    return scrollWidth
  }

  return { page, evaluate, open, text, sleep, events, screenshot }
}
