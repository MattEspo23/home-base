import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const STATE_SCHEMA = 2
const PLAN_SCHEMA = 2
const PRESERVED_RUNTIME_ROOT = '.home-base'
// The user's private overlay. It is never packaged, planned, staged, copied
// into checkpoints, bases, or journals, and never deleted by an update.
const INSTANCE_ROOT = 'instance'
const UNSCANNED_ROOTS = new Set([PRESERVED_RUNTIME_ROOT, '.git', INSTANCE_ROOT])
// Folders no release may ever claim, rename, or delete.
const RESERVED_ROOTS = [INSTANCE_ROOT, PRESERVED_RUNTIME_ROOT, '.git']

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

// Manifest and record paths are POSIX-relative, NFC-normalized, and may not
// contain empty, `.` or `..` segments, backslashes, NUL bytes, or a drive or
// root prefix. Nothing is silently rewritten, so `x/../instance` or `./you`
// can never resolve onto a protected folder.
function portable(relativePath) {
  if (typeof relativePath !== 'string') throw new Error('Update path must be a string')
  const normalized = relativePath.normalize('NFC')
  if (!normalized || normalized.includes('\\') || normalized.includes('\0') || path.posix.isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`Unsafe update path: ${relativePath}`)
  }
  if (normalized.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`Unsafe update path: ${relativePath}`)
  }
  return normalized
}

// Case-insensitive file systems (macOS, Windows) treat `Instance` and
// `instance` as one folder, so every ownership comparison uses a folded key.
function foldKey(relativePath) {
  return relativePath.normalize('NFKC').toLocaleLowerCase('en-US')
}

function overlap(left, right) {
  const a = foldKey(left)
  const b = foldKey(right)
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
}

// Release roots are single top-level names.
function rootName(relativePath, label) {
  const normalized = portable(relativePath)
  if (normalized.includes('/')) throw new Error(`${label} paths must be single top-level names: ${relativePath}`)
  return normalized
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

// Every rename or delete of a top-level folder inside the Home Base folder goes
// through this guard. It refuses the private instance zone, runtime state, Git
// metadata, and every user-owned root, comparing folded names and the real
// on-disk identity (device and inode), so a case variant, a Unicode variant,
// or a symbolic link can never alias a protected folder.
function protectedNames(...lists) {
  return [...new Set([...RESERVED_ROOTS, ...lists.flat().filter((item) => typeof item === 'string')])]
}

function assertMutableTarget(root, relativePath, protectedList) {
  const normalized = portable(relativePath)
  const first = normalized.split('/')[0]
  const folded = new Set(protectedList.map(foldKey))
  if (folded.has(foldKey(first))) throw new Error(`Refusing to rename or delete a protected folder: ${first}`)
  const target = safeJoin(root, normalized)
  const firstAbsolute = path.join(root, first)
  const stat = fs.lstatSync(firstAbsolute, { throwIfNoEntry: false })
  if (stat) {
    if (stat.isSymbolicLink()) throw new Error(`Refusing to rename or delete through a symbolic link: ${first}`)
    const realName = path.basename(fs.realpathSync.native(firstAbsolute))
    if (folded.has(foldKey(realName))) throw new Error(`Refusing to rename or delete a protected folder: ${realName}`)
    for (const name of protectedList) {
      const other = fs.statSync(path.join(root, name), { throwIfNoEntry: false })
      if (other && other.dev === stat.dev && other.ino === stat.ino) throw new Error(`Refusing to rename or delete a protected folder: ${name}`)
    }
  }
  return target
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
    if (UNSCANNED_ROOTS.has(entry.name.normalize('NFKC').toLocaleLowerCase('en-US'))) continue
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
  }
  manifest.maintainedPaths = manifest.maintainedPaths.map((item) => rootName(item, 'Maintained'))
  manifest.userOwnedPaths = manifest.userOwnedPaths.map((item) => rootName(item, 'User-owned'))
  manifest.starterFiles = manifest.starterFiles.map(portable)
  assertNoRootOverlap(manifest.maintainedPaths, 'Maintained')
  assertNoRootOverlap(manifest.userOwnedPaths, 'User-owned')
  // instancePaths is an additive schema-2 field: releases before 1.1 omit it.
  if (manifest.instancePaths !== undefined && !Array.isArray(manifest.instancePaths)) throw new Error('Release manifest instancePaths must be a list')
  manifest.instancePaths = (manifest.instancePaths ?? []).map(portable)
  if (manifest.instancePaths.some((item) => item !== INSTANCE_ROOT)) throw new Error(`The only supported instance path is ${INSTANCE_ROOT}`)
  const claimed = [...manifest.maintainedPaths, ...manifest.userOwnedPaths].filter((item) => overlap(item, INSTANCE_ROOT))
  if (claimed.length > 0) throw new Error(`Release manifest may not claim the instance zone: ${claimed.join(', ')}`)
  const reserved = [...manifest.maintainedPaths, ...manifest.userOwnedPaths].filter((item) => RESERVED_ROOTS.some((name) => overlap(item, name)))
  if (reserved.length > 0) throw new Error(`Release manifest may not claim a reserved folder: ${reserved.join(', ')}`)
  const unsafe = manifest.maintainedPaths.filter((maintained) => manifest.userOwnedPaths.some((owned) => overlap(maintained, owned)))
  if (unsafe.length > 0) throw new Error(`Candidate maintained paths overlap protected user-owned paths: ${unsafe.join(', ')}`)
  return { manifest, manifestDigest: sha256(bytes) }
}

