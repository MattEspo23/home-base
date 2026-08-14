import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const STATE_SCHEMA = 2
const PLAN_SCHEMA = 2
const PRESERVED_RUNTIME_ROOT = '.home-base'

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function digest(value) {
  return sha256(stable(value))
}

function portable(relativePath) {
  if (typeof relativePath !== 'string') throw new Error('Update path must be a string')
  const normalized = relativePath.split(path.sep).join('/').replace(/^\.\/+/, '').normalize('NFC')
  if (!normalized || normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized) || normalized.includes('\\')) {
    throw new Error(`Unsafe update path: ${relativePath}`)
  }
  return normalized
}

function overlap(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)
}

function assertNoRootOverlap(roots, label) {
  for (let left = 0; left < roots.length; left += 1) {
    for (let right = left + 1; right < roots.length; right += 1) {
      if (overlap(roots[left], roots[right])) throw new Error(`${label} paths overlap: ${roots[left]} and ${roots[right]}`)
    }
  }
}

function safeJoin(root, relativePath) {
  const normalized = portable(relativePath)
  const absolute = path.resolve(root, ...normalized.split('/'))
  const relative = path.relative(path.resolve(root), absolute)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Update path escapes its root: ${relativePath}`)
  return absolute
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  const descriptor = fs.openSync(temporary, 'r')
  try { fs.fsyncSync(descriptor) } finally { fs.closeSync(descriptor) }
  fs.renameSync(temporary, filePath)
  fsyncDirectory(path.dirname(filePath))
}

function fsyncDirectory(directory) {
  try {
    const descriptor = fs.openSync(directory, 'r')
    try { fs.fsyncSync(descriptor) } finally { fs.closeSync(descriptor) }
  } catch {
    // Some filesystems do not support fsync on directories. File fsync remains enforced.
  }
}

function removeExact(target, boundary) {
  const relative = path.relative(path.resolve(boundary), path.resolve(target))
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Refusing to remove unsafe update target: ${target}`)
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true })
}

function scanNode(root, relativePath, records, folded) {
  const normalized = portable(relativePath)
  const absolute = safeJoin(root, normalized)
  const stat = fs.lstatSync(absolute)
  if (stat.isSymbolicLink()) throw new Error(`Update trees may not contain symbolic links: ${normalized}`)
  const foldedKey = normalized.normalize('NFKC').toLocaleLowerCase('en-US')
  if (folded.has(foldedKey) && folded.get(foldedKey) !== normalized) {
    throw new Error(`Unicode/case-colliding update paths: ${folded.get(foldedKey)} and ${normalized}`)
  }
  folded.set(foldedKey, normalized)
  if (stat.isFile()) {
    if (stat.nlink !== 1) throw new Error(`Update trees may not contain hard-linked files: ${normalized}`)
    records.set(normalized, { type: 'file', sha256: sha256(fs.readFileSync(absolute)), size: stat.size })
    return
  }
  if (!stat.isDirectory()) throw new Error(`Update trees may not contain sockets, devices, FIFOs, or special files: ${normalized}`)
  records.set(normalized, { type: 'directory' })
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    scanNode(root, `${normalized}/${entry.name}`, records, folded)
  }
}

function scanRoots(root, roots) {
  const records = new Map()
  const folded = new Map()
  for (const relativeRoot of roots) {
    const normalized = portable(relativeRoot)
    const absolute = safeJoin(root, normalized)
    if (fs.existsSync(absolute)) scanNode(root, normalized, records, folded)
  }
  return records
}

function scanWholeTree(root) {
  const records = new Map()
  const folded = new Map()
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === PRESERVED_RUNTIME_ROOT || entry.name === '.git') continue
    scanNode(root, entry.name, records, folded)
  }
  return records
}

function serializedRecords(records) {
  return [...records.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([file, record]) => ({ file, ...record }))
}

function recordsDigest(records) {
  return digest(serializedRecords(records))
}

function sameRecord(left, right) {
  return stable(left ?? null) === stable(right ?? null)
}

function readManifest(root) {
  const manifestPath = safeJoin(root, 'system/release-manifest.json')
  const bytes = fs.readFileSync(manifestPath)
  const manifest = JSON.parse(bytes.toString('utf8'))
  if (manifest.schemaVersion !== 2 || !manifest.product || !manifest.version || !manifest.releaseId) {
    throw new Error('The update engine requires a complete schema-v2 release manifest')
  }
  for (const field of ['maintainedPaths', 'userOwnedPaths', 'starterFiles']) {
    if (!Array.isArray(manifest[field])) throw new Error(`Release manifest is missing ${field}`)
    manifest[field] = manifest[field].map(portable)
  }
  assertNoRootOverlap(manifest.maintainedPaths, 'Maintained')
  assertNoRootOverlap(manifest.userOwnedPaths, 'User-owned')
  const unsafe = manifest.maintainedPaths.filter((maintained) => manifest.userOwnedPaths.some((owned) => overlap(maintained, owned)))
  if (unsafe.length > 0) throw new Error(`Candidate maintained paths overlap protected user-owned paths: ${unsafe.join(', ')}`)
  return { manifest, manifestDigest: sha256(bytes) }
}

