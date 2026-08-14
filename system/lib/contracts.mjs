const credentialPatterns = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:ghp|github_pat|sk|sbp)[_-][A-Za-z0-9_-]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /\b(?:password|passwd|passcode|recovery codes?|secret|token|api[_ -]?key)\s*(?:is|[:=])\s*\S{8,}/i,
  /\b\d{3}-\d{2}-\d{4}\b/,
]

function passesLuhn(value) {
  const digits = value.replace(/\D/g, '')
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) {
    return false
  }
  let sum = 0
  let double = false
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index])
    if (double) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
    double = !double
  }
  return sum % 10 === 0
}

export function containsCredentialShape(value) {
  const text = String(value)
  if (credentialPatterns.some((pattern) => pattern.test(text))) return true

  const paymentCandidates = text.match(/(?:\d[ -]?){13,19}/g) ?? []
  if (paymentCandidates.some(passesLuhn)) return true

  const trimmed = text.trim()
  return (
    !/\s/.test(trimmed) &&
    trimmed.length >= 10 &&
    /[a-z]/.test(trimmed) &&
    /[A-Z]/.test(trimmed) &&
    /\d/.test(trimmed) &&
    /[^A-Za-z0-9]/.test(trimmed)
  )
}

export function credentialDecision(value) {
  if (!containsCredentialShape(value)) {
    return { refuse: false, message: 'No credential-shaped input detected.' }
  }
  return {
    refuse: true,
    message:
      'Home Base does not accept credential values. Do not repeat or save it; sign in directly on the provider surface.',
  }
}

const scoreFields = [
  'fit',
  'value',
  'existingAccess',
  'lowEffort',
  'lowMaintenance',
  'lowRisk',
  'clearProof',
]

export function scoreOpportunity(opportunity) {
  for (const field of scoreFields) {
    const value = opportunity.scores?.[field]
    if (!Number.isInteger(value) || value < 0 || value > 5) {
      throw new Error(`Opportunity ${opportunity.id} has invalid ${field} score`)
    }
  }
  if (
    !['user_statement', 'durable_file', 'reviewed_work'].includes(
      opportunity.evidenceSource,
    )
  ) {
    throw new Error(`Opportunity ${opportunity.id} needs a valid evidence source`)
  }
  if (!opportunity.evidence || opportunity.evidence.trim().length < 20) {
    throw new Error(`Opportunity ${opportunity.id} needs meaningful visible evidence`)
  }
  const total = scoreFields.reduce((sum, field) => sum + opportunity.scores[field], 0)
  return { ...opportunity, total }
}

export function selectOpportunitySet(candidates) {
  const scored = candidates.map(scoreOpportunity)
  const now = scored
    .filter((candidate) => candidate.timing === 'now')
    .sort((a, b) => b.total - a.total || a.id.localeCompare(b.id))
    .slice(0, 2)
  const later = scored
    .filter((candidate) => candidate.timing === 'later')
    .sort((a, b) => b.total - a.total || a.id.localeCompare(b.id))
    .slice(0, 1)
  return [...now, ...later]
}

export function consumeSuggestion(session) {
  const count = Number(session.unsolicitedCount ?? 0)
  if (count >= 1) {
    return { allowed: false, unsolicitedCount: count }
  }
  return { allowed: true, unsolicitedCount: count + 1 }
}

const materialFields = ['goal', 'tool', 'constraint', 'priority', 'feasibility', 'cost', 'risk']

export function canReopenDeclinedIdea(changes, userConfirmed) {
  const material = materialFields.some((field) => Boolean(changes?.[field]))
  return {
    material,
    allowed: material && userConfirmed === true,
  }
}

const previewFields = [
  'system',
  'task',
  'accountEnvironment',
  'readDataScope',
  'exclusions',
  'volumeCeiling',
  'thirdParties',
  'outsideChanges',
  'worstCase',
  'stopConditions',
  'undo',
  'remainingAccess',
]

export function missingActionPreviewFields(preview) {
  return previewFields.filter((field) => {
    const value = preview?.[field]
    return value === undefined || value === null || String(value).trim() === ''
  })
}

export function compareRuns(firstRun, secondRun) {
  const sameInput = JSON.stringify(firstRun.input) === JSON.stringify(secondRun.input)
  const changedResult = JSON.stringify(firstRun.result) !== JSON.stringify(secondRun.result)
  return {
    sameInput,
    changedResult,
    proven: sameInput && changedResult && secondRun.userRestatedCorrection === false,
  }
}
