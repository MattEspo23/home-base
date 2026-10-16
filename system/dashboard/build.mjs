#!/usr/bin/env node
// Zero-dependency dashboard build: strips TypeScript types with Node's built-in
// module.stripTypeScriptTypes (Node 22.13 or later) and copies static files.
// Inputs are only system/dashboard/src; instance/ is never read.
//
// Every build writes dist/build-info.json: the Node version used and SHA-256
// fingerprints of this script, every source, and every output. `--check`
// compares those fingerprints on any Node version, and on the recorded Node
// version also rebuilds and compares byte for byte. Type-stripping output can
// differ between Node versions, so a mismatch names the version to rebuild
// with instead of a bare "stale".
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dashboardDir = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.join(dashboardDir, 'src')
const distDir = path.join(dashboardDir, 'dist')
const INFO = 'build-info.json'
const check = process.argv.includes('--check')
const STATIC = new Set(['.html', '.css'])
const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex')

const { stripTypeScriptTypes } = await import('node:module')
const canStrip = typeof stripTypeScriptTypes === 'function'

function readSources() {
  const sources = new Map()
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile()) throw new Error(`Dashboard src may contain only plain files: ${entry.name}`)
    const ext = path.extname(entry.name)
    if (!STATIC.has(ext) && ext !== '.ts') throw new Error(`Unsupported dashboard source: ${entry.name}`)
    sources.set(entry.name, fs.readFileSync(path.join(srcDir, entry.name), 'utf8'))
  }
  return sources
}

function buildOutputs(sources) {
  const outputs = new Map()
  for (const [name, source] of sources) {
    if (STATIC.has(path.extname(name))) { outputs.set(name, source); continue }
    for (const match of source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      if (!/^\.\/[a-z0-9-]+\.ts$/.test(match[1])) throw new Error(`Dashboard imports must be sibling ./name.ts files: ${name} -> ${match[1]}`)
    }
    const stripped = stripTypeScriptTypes(source, { mode: 'strip' })
      .replace(/(from\s*['"]\.\/[a-z0-9-]+)\.ts(['"])/g, '$1.js$2')
      .split('\n').map((line) => line.trimEnd()).join('\n')
    if (/sourceMappingURL/.test(stripped)) throw new Error('Source maps are not allowed')
    outputs.set(name.replace(/\.ts$/, '.js'), `// Generated from src/${name} by system/dashboard/build.mjs. Do not edit.\n${stripped}`)
  }
  return outputs
}

const fingerprints = (files) => Object.fromEntries([...files].map(([name, text]) => [name, sha256(text)]))

function buildInfo(sources, outputs) {
  return {
    schemaVersion: 1,
    node: process.version,
    builder: sha256(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8')),
    sources: fingerprints(sources),
    outputs: fingerprints(outputs),
  }
}

function differences(expected, actual) {
  const names = [...new Set([...Object.keys(expected ?? {}), ...Object.keys(actual)])].sort()
  return names.filter((name) => expected?.[name] !== actual[name])
}

const sources = readSources()

if (check) {
  let info = null
  try { info = JSON.parse(fs.readFileSync(path.join(distDir, INFO), 'utf8')) } catch { info = null }
  const recorded = typeof info?.node === 'string' ? info.node : null
  const rebuildWith = recorded ? `Node ${recorded}` : 'Node 22.13 or later'
  const problems = []
  if (!info || info.schemaVersion !== 1) problems.push(`dist/${INFO} is missing or unreadable`)
  else {
    for (const name of differences(info.sources, fingerprints(sources))) problems.push(`src/${name} changed since dist was built`)
    if (info.builder !== sha256(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8'))) problems.push('build.mjs changed since dist was built')
    const existing = fs.existsSync(distDir) ? fs.readdirSync(distDir).filter((name) => name !== INFO).sort() : []
    const distFiles = new Map(existing.map((name) => [name, fs.readFileSync(path.join(distDir, name), 'utf8')]))
    for (const name of differences(info.outputs, fingerprints(distFiles))) problems.push(`dist/${name} does not match its recorded fingerprint`)
  }
  const sameNode = recorded === process.version
  if (!problems.length && sameNode && canStrip) {
    const outputs = buildOutputs(sources)
    for (const [name, text] of outputs) {
      const current = fs.existsSync(path.join(distDir, name)) ? fs.readFileSync(path.join(distDir, name), 'utf8') : null
      if (current !== text) problems.push(`dist/${name} differs from a fresh build`)
    }
  }
  if (problems.length) {
    console.error([
      `Dashboard dist is out of date: ${problems.join('; ')}.`,
      `Rebuild with ${rebuildWith} (the version CI uses): node system/dashboard/build.mjs`,
      recorded && !sameNode ? `You are running Node ${process.version}. Type stripping can produce different output on other Node versions, so rebuild with ${recorded}.` : '',
    ].filter(Boolean).join('\n'))
    process.exit(1)
  }
  console.log(sameNode && canStrip
    ? `Dashboard dist is fresh (${Object.keys(info.outputs).length} files, rebuilt and compared on Node ${process.version})`
    : `Dashboard dist is fresh (${Object.keys(info.outputs).length} files, fingerprints match; built with Node ${recorded}, this is Node ${process.version})`)
} else {
  if (!canStrip) {
    console.error(`Building the dashboard needs Node 22.13 or later (it uses Node's built-in TypeScript stripping). You are running Node ${process.version}. To check the committed build instead, run: node system/dashboard/build.mjs --check`)
    process.exit(2)
  }
  const outputs = buildOutputs(sources)
  fs.rmSync(distDir, { recursive: true, force: true })
  fs.mkdirSync(distDir)
  for (const [name, contents] of outputs) fs.writeFileSync(path.join(distDir, name), contents)
  fs.writeFileSync(path.join(distDir, INFO), `${JSON.stringify(buildInfo(sources, outputs), null, 2)}\n`)
  console.log(`Built dashboard dist (${outputs.size} files) with Node ${process.version}`)
}