function releaseIdentity(root, override = {}) {
  const { manifest, manifestDigest } = readManifest(root)
  const receiptPath = path.join(root, 'system', 'distribution', 'release.json')
  const receipt = fs.existsSync(receiptPath) ? JSON.parse(fs.readFileSync(receiptPath, 'utf8')) : {}
  const sourceCommit = override.sourceCommit ?? receipt.source?.commit
  const sourceRef = override.sourceRef ?? receipt.source?.ref
  const sourceRepository = override.sourceRepository ?? receipt.source?.repository
  if (!/^[0-9a-f]{40}$/i.test(sourceCommit ?? '')) throw new Error('Release identity requires an immutable 40-character source commit')
  if (!sourceRef || !sourceRepository) throw new Error('Release identity requires source repository and ref receipts')
  return {
    releaseId: manifest.releaseId,
    version: manifest.version,
    source: { repository: sourceRepository, ref: sourceRef, commit: sourceCommit.toLowerCase() },
    manifestDigest,
  }
}

function statePaths(root) {
  const stateRoot = path.join(root, PRESERVED_RUNTIME_ROOT, 'state')
  return {
    stateRoot,
    stateFile: path.join(stateRoot, 'update-state.json'),
    lockRoot: path.join(stateRoot, 'update.lock'),
    recoveryMarker: path.join(stateRoot, 'recovery.json'),
    basesRoot: path.join(stateRoot, 'bases'),
    transactionsRoot: path.join(stateRoot, 'transactions'),
    stagingRoot: path.join(stateRoot, 'staging'),
  }
}

function readState(root) {
  const paths = statePaths(root)
  if (!fs.existsSync(paths.stateFile)) throw new Error('Home Base update state is not initialized; run init first')
  const state = JSON.parse(fs.readFileSync(paths.stateFile, 'utf8'))
  if (state.schemaVersion !== STATE_SCHEMA || !state.installationId || !state.currentRelease || !state.baseSnapshot) {
    throw new Error('Home Base update state is incomplete or unsupported')
  }
  return state
}

function acquireLock(root) {
  const paths = statePaths(root)
  fs.mkdirSync(paths.stateRoot, { recursive: true })
  if (fs.existsSync(paths.lockRoot)) {
    let owner
    try { owner = JSON.parse(fs.readFileSync(path.join(paths.lockRoot, 'owner.json'), 'utf8')) } catch { owner = null }
    if (owner?.pid) {
      try {
        process.kill(owner.pid, 0)
        throw new Error(`Another Home Base update process owns the lock (pid ${owner.pid})`)
      } catch (error) {
        if (error.message?.startsWith('Another Home Base')) throw error
        if (error.code !== 'ESRCH') throw new Error('Home Base update lock exists and its owner cannot be verified')
      }
    }
    removeExact(paths.lockRoot, paths.stateRoot)
  }
  fs.mkdirSync(paths.lockRoot)
  writeJsonAtomic(path.join(paths.lockRoot, 'owner.json'), { pid: process.pid, nonce: crypto.randomUUID() })
  return () => removeExact(paths.lockRoot, paths.stateRoot)
}

function copyFileDurable(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.copyFileSync(source, destination)
  const descriptor = fs.openSync(destination, 'r')
  try { fs.fsyncSync(descriptor) } finally { fs.closeSync(descriptor) }
}