// A repository URL is recorded in state, plans, and receipts, and printed by
// init, so it may never carry a user name, password, or token.
function assertSafeRepository(value) {
  if (typeof value !== 'string' || !value.trim() || /[\s\0]/.test(value)) throw new Error('Source repository must be a plain URL or name')
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*@/i.test(value)) {
    throw new Error('Source repository URLs may not contain a user name, password, or token; pass the URL without them')
  }
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
  assertSafeRepository(sourceRepository)
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

// The lock folder appears atomically with its owner record (written in a
// temporary folder, then renamed into place). A lock without a readable owner
// is treated as stale only once it is old enough that no acquirer can still be
// writing it.
const OWNERLESS_LOCK_GRACE_MS = 60_000

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
    } else {
      const age = Date.now() - fs.statSync(paths.lockRoot).mtimeMs
      if (age < OWNERLESS_LOCK_GRACE_MS) throw new Error('Another Home Base update process is acquiring the lock; try again shortly')
    }
    removeExact(paths.lockRoot, paths.stateRoot)
  }
  const pending = path.join(paths.stateRoot, `update.lock.pending-${process.pid}-${crypto.randomUUID()}`)
  fs.mkdirSync(pending)
  try {
    writeJsonAtomic(path.join(pending, 'owner.json'), { pid: process.pid, nonce: crypto.randomUUID() })
    try {
      fs.renameSync(pending, paths.lockRoot)
    } catch (error) {
      if (['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error.code)) throw new Error('Another Home Base update process took the lock first')
      throw error
    }
  } finally {
    if (fs.existsSync(pending)) removeExact(pending, paths.stateRoot)
  }
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
  if (identityOverride.sourceRepository !== undefined) assertSafeRepository(identityOverride.sourceRepository)
  // init sweeps staging, so it takes the same lock as prepare and apply.
  const release = acquireLock(root)
  try {
    const paths = statePaths(root)
    if (fs.existsSync(paths.stateFile)) {
      const current = readState(root)
      loadSnapshot(root, current)
      // Clean up staging left by an earlier updater (including 1.0.x, which kept
      // a whole-tree copy). Never touch it while a transaction is in flight.
      if (!current.activeTransactionId) sweepStaging(root)
      return current
    }
    const identity = releaseIdentity(root, identityOverride)
    scanWholeTree(root)
    const installationId = crypto.randomUUID()
    const baseName = `${identity.releaseId.replace(/[^a-z0-9.-]/gi, '-')}-${identity.manifestDigest.slice(0, 12)}`
    const basePath = `bases/${baseName}`
    const snapshot = makeSnapshot(root, identity, path.join(paths.stateRoot, basePath))
    const state = {
      schemaVersion: STATE_SCHEMA,
      installationId,
      currentRelease: identity,
      baseSnapshot: { path: basePath, digest: snapshot.digest },
      lastSuccessfulTransactionId: null,
      rollbackStack: [],
      activeTransactionId: null,
    }
    sweepStaging(root)
    writeJsonAtomic(paths.stateFile, state)
    return state
  } finally {
    release()
  }
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
  if (fs.existsSync(path.join(candidateRoot, INSTANCE_ROOT))) throw new Error('Candidate releases may not contain an instance/ folder')
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
    sweepStaging(root)
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

// Staging holds only what validation of the result needs: the materialized
// maintained roots plus a short-lived copy of the user-owned roots. instance/,
// runtime state, and unmanaged paths are never copied, and staging is removed
// after every apply outcome.
function copyUserOwnedRoots(source, destination, userOwnedPaths) {
  copyRecords(source, destination, scanRoots(source, userOwnedPaths))
}

// Callers sweep only when no transaction is active (or, inside apply, once the
// outcome is final), so nothing here is needed for recovery. journal-old
// folders left by an older updater are removed too.
function sweepStaging(root) {
  const { stagingRoot, stateRoot, transactionsRoot } = statePaths(root)
  const removed = []
  if (fs.existsSync(stagingRoot)) {
    for (const entry of fs.readdirSync(stagingRoot)) {
      removeExact(path.join(stagingRoot, entry), stateRoot)
      removed.push(entry)
    }
  }
  if (fs.existsSync(transactionsRoot)) {
    let active = null
    try {
      if (fs.existsSync(statePaths(root).stateFile)) active = readState(root).activeTransactionId
    } catch {
      return removed
    }
    for (const transactionId of fs.readdirSync(transactionsRoot)) {
      if (transactionId !== active) removeJournalOld(root, transactionId)
    }
  }
  return removed
}

// journal-old holds the replaced maintained roots during a swap. Recovery and
// rollback use the verified checkpoint, so it is removed once the outcome is final.
function removeJournalOld(root, transactionId) {
  for (const leftover of ['journal-old', 'restore']) {
    const target = path.join(transactionRoot(root, transactionId), leftover)
    if (fs.existsSync(target)) removeExact(target, statePaths(root).stateRoot)
  }
}

function createCheckpoint(root, plan, restorePaths, protectedList) {
  const txRoot = transactionRoot(root, plan.transactionId)
  const checkpointRoot = path.join(txRoot, 'checkpoint')
  const treeRoot = path.join(checkpointRoot, 'tree')
  const maintainedPaths = minimalConflictRoots(restorePaths)
  // A checkpoint copies only maintained roots: never instance/ or user files.
  for (const maintained of maintainedPaths) assertMutableTarget(root, maintained, protectedList)
  const records = scanRoots(root, maintainedPaths)
  copyRecords(root, treeRoot, records)
  const checkpoint = {
    schemaVersion: 1,
    transactionId: plan.transactionId,
    planDigest: plan.planDigest,
    maintainedPaths,
    protectedPaths: protectedList,
    records: serializedRecords(records),
    digest: recordsDigest(records),
  }
  writeJsonAtomic(path.join(checkpointRoot, 'checkpoint.json'), checkpoint)
  return { checkpointRoot, treeRoot, checkpoint }
}

function verifyCheckpoint(checkpointRoot) {
  const checkpoint = JSON.parse(fs.readFileSync(path.join(checkpointRoot, 'checkpoint.json'), 'utf8'))
  if (!Array.isArray(checkpoint.maintainedPaths)) throw new Error('Update checkpoint is missing or tampered')
  checkpoint.maintainedPaths = checkpoint.maintainedPaths.map(portable)
  const records = scanRoots(path.join(checkpointRoot, 'tree'), checkpoint.maintainedPaths)
  if (recordsDigest(records) !== checkpoint.digest || stable(serializedRecords(records)) !== stable(checkpoint.records)) {
    throw new Error('Update checkpoint is missing or tampered')
  }
  return { checkpoint, records, treeRoot: path.join(checkpointRoot, 'tree') }
}

// The `system` root goes first, so the updater and validator are back before
// anything else is touched.
function systemFirst(roots) {
  return [...roots].sort((left, right) => Number(right === 'system') - Number(left === 'system') || left.localeCompare(right))
}

// Restores one maintained root at a time by copy-then-swap: the checkpoint copy
// is built in a sibling folder first, so an I/O failure part-way leaves the live
// root in place instead of missing.
// Verifies the checkpoint and checks every target before anything moves.
function preflightRestore(root, checkpointRoot, additionalRemovalPaths = [], protectedList = []) {
  const verified = verifyCheckpoint(checkpointRoot)
  const guard = protectedNames(protectedList, verified.checkpoint.protectedPaths ?? [])
  const restorePaths = systemFirst(minimalConflictRoots([
    ...verified.checkpoint.maintainedPaths,
    ...additionalRemovalPaths,
  ]))
  for (const maintained of restorePaths) assertMutableTarget(root, maintained, guard)
  return { verified, guard, restorePaths }
}

function restoreCheckpoint(root, checkpointRoot, additionalRemovalPaths = [], { protectedList = [], fault } = {}) {
  const { verified, guard, restorePaths } = preflightRestore(root, checkpointRoot, additionalRemovalPaths, protectedList)
  const workRoot = path.join(path.dirname(checkpointRoot), 'restore')
  if (fs.existsSync(workRoot)) removeExact(workRoot, path.dirname(checkpointRoot))
  for (const maintained of restorePaths) {
    const target = assertMutableTarget(root, maintained, guard)
    const records = new Map([...verified.records].filter(([file]) => file === maintained || file.startsWith(`${maintained}/`)))
    fault?.(`restore_copy:${maintained}`)
    copyRecords(verified.treeRoot, path.join(workRoot, 'new'), records)
    const incoming = safeJoin(path.join(workRoot, 'new'), maintained)
    const old = safeJoin(path.join(workRoot, 'old'), maintained)
    if (fs.lstatSync(target, { throwIfNoEntry: false })) {
      fs.mkdirSync(path.dirname(old), { recursive: true })
      fs.renameSync(target, old)
    }
    if (records.size > 0) fs.renameSync(incoming, target)
    fsyncDirectory(path.dirname(target))
    if (fs.existsSync(old)) removeExact(old, workRoot)
  }
  removeExact(workRoot, path.dirname(checkpointRoot))
  fault?.('restored')
  confirmRestored(root, verified, restorePaths)
  return verified
}

// Paths under `roots` whose live record differs from every accepted record set.
function mismatchedPaths(root, roots, acceptedSets) {
  const live = scanRoots(root, roots)
  const files = new Set([...live.keys(), ...acceptedSets.flatMap((records) => [...records.keys()])])
  return [...files]
    .filter((file) => underAny(file, roots))
    .filter((file) => !acceptedSets.some((records) => sameRecord(live.get(file), records.get(file))))
    .sort()
}

// A restore is confirmed by cryptographic equality with the checkpoint's
// recorded hashes, never by running the restored tree's own (possibly older)
// proof: 1.0.x proofs refuse any personalized install. Every restored root
// must match the checkpoint exactly, and roots it did not record must be gone.
function confirmRestored(root, verified, restorePaths) {
  const mismatched = mismatchedPaths(root, restorePaths, [verified.records])
  if (mismatched.length > 0) {
    throw new Error(`Restored maintained files do not match the checkpoint: ${mismatched.slice(0, 20).join(', ')}`)
  }
}

// A copy of the updater that wrote this transaction, kept with it, so recovery
// still runs if the live system/ folder is missing or broken.
const CONTRACT_FILE = fileURLToPath(import.meta.url)
const RECOVERY_TOOL_FILES = [
  ['update.mjs', path.join(path.dirname(CONTRACT_FILE), '..', 'update.mjs')],
  ['lib/safe-update-contract.mjs', CONTRACT_FILE],
]

function writeRecoveryTool(root, transactionId) {
  const toolSystem = path.join(transactionRoot(root, transactionId), 'tool', 'system')
  if (fs.existsSync(toolSystem)) removeExact(toolSystem, statePaths(root).stateRoot)
  for (const [relative, source] of RECOVERY_TOOL_FILES) {
    if (fs.existsSync(source)) copyFileDurable(source, path.join(toolSystem, relative))
  }
  return recoveryCommand(root, transactionId)
}

function recoveryCommand(root, transactionId) {
  const tool = path.join(transactionRoot(root, transactionId), 'tool', 'system', 'update.mjs')
  return `node "${tool}" recover --root "${path.resolve(root)}"`
}

// The copy kept with the transaction is the updater that wrote it. The
// release now in system/ may be an older one put back by the restore (a 1.0.x
// recover refuses any personalized install), so the copy comes first.
function recoveryAdvice(root, transactionId) {
  return `Before anything else, run the updater copy kept with this transaction: ${recoveryCommand(root, transactionId)}`
}

function swapMaintainedRoots(root, stagedRoot, maintainedPaths, transactionRootPath, fault, protectedList) {
  const journalRoot = path.join(transactionRootPath, 'journal-old')
  fs.mkdirSync(journalRoot, { recursive: true })
  for (const maintained of maintainedPaths) assertMutableTarget(root, maintained, protectedList)
  const journal = []
  for (const maintained of maintainedPaths) {
    const target = assertMutableTarget(root, maintained, protectedList)
    const incoming = safeJoin(stagedRoot, maintained)
    const old = safeJoin(journalRoot, maintained)
    fs.mkdirSync(path.dirname(old), { recursive: true })
    const step = { path: maintained, hadCurrent: fs.existsSync(target), hasIncoming: fs.existsSync(incoming), status: 'prepared' }
    journal.push(step)
    writeJsonAtomic(path.join(transactionRootPath, 'journal.json'), { steps: journal })
    if (step.hadCurrent) fs.renameSync(target, old)
    fault?.(`mid_swap:${maintained}`)
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

// options.validate checks the incoming tree (staged, then live after the swap).
// options.validateRestored checks a tree restored from the checkpoint, and only
// after the restore has been confirmed against the checkpoint's hashes.
export function applyPreparedUpdate(root, candidateRoot, planPath, options = {}) {
  const release = acquireLock(root)
  const paths = statePaths(root)
  let plan
  let checkpoint
  let abrupt = false
  try {
    plan = readPlan(planPath)
    const txRoot = transactionRoot(root, plan.transactionId)
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
    const candidateManifest = readManifest(candidateRoot).manifest
    const userOwned = [...new Set([
      ...readManifest(root).manifest.userOwnedPaths,
      ...candidateManifest.userOwnedPaths,
    ])]
    const protectedList = protectedNames(userOwned)
    copyUserOwnedRoots(root, stagedRoot, userOwned)
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
    checkpoint = createCheckpoint(root, plan, rollbackPaths, protectedList)
    verifyCheckpoint(checkpoint.checkpointRoot)
    const checkpointDigest = checkpoint.checkpoint.digest
    const toolCommand = writeRecoveryTool(root, plan.transactionId)
    writeJsonAtomic(paths.recoveryMarker, {
      schemaVersion: 1,
      transactionId: plan.transactionId,
      planDigest: plan.planDigest,
      checkpointDigest,
      phase: 'committing',
      recoverCommand: toolCommand,
    })
    writeTransaction(root, plan, 'committing', { checkpointDigest })
    options.fault?.('committing')

    try {
      swapMaintainedRoots(root, stagedRoot, candidateManifest.maintainedPaths, txRoot, options.fault, protectedList)
      options.validate?.(root)
    } catch (error) {
      if (error?.simulatedAbrupt === true) throw error
      writeTransaction(root, plan, 'rolling_back', { error: error.message })
      try {
        restoreCheckpoint(root, checkpoint.checkpointRoot, candidateManifest.maintainedPaths, { protectedList, fault: options.fault })
        options.validateRestored?.(root)
      } catch (restoreError) {
        if (restoreError?.simulatedAbrupt === true) throw restoreError
        // Leave one clear, recoverable state: the transaction stays active, the
        // recovery marker stays in place, and `recover` restores the same
        // verified checkpoint again.
        writeTransaction(root, plan, 'recovery_required', { error: error.message, restoreError: restoreError.message, recoverCommand: toolCommand })
        const wrapped = new Error(`Update failed and automatic restore did not finish: ${error.message}. Restore: ${restoreError.message}. ${recoveryAdvice(root, plan.transactionId)}`)
        wrapped.recoveryRequired = true
        wrapped.recoverCommand = toolCommand
        throw wrapped
      }
      updateState(root, (state) => ({ ...state, activeTransactionId: null }))
      writeTransaction(root, plan, 'recovered', { recovery: 'checkpoint_restored', error: error.message })
      removeJournalOld(root, plan.transactionId)
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
      // Rollback is a stack: the transaction committed before this one becomes
      // the latest again after this one is rolled back.
      // With no latest transaction the stack is empty by construction; this also
      // drops entries an older updater left behind.
      rollbackStack: state.lastSuccessfulTransactionId ? [...(state.rollbackStack ?? []), state.lastSuccessfulTransactionId] : [],
      activeTransactionId: null,
    }))
    writeTransaction(root, plan, 'committed', { checkpointDigest, nextBaseDigest: nextSnapshot.digest })
    removeJournalOld(root, plan.transactionId)
    if (fs.existsSync(paths.recoveryMarker)) removeExact(paths.recoveryMarker, paths.stateRoot)
    appendHistory(root, `${newRelease.version} — update committed`, {
      Result: 'applied after exact plan approval and validation',
      Transaction: plan.transactionId,
      'Plan digest': plan.planDigest,
      Checkpoint: path.relative(root, checkpoint.checkpointRoot),
    })
    return { plan, checkpoint: checkpoint.checkpointRoot, state: readState(root) }
  } catch (error) {
    abrupt = error?.simulatedAbrupt === true
    throw error
  } finally {
    // A simulated abrupt termination models a killed process, which cannot
    // clean up; the next init, prepare, recover, or rollback sweeps instead.
    // Each cleanup step is guarded so it can never hide the original error or
    // leave the lock behind.
    if (!abrupt) {
      try { sweepStaging(root) } catch { /* the next init, prepare, recover, or rollback sweeps again */ }
    }
    release()
  }
}

// Protected names for recovery come from the checkpoint itself and, when it is
// still readable, the live manifest.
function liveManifestPaths(root) {
  try {
    const { manifest } = readManifest(root)
    return { maintainedPaths: manifest.maintainedPaths, userOwnedPaths: manifest.userOwnedPaths }
  } catch {
    return { maintainedPaths: [], userOwnedPaths: [] }
  }
}

// A 1.0.x updater (its checkpoints record no protectedPaths) that failed after
// the swap restored its checkpoint, then ran the restored tree's own proof,
// which refuses any personalized install. The transaction stayed active, and
// its own recover repeats the same proof forever. Its restore copy had already
// finished, so this repair restores nothing: every maintained path must
// already match the checkpoint (restore completed) or the base snapshot of the
// current release (nothing was swapped). Only then does it clear the
// transaction. It refuses, changing nothing, if any file matches neither, and
// it never writes a user-owned path or instance/.
// An interrupted 1.0.x rollback (the transaction it rolls back is still the
// latest committed one) takes the ordinary restore path instead.
function legacyRestoreAwaitingConfirmation(checkpointRoot, receipt, state, plan) {
  if (receipt.phase !== 'rolling_back' || state.lastSuccessfulTransactionId === plan.transactionId) return false
  const checkpointPath = path.join(checkpointRoot, 'checkpoint.json')
  if (!fs.existsSync(checkpointPath)) return false
  return JSON.parse(fs.readFileSync(checkpointPath, 'utf8')).protectedPaths === undefined
}

function confirmLegacyRestoreInPlace(root, state, plan, checkpointRoot) {
  if (stable(state.currentRelease) !== stable(plan.currentRelease) || stable(state.baseSnapshot) !== stable(plan.baseSnapshot)) {
    throw new Error('Recovery refused: the update state no longer names the release this transaction started from. Nothing was changed.')
  }
  const verified = verifyCheckpoint(checkpointRoot)
  const base = loadSnapshot(root, state)
  const live = liveManifestPaths(root)
  const roots = minimalConflictRoots([...verified.checkpoint.maintainedPaths, ...live.maintainedPaths])
  // Only maintained roots are compared: never instance/, runtime state, or a user-owned root.
  for (const maintained of roots) assertMutableTarget(root, maintained, protectedNames(live.userOwnedPaths))
  const mismatched = mismatchedPaths(root, roots, [verified.records, base.records])
  if (mismatched.length > 0) {
    throw new Error(`Recovery refused: these maintained files match neither the update checkpoint nor the installed ${plan.currentRelease.version} release, so they may hold changes made after the failed update: ${mismatched.slice(0, 20).join(', ')}. Nothing was changed. If you edited them, move any edits you want to keep somewhere else, put the files back as they were, and run recover again. If the 1.0.x updater was stopped while it was putting files back, run its own \`node system/update.mjs recover\` once first (it finishes copying, then reports its proof error), then run this command again. See "An update stuck under 1.0.x" in system/UPDATE-GUIDE.md.`)
  }
}

export function recoverUpdate(root, options = {}) {
  const release = acquireLock(root)
  try {
    const state = readState(root)
    if (!state.activeTransactionId) {
      sweepStaging(root)
      return { recovered: false, reason: 'no_active_transaction' }
    }
    const txRoot = transactionRoot(root, state.activeTransactionId)
    const plan = readPlan(path.join(txRoot, 'plan.json'))
    const receiptPath = path.join(txRoot, 'transaction.json')
    const receipt = fs.existsSync(receiptPath) ? JSON.parse(fs.readFileSync(receiptPath, 'utf8')) : { phase: 'prepared' }
    const paths = statePaths(root)
    if (['prepared', 'approved', 'staged'].includes(receipt.phase)) {
      sweepStaging(root)
      removeJournalOld(root, plan.transactionId)
      updateState(root, (current) => ({ ...current, activeTransactionId: null }))
      writeTransaction(root, plan, 'recovered', { recovery: 'aborted_before_current_tree_mutation' })
      return { recovered: true, action: 'aborted_before_mutation' }
    }
    const checkpointRoot = path.join(txRoot, 'checkpoint')
    if (legacyRestoreAwaitingConfirmation(checkpointRoot, receipt, state, plan)) {
      // Verify first; nothing below runs unless every maintained file matches.
      confirmLegacyRestoreInPlace(root, state, plan, checkpointRoot)
      updateState(root, (current) => ({ ...current, activeTransactionId: null }))
      writeTransaction(root, plan, 'recovered', { recovery: 'legacy_restore_verified_in_place' })
      removeJournalOld(root, plan.transactionId)
      if (fs.existsSync(paths.recoveryMarker)) removeExact(paths.recoveryMarker, paths.stateRoot)
      // The 1.0.x staging copy holds copies of the user's own files.
      sweepStaging(root)
      return { recovered: true, action: 'legacy_restore_verified' }
    }
    sweepStaging(root)
    // Work from the checkpoint's own path list; the live manifest may be the
    // half-swapped candidate's, or missing entirely.
    const live = liveManifestPaths(root)
    restoreCheckpoint(root, checkpointRoot, live.maintainedPaths, { protectedList: protectedNames(live.userOwnedPaths), fault: options.fault })
    options.validateRestored?.(root)
    loadSnapshot(root, {
      ...state,
      currentRelease: plan.currentRelease,
      baseSnapshot: plan.baseSnapshot,
    })
    // An interrupted rollback of the latest committed transaction finishes like
    // a rollback (pop the stack); an interrupted apply never pushed anything.
    const finishesRollback = state.lastSuccessfulTransactionId === plan.transactionId
    const stack = state.rollbackStack ?? []
    updateState(root, (current) => ({
      ...current,
      currentRelease: plan.currentRelease,
      baseSnapshot: plan.baseSnapshot,
      lastSuccessfulTransactionId: finishesRollback ? (stack.at(-1) ?? null) : current.lastSuccessfulTransactionId,
      rollbackStack: finishesRollback ? stack.slice(0, -1) : stack,
      activeTransactionId: null,
    }))
    writeTransaction(root, plan, 'recovered', { recovery: 'checkpoint_restored_after_interruption' })
    removeJournalOld(root, plan.transactionId)
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
    sweepStaging(root)
    const txRoot = transactionRoot(root, transactionId)
    const plan = readPlan(path.join(txRoot, 'plan.json'))
    if (stable(plan.candidateRelease) !== stable(state.currentRelease)) {
      throw new Error('Rollback refused: that transaction did not install the current release')
    }
    const checkpointRoot = path.join(txRoot, 'checkpoint')
    const paths = statePaths(root)
    const { manifest: currentManifest } = readManifest(root)
    // The running updater is the one that knows this checkpoint; keep a copy.
    preflightRestore(root, checkpointRoot, currentManifest.maintainedPaths, protectedNames(currentManifest.userOwnedPaths))
    const toolCommand = writeRecoveryTool(root, transactionId)
    updateState(root, (current) => ({ ...current, activeTransactionId: transactionId }))
    writeJsonAtomic(paths.recoveryMarker, {
      schemaVersion: 1,
      transactionId,
      planDigest: plan.planDigest,
      phase: 'rolling_back',
      recoverCommand: toolCommand,
    })
    writeTransaction(root, plan, 'rolling_back', { recovery: 'explicit_latest_transaction_rollback' })
    options.fault?.('rollback_marker')
    try {
      restoreCheckpoint(root, checkpointRoot, currentManifest.maintainedPaths, { protectedList: protectedNames(currentManifest.userOwnedPaths), fault: options.fault })
      options.validateRestored?.(root)
    } catch (error) {
      if (error?.simulatedAbrupt === true) throw error
      writeTransaction(root, plan, 'recovery_required', { error: error.message, recoverCommand: toolCommand })
      const wrapped = new Error(`Rollback did not finish: ${error.message}. ${recoveryAdvice(root, transactionId)}`)
      wrapped.recoveryRequired = true
      wrapped.recoverCommand = toolCommand
      throw wrapped
    }
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
      lastSuccessfulTransactionId: (current.rollbackStack ?? []).at(-1) ?? null,
      rollbackStack: (current.rollbackStack ?? []).slice(0, -1),
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
  INSTANCE_ROOT,
  RESERVED_ROOTS,
  foldKey,
  recoveryCommand,
  sweepStaging,
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
