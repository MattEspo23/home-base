#!/usr/bin/env node

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const exampleDir = path.dirname(fileURLToPath(import.meta.url))
const interfaceDir = path.join(exampleDir, 'interface')
const port = Number(process.env.HOME_BASE_DEMO_PORT ?? 4173)

const mime = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
}

const server = http.createServer((request, response) => {
  let pathname
  try {
    pathname = decodeURIComponent(
      new URL(request.url ?? '/', 'http://127.0.0.1').pathname,
    )
  } catch {
    response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Bad request')
    return
  }
  const requestedFile = pathname === '/' ? 'index.html' : pathname.slice(1)
  const filePath = path.resolve(interfaceDir, requestedFile)
  const insideInterface =
    filePath === interfaceDir || filePath.startsWith(`${interfaceDir}${path.sep}`)
  if (
    !insideInterface ||
    !fs.existsSync(filePath) ||
    !fs.statSync(filePath).isFile()
  ) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Not found')
    return
  }
  response.writeHead(200, {
    'content-type': mime[path.extname(filePath)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'self'",
    'x-content-type-options': 'nosniff',
  })
  if (request.method === 'HEAD') {
    response.end()
  } else {
    response.end(fs.readFileSync(filePath))
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Daily Follow-Up Brief: http://127.0.0.1:${port}`)
  console.log('Synthetic data only. Sends are disabled. Press Ctrl+C to stop.')
})