function copyRecords(sourceRoot, destinationRoot, records) {
  for (const [relativePath, record] of [...records.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const destination = safeJoin(destinationRoot, relativePath)
    if (record.type === 'directory') fs.mkdirSync(destination, { recursive: true })
    else copyFileDurable(safeJoin(sourceRoot, relativePath), destination)
  }
}

function makeSnapshot(root, identity, destination) {
  const { manifest } = readManifest(root)
  const records = scanRoots(root, manifest.maintainedPaths)
  fs.mkdirSync(destination, { recursive: true })
  const treeRoot = path.join(destination, 'tree')
  copyRecords(root, treeRoot, records)
  const snapshot = {
    schemaVersion: 1,
    release: identity,
    records: serializedRecords(records),
    digest: recordsDigest(records),
  }
  writeJsonAtomic(path.join(destination, 'snapshot.json'), snapshot)
  for (const item of snapshot.records.filter((entry) => entry.type === 'file')) {
    fs.chmodSync(safeJoin(treeRoot, item.file), 0o400)
  }
  return snapshot
}

function loadSnapshot(root, state) {
  const paths = statePaths(root)
  const snapshotRoot = safeJoin(paths.stateRoot, state.baseSnapshot.path)
  const snapshot = JSON.parse(fs.readFileSync(path.join(snapshotRoot, 'snapshot.json'), 'utf8'))
  const records = scanRoots(path.join(snapshotRoot, 'tree'), readManifest(root).manifest.maintainedPaths)
  if (recordsDigest(records) !== snapshot.digest || snapshot.digest !== state.baseSnapshot.digest) {
    throw new Error('The immutable Home Base base snapshot is missing, mutable, or corrupt')
  }
  if (stable(snapshot.release) !== stable(state.currentRelease)) throw new Error('Base snapshot is not bound to the current release identity')
  return { snapshotRoot, snapshot, records }
}

export function initializeUpdateState(root, identityOverride = {}) {
  const paths = statePaths(root)
  if (fs.existsSync(paths.stateFile)) {
    const current = readState(root)
    loadSnapshot(root, current)
    return current
  }
  const release = releaseIdentity(root, identityOverride)
  scanWholeTree(root)
  const installationId = crypto.randomUUID()
  const baseName = `${release.releaseId.replace(/[^a-z0-9.-]/gi, '-')}-${release.manifestDigest.slice(0, 12)}`
  const basePath = `bases/${baseName}`
  const snapshot = makeSnapshot(root, release, path.join(paths.stateRoot, basePath))
  const state = {
    schemaVersion: STATE_SCHEMA,
    installationId,
    currentRelease: release,
    baseSnapshot: { path: basePath, digest: snapshot.digest },
    lastSuccessfulTransactionId: null,
    activeTransactionId: null,
  }
  writeJsonAtomic(paths.stateFile, state)
  return state
}

function recordForPlan(record) {
  return record ? { ...record } : null
}

function changedSpan(base, variant) {
  let start = 0
  while (start < base.length && start < variant.length && base[start] === variant[start]) start += 1
  let baseEnd = base.length
  let variantEnd = variant.length
  while (baseEnd > start && variantEnd > start && base[baseEnd - 1] === variant[variantEnd - 1]) {
    baseEnd -= 1
    variantEnd -= 1
  }
  return { start, end: baseEnd, replacement: variant.slice(start, variantEnd) }
}

function threeWayMerge(baseBuffer, localBuffer, incomingBuffer) {
  if ([baseBuffer, localBuffer, incomingBuffer].some((buffer) => buffer.includes(0))) return null
  const base = baseBuffer.toString('utf8').split('\n')
  const local = localBuffer.toString('utf8').split('\n')
  const incoming = incomingBuffer.toString('utf8').split('\n')
  const localChange = changedSpan(base, local)
  const incomingChange = changedSpan(base, incoming)
  const sameInsertionPoint = localChange.start === localChange.end && incomingChange.start === incomingChange.end && localChange.start === incomingChange.start
  const overlaps = sameInsertionPoint || !(localChange.end <= incomingChange.start || incomingChange.end <= localChange.start)
  if (overlaps) return null
  const merged = [...base]
  for (const change of [localChange, incomingChange].sort((left, right) => right.start - left.start)) {
    merged.splice(change.start, change.end - change.start, ...change.replacement)
  }
  return Buffer.from(merged.join('\n'))
}

function content(root, relativePath) {
  return fs.readFileSync(safeJoin(root, relativePath))
}

function minimalConflictRoots(conflicts) {
  return [...conflicts].sort((left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right))
    .filter((candidate, index, sorted) => !sorted.slice(0, index).some((root) => candidate.startsWith(`${root}/`)))
}

function buildPlan(root, candidateRoot, options = {}) {
  const state = readState(root)
  if (state.activeTransactionId && !options.allowActive) throw new Error(`Home Base must recover or finish active transaction ${state.activeTransactionId}`)
  const currentManifest = readManifest(root)
  const incomingManifest = readManifest(candidateRoot)
  for (const maintained of incomingManifest.manifest.maintainedPaths) {
    if (currentManifest.manifest.userOwnedPaths.some((owned) => overlap(maintained, owned))) {
      throw new Error(`Candidate maintained paths overlap protected user-owned paths: ${maintained}`)
    }
  }
  scanWholeTree(candidateRoot)
  const base = loadSnapshot(root, state)
  const localRecords = scanRoots(root, currentManifest.manifest.maintainedPaths)
  const incomingRecords = scanRoots(candidateRoot, incomingManifest.manifest.maintainedPaths)
  const incomingRelease = releaseIdentity(candidateRoot, options.candidateIdentityOverride ?? {})
  const union = [...new Set([...base.records.keys(), ...localRecords.keys(), ...incomingRecords.keys()])].sort()
  const entries = []
  const conflicts = []
  for (const file of union) {
    const baseRecord = base.records.get(file)
    const localRecord = localRecords.get(file)
    const incomingRecord = incomingRecords.get(file)
    let action
    let proposedHash = null
    if (sameRecord(localRecord, baseRecord) && sameRecord(incomingRecord, baseRecord)) action = 'unchanged'
    else if (sameRecord(localRecord, incomingRecord)) action = 'converged'
    else if (sameRecord(localRecord, baseRecord)) {
      action = incomingRecord ? 'write_incoming' : 'delete'
      proposedHash = incomingRecord?.sha256 ?? null
    } else if (sameRecord(incomingRecord, baseRecord)) action = 'preserve_local'
    else if (baseRecord?.type === 'file' && localRecord?.type === 'file' && incomingRecord?.type === 'file') {
      const merged = threeWayMerge(content(path.join(base.snapshotRoot, 'tree'), file), content(root, file), content(candidateRoot, file))
      if (merged) {
        action = 'write_merged'
        proposedHash = sha256(merged)
      } else {
        action = 'conflict'
        conflicts.push(file)
      }
    } else {
      action = 'conflict'
      conflicts.push(file)
    }
    entries.push({
      file,
      action,
      base: recordForPlan(baseRecord),
      local: recordForPlan(localRecord),
      incoming: recordForPlan(incomingRecord),
      proposedHash,
    })
  }
  const transactionId = options.transactionId ?? crypto.randomUUID()
  const plan = {
    schemaVersion: PLAN_SCHEMA,
    transactionId,
    nonce: options.nonce ?? crypto.randomUUID(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    currentRelease: state.currentRelease,
    candidateRelease: incomingRelease,
    baseSnapshot: state.baseSnapshot,
    currentManifestDigest: currentManifest.manifestDigest,
    candidateManifestDigest: incomingManifest.manifestDigest,
    entries,
    conflictRoots: minimalConflictRoots(conflicts),
    deletes: entries.filter((entry) => entry.action === 'delete').map((entry) => entry.file),
  }
  plan.planDigest = digest(plan)
  return plan
}

export function previewUpdate(root, candidateRoot, options = {}) {
  return buildPlan(root, candidateRoot, options)
}

function transactionRoot(root, transactionId) {
  return safeJoin(statePaths(root).transactionsRoot, transactionId)
}

function updateState(root, transform) {
  const paths = statePaths(root)
  const state = readState(root)
  const next = transform(structuredClone(state))
  writeJsonAtomic(paths.stateFile, next)
  return next
}

function writeTransaction(root, plan, phase, extra = {}) {
  const receiptPath = path.join(transactionRoot(root, plan.transactionId), 'transaction.json')
  writeJsonAtomic(receiptPath, {
    schemaVersion: 1,
    transactionId: plan.transactionId,
    nonce: plan.nonce,
    planDigest: plan.planDigest,
    phase,
    currentRelease: plan.currentRelease,
    candidateRelease: plan.candidateRelease,
    updatedAt: new Date().toISOString(),
    ...extra,
  })
}

function copyConflictInputs(root, candidateRoot, baseRoot, plan, destination) {
  for (const conflictRoot of plan.conflictRoots) {
    for (const [label, sourceRoot] of [['base', baseRoot], ['local', root], ['incoming', candidateRoot]]) {
      const source = safeJoin(sourceRoot, conflictRoot)
      if (!fs.existsSync(source)) continue
      const records = scanRoots(sourceRoot, [conflictRoot])
      copyRecords(sourceRoot, path.join(destination, label), records)
    }
  }
  writeJsonAtomic(path.join(destination, 'README.json'), {
    transactionId: plan.transactionId,
    nonce: plan.nonce,
    planDigest: plan.planDigest,
    conflictRoots: plan.conflictRoots,
    instruction: 'Place reviewed outputs under output/ using only the declared conflict roots, then run seal-resolution.',
  })
}

export function prepareUpdate(root, candidateRoot, options = {}) {
  const release = acquireLock(root)
  try {
    const existing = readState(root)
    if (existing.activeTransactionId) throw new Error(`Home Base must recover or finish active transaction ${existing.activeTransactionId}`)
    const plan = buildPlan(root, candidateRoot, options)
    const txRoot = transactionRoot(root, plan.transactionId)
    fs.mkdirSync(txRoot, { recursive: true })
    writeJsonAtomic(path.join(txRoot, 'plan.json'), plan)
    const base = loadSnapshot(root, existing)
    if (plan.conflictRoots.length > 0) copyConflictInputs(root, candidateRoot, path.join(base.snapshotRoot, 'tree'), plan, path.join(txRoot, 'resolution'))
    updateState(root, (state) => ({ ...state, activeTransactionId: plan.transactionId }))
    writeTransaction(root, plan, 'prepared')
    return { plan, planPath: path.join(txRoot, 'plan.json'), resolutionRoot: path.join(txRoot, 'resolution') }
  } finally {
    release()
  }
}

function readPlan(planPath) {
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'))
  const claimed = plan.planDigest
  const without = { ...plan }
  delete without.planDigest
  if (plan.schemaVersion !== PLAN_SCHEMA || digest(without) !== claimed) throw new Error('Prepared update plan digest is invalid')
  return plan
}

function underAny(relativePath, roots) {
  return roots.some((root) => relativePath === root || relativePath.startsWith(`${root}/`))
}

export function sealResolution(root, planPath) {
  const release = acquireLock(root)
  try {
    const plan = readPlan(planPath)
    if (plan.conflictRoots.length === 0) throw new Error('The prepared plan has no conflicts to resolve')
    const outputRoot = path.join(transactionRoot(root, plan.transactionId), 'resolution', 'output')
    if (!fs.existsSync(outputRoot)) throw new Error('Resolution output directory is missing')
    const records = scanWholeTree(outputRoot)
    for (const relativePath of records.keys()) {
      const declared = underAny(relativePath, plan.conflictRoots)
        || plan.conflictRoots.some((root) => root.startsWith(`${relativePath}/`))
      if (!declared) throw new Error(`Resolution contains an undeclared path: ${relativePath}`)
    }
    for (const conflictRoot of plan.conflictRoots) {
      if (![...records.keys()].some((file) => file === conflictRoot || file.startsWith(`${conflictRoot}/`))) {
        throw new Error(`Resolution is incomplete for conflict root: ${conflictRoot}`)
      }
    }
    const resolution = {
      schemaVersion: 1,
      transactionId: plan.transactionId,
      nonce: plan.nonce,
      planDigest: plan.planDigest,
      conflictRoots: plan.conflictRoots,
      inputHashes: plan.entries.filter((entry) => underAny(entry.file, plan.conflictRoots)).map((entry) => ({
        file: entry.file,
        base: entry.base,
        local: entry.local,
        incoming: entry.incoming,
      })),
      outputRecords: serializedRecords(records),
      outputDigest: recordsDigest(records),
    }
    writeJsonAtomic(path.join(transactionRoot(root, plan.transactionId), 'resolution', 'resolution.json'), resolution)
    return resolution
  } finally {
    release()
  }
}

function verifyInputs(root, candidateRoot, plan) {
  const state = readState(root)
  if (state.activeTransactionId !== plan.transactionId) throw new Error('Prepared plan is not the active transaction')
  if (stable(state.currentRelease) !== stable(plan.currentRelease) || stable(state.baseSnapshot) !== stable(plan.baseSnapshot)) {
    throw new Error('Prepared plan no longer matches the current release/base state')
  }
  const base = loadSnapshot(root, state)
  const local = scanRoots(root, readManifest(root).manifest.maintainedPaths)
  const incoming = scanRoots(candidateRoot, readManifest(candidateRoot).manifest.maintainedPaths)
  if (stable(releaseIdentity(candidateRoot)) !== stable(plan.candidateRelease)) throw new Error('Incoming release identity changed after prepare')
  for (const entry of plan.entries) {
    if (!sameRecord(base.records.get(entry.file), entry.base) || !sameRecord(local.get(entry.file), entry.local) || !sameRecord(incoming.get(entry.file), entry.incoming)) {
      throw new Error(`TOCTOU input changed after prepare: ${entry.file}`)
    }
  }
  return { base, local, incoming }
}

function loadResolution(root, plan) {
  if (plan.conflictRoots.length === 0) return { records: new Map(), outputRoot: null, receipt: null }
  const resolutionRoot = path.join(transactionRoot(root, plan.transactionId), 'resolution')
  const receiptPath = path.join(resolutionRoot, 'resolution.json')
  if (!fs.existsSync(receiptPath)) throw new Error('Conflicts require a complete transaction-bound reviewed resolution')
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'))
  if (receipt.transactionId !== plan.transactionId || receipt.nonce !== plan.nonce || receipt.planDigest !== plan.planDigest || stable(receipt.conflictRoots) !== stable(plan.conflictRoots)) {
    throw new Error('Resolution is foreign, incomplete, or stale')
  }
  const outputRoot = path.join(resolutionRoot, 'output')
  const records = scanWholeTree(outputRoot)
  if (recordsDigest(records) !== receipt.outputDigest || stable(serializedRecords(records)) !== stable(receipt.outputRecords)) {
    throw new Error('Resolution outputs changed after review')
  }
  const expectedInputs = plan.entries.filter((entry) => underAny(entry.file, plan.conflictRoots)).map((entry) => ({ file: entry.file, base: entry.base, local: entry.local, incoming: entry.incoming }))
  if (stable(expectedInputs) !== stable(receipt.inputHashes)) throw new Error('Resolution input binding is stale')
  return { records, outputRoot, receipt }
}

function materializeManaged(root, candidateRoot, plan, inputs, resolution, destination) {
  const finalFiles = new Map()
  for (const entry of plan.entries) {
    if (entry.local?.type !== 'file' && entry.incoming?.type !== 'file' && entry.base?.type !== 'file') continue
    if (underAny(entry.file, plan.conflictRoots)) continue
    if (entry.action === 'delete') continue
    if (['unchanged', 'converged', 'preserve_local'].includes(entry.action)) {
      if (entry.local?.type === 'file') finalFiles.set(entry.file, content(root, entry.file))
    } else if (entry.action === 'write_incoming') {
      if (entry.incoming?.type === 'file') finalFiles.set(entry.file, content(candidateRoot, entry.file))
    } else if (entry.action === 'write_merged') {
      const merged = threeWayMerge(content(path.join(inputs.base.snapshotRoot, 'tree'), entry.file), content(root, entry.file), content(candidateRoot, entry.file))
      if (!merged || sha256(merged) !== entry.proposedHash) throw new Error(`Deterministic merge changed after prepare: ${entry.file}`)
      finalFiles.set(entry.file, merged)
    } else if (entry.action === 'conflict') {
      throw new Error(`Unresolved conflict reached staging: ${entry.file}`)
    }
  }
  if (resolution.outputRoot) {
    for (const [relativePath, record] of resolution.records.entries()) {
      if (record.type === 'file') finalFiles.set(relativePath, content(resolution.outputRoot, relativePath))
    }
  }
  for (const [relativePath, bytes] of [...finalFiles.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const target = safeJoin(destination, relativePath)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, bytes)
  }
}

function copyWholeTree(source, destination) {
  const records = scanWholeTree(source)
  copyRecords(source, destination, records)
}

function createCheckpoint(root, plan, restorePaths) {
  const txRoot = transactionRoot(root, plan.transactionId)
  const checkpointRoot = path.join(txRoot, 'checkpoint')
  const treeRoot = path.join(checkpointRoot, 'tree')
  const maintainedPaths = minimalConflictRoots(restorePaths)
  const records = scanRoots(root, maintainedPaths)
  copyRecords(root, treeRoot, records)
  const checkpoint = {
    schemaVersion: 1,
    transactionId: plan.transactionId,
    planDigest: plan.planDigest,
    maintainedPaths,
    records: serializedRecords(records),
    digest: recordsDigest(records),
  }
  writeJsonAtomic(path.join(checkpointRoot, 'checkpoint.json'), checkpoint)
  return { checkpointRoot, treeRoot, checkpoint }
}

function verifyCheckpoint(checkpointRoot) {
  const checkpoint = JSON.parse(fs.readFileSync(path.join(checkpointRoot, 'checkpoint.json'), 'utf8'))
  const records = scanRoots(path.join(checkpointRoot, 'tree'), checkpoint.maintainedPaths)
  if (recordsDigest(records) !== checkpoint.digest || stable(serializedRecords(records)) !== stable(checkpoint.records)) {
    throw new Error('Update checkpoint is missing or tampered')
  }
  return { checkpoint, records, treeRoot: path.join(checkpointRoot, 'tree') }
}

function restoreCheckpoint(root, checkpointRoot, additionalRemovalPaths = []) {
  const verified = verifyCheckpoint(checkpointRoot)
  const removalPaths = minimalConflictRoots([
    ...verified.checkpoint.maintainedPaths,
    ...additionalRemovalPaths,
  ])
  for (const maintained of removalPaths) {
    const target = safeJoin(root, maintained)
    if (fs.existsSync(target)) removeExact(target, root)
  }
  copyRecords(verified.treeRoot, root, verified.records)
  return verified
}

function swapMaintainedRoots(root, stagedRoot, maintainedPaths, transactionRootPath, fault) {
  const journalRoot = path.join(transactionRootPath, 'journal-old')
  fs.mkdirSync(journalRoot, { recursive: true })
  const journal = []
  for (const maintained of maintainedPaths) {
    const target = safeJoin(root, maintained)
    const incoming = safeJoin(stagedRoot, maintained)
    const old = safeJoin(journalRoot, maintained)
    fs.mkdirSync(path.dirname(old), { recursive: true })
    const step = { path: maintained, hadCurrent: fs.existsSync(target), hasIncoming: fs.existsSync(incoming), status: 'prepared' }
    journal.push(step)
    writeJsonAtomic(path.join(transactionRootPath, 'journal.json'), { steps: journal })
    if (step.hadCurrent) fs.renameSync(target, old)
    if (step.hasIncoming) {
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.renameSync(incoming, target)
    }
    step.status = 'committed'
    writeJsonAtomic(path.join(transactionRootPath, 'journal.json'), { steps: journal })
    fsyncDirectory(path.dirname(target))
    fault?.(`after_swap:${maintained}`)
  }
  return journal
}

function appendHistory(root, heading, fields) {
  const historyPath = path.join(root, 'memory', 'UPDATE-HISTORY.md')
  const lines = Object.entries(fields).map(([label, value]) => `- ${label}: ${value}`).join('\n')
  fs.appendFileSync(historyPath, `\n## ${heading}\n\n${lines}\n`)
}

export function applyPreparedUpdate(root, candidateRoot, planPath, options = {}) {
  const release = acquireLock(root)
  const plan = readPlan(planPath)
  const paths = statePaths(root)
  const txRoot = transactionRoot(root, plan.transactionId)
  let checkpoint
  try {
    if (options.approval !== plan.planDigest) throw new Error('Apply requires explicit approval of the exact reviewed plan digest')
    if (plan.deletes.length > 0 && options.deletionApproval !== plan.planDigest) throw new Error('Reviewed deletes require exact explicit deletion approval')
    const inputs = verifyInputs(root, candidateRoot, plan)
    const resolution = loadResolution(root, plan)
    updateState(root, (state) => state)
    writeTransaction(root, plan, 'approved')
    options.fault?.('approved')

    const stagedRoot = path.join(paths.stagingRoot, plan.transactionId)
    if (fs.existsSync(stagedRoot)) removeExact(stagedRoot, paths.stateRoot)
    fs.mkdirSync(stagedRoot, { recursive: true })
    copyWholeTree(root, stagedRoot)
    const candidateManifest = readManifest(candidateRoot).manifest
    for (const maintained of candidateManifest.maintainedPaths) {
      const target = safeJoin(stagedRoot, maintained)
      if (fs.existsSync(target)) removeExact(target, stagedRoot)
    }
    materializeManaged(root, candidateRoot, plan, inputs, resolution, stagedRoot)
    options.validate?.(stagedRoot)
    scanWholeTree(stagedRoot)
    writeTransaction(root, plan, 'staged')
    options.fault?.('staged')

    verifyInputs(root, candidateRoot, plan)
    loadResolution(root, plan)
    const currentManifest = readManifest(root).manifest
    const rollbackPaths = [...new Set([
      ...currentManifest.maintainedPaths,
      ...candidateManifest.maintainedPaths,
    ])]
    checkpoint = createCheckpoint(root, plan, rollbackPaths)
    verifyCheckpoint(checkpoint.checkpointRoot)
    const checkpointDigest = checkpoint.checkpoint.digest
    writeJsonAtomic(paths.recoveryMarker, {
      schemaVersion: 1,
      transactionId: plan.transactionId,
      planDigest: plan.planDigest,
      checkpointDigest,
      phase: 'committing',
    })
    writeTransaction(root, plan, 'committing', { checkpointDigest })
    options.fault?.('committing')

    try {
      swapMaintainedRoots(root, stagedRoot, candidateManifest.maintainedPaths, txRoot, options.fault)
      options.validate?.(root)
    } catch (error) {
      if (error?.simulatedAbrupt === true) throw error
      writeTransaction(root, plan, 'rolling_back', { error: error.message })
      restoreCheckpoint(root, checkpoint.checkpointRoot, candidateManifest.maintainedPaths)
      options.validate?.(root)
      updateState(root, (state) => ({ ...state, activeTransactionId: null }))
      writeTransaction(root, plan, 'recovered', { recovery: 'checkpoint_restored', error: error.message })
      if (fs.existsSync(paths.recoveryMarker)) removeExact(paths.recoveryMarker, paths.stateRoot)
      throw new Error(`Update failed and the verified checkpoint was restored: ${error.message}`)
    }

    const newRelease = releaseIdentity(root)
    if (stable(newRelease) !== stable(plan.candidateRelease)) throw new Error('Committed tree does not identify as the reviewed candidate release')
    const baseName = `${newRelease.releaseId.replace(/[^a-z0-9.-]/gi, '-')}-${newRelease.manifestDigest.slice(0, 12)}`
    const basePath = `bases/${baseName}`
    const nextSnapshotRoot = safeJoin(paths.stateRoot, basePath)
    if (fs.existsSync(nextSnapshotRoot)) removeExact(nextSnapshotRoot, paths.stateRoot)
    const nextSnapshot = makeSnapshot(root, newRelease, nextSnapshotRoot)
    updateState(root, (state) => ({
      ...state,
      currentRelease: newRelease,
      baseSnapshot: { path: basePath, digest: nextSnapshot.digest },
      lastSuccessfulTransactionId: plan.transactionId,
      activeTransactionId: null,
    }))
    writeTransaction(root, plan, 'committed', { checkpointDigest, nextBaseDigest: nextSnapshot.digest })
    if (fs.existsSync(paths.recoveryMarker)) removeExact(paths.recoveryMarker, paths.stateRoot)
    appendHistory(root, `${newRelease.version} — update committed`, {
      Result: 'applied after exact plan approval and validation',
      Transaction: plan.transactionId,
      'Plan digest': plan.planDigest,
      Checkpoint: path.relative(root, checkpoint.checkpointRoot),
    })
    return { plan, checkpoint: checkpoint.checkpointRoot, state: readState(root) }
  } finally {
    release()
  }
}

export function recoverUpdate(root, options = {}) {
  const release = acquireLock(root)
  try {
    const state = readState(root)
    if (!state.activeTransactionId) return { recovered: false, reason: 'no_active_transaction' }
    const txRoot = transactionRoot(root, state.activeTransactionId)
    const plan = readPlan(path.join(txRoot, 'plan.json'))
    const receiptPath = path.join(txRoot, 'transaction.json')
    const receipt = fs.existsSync(receiptPath) ? JSON.parse(fs.readFileSync(receiptPath, 'utf8')) : { phase: 'prepared' }
    if (['prepared', 'approved', 'staged'].includes(receipt.phase)) {
      updateState(root, (current) => ({ ...current, activeTransactionId: null }))
      writeTransaction(root, plan, 'recovered', { recovery: 'aborted_before_current_tree_mutation' })
      return { recovered: true, action: 'aborted_before_mutation' }
    }
    const checkpointRoot = path.join(txRoot, 'checkpoint')
    const currentMaintainedPaths = readManifest(root).manifest.maintainedPaths
    restoreCheckpoint(root, checkpointRoot, currentMaintainedPaths)
    options.validate?.(root)
    const paths = statePaths(root)
    loadSnapshot(root, {
      ...state,
      currentRelease: plan.currentRelease,
      baseSnapshot: plan.baseSnapshot,
    })
    updateState(root, (current) => ({
      ...current,
      currentRelease: plan.currentRelease,
      baseSnapshot: plan.baseSnapshot,
      lastSuccessfulTransactionId: current.lastSuccessfulTransactionId === plan.transactionId
        ? null
        : current.lastSuccessfulTransactionId,
      activeTransactionId: null,
    }))
    writeTransaction(root, plan, 'recovered', { recovery: 'checkpoint_restored_after_interruption' })
    if (fs.existsSync(paths.recoveryMarker)) removeExact(paths.recoveryMarker, paths.stateRoot)
    appendHistory(root, `Interrupted update recovered`, {
      Result: 'verified checkpoint restored; update not applied',
      Transaction: plan.transactionId,
    })
    return { recovered: true, action: 'checkpoint_restored' }
  } finally {
    release()
  }
}

export function rollbackCommittedUpdate(root, transactionId, approval, options = {}) {
  const release = acquireLock(root)
  try {
    const state = readState(root)
    if (state.activeTransactionId) throw new Error(`Cannot rollback while transaction ${state.activeTransactionId} is active`)
    if (state.lastSuccessfulTransactionId !== transactionId || approval !== transactionId) throw new Error('Rollback requires the exact latest committed transaction id as approval')
    const txRoot = transactionRoot(root, transactionId)
    const plan = readPlan(path.join(txRoot, 'plan.json'))
    const checkpointRoot = path.join(txRoot, 'checkpoint')
    const paths = statePaths(root)
    updateState(root, (current) => ({ ...current, activeTransactionId: transactionId }))
    writeJsonAtomic(paths.recoveryMarker, {
      schemaVersion: 1,
      transactionId,
      planDigest: plan.planDigest,
      phase: 'rolling_back',
    })
    writeTransaction(root, plan, 'rolling_back', { recovery: 'explicit_latest_transaction_rollback' })
    options.fault?.('rollback_marker')
    const currentMaintainedPaths = readManifest(root).manifest.maintainedPaths
    restoreCheckpoint(root, checkpointRoot, currentMaintainedPaths)
    options.validate?.(root)
    options.fault?.('rollback_restored')
    loadSnapshot(root, {
      ...state,
      currentRelease: plan.currentRelease,
      baseSnapshot: plan.baseSnapshot,
    })
    updateState(root, (current) => ({
      ...current,
      currentRelease: plan.currentRelease,
      baseSnapshot: plan.baseSnapshot,
      lastSuccessfulTransactionId: null,
      activeTransactionId: null,
    }))
    writeTransaction(root, plan, 'rolled_back', { previousBaseDigest: plan.baseSnapshot.digest })
    if (fs.existsSync(paths.recoveryMarker)) removeExact(paths.recoveryMarker, paths.stateRoot)
    appendHistory(root, `Rollback from ${plan.candidateRelease.version}`, {
      Result: 'verified checkpoint restored',
      Transaction: transactionId,
    })
    return readState(root)
  } finally {
    release()
  }
}

export const updateInternals = {
  digest,
  portable,
  readManifest,
  releaseIdentity,
  scanRoots,
  scanWholeTree,
  statePaths,
  threeWayMerge,
  verifyCheckpoint,
}
