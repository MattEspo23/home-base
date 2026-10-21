// Generated from src/copy.ts by system/dashboard/build.mjs. Do not edit.
// Plain-language words for the dashboard. Pure functions, so they are easy to
// test.


export const STEPS = ['Get to know you', 'Map ideas', 'Design one', 'Build it', 'Use and improve']
const STAGE_INDEX                         = { orient: 0, opportunity_map: 1, blueprint: 2, build: 3, complete: 4 }



export function progress(setup       )           {
  if (setup.status === null || setup.status === 'not_started') return { current: 0, done: 0, label: `Step 1 of 5: ${STEPS[0]}` }
  const current = STAGE_INDEX[setup.stage ?? 'orient'] ?? 0
  if (setup.stage === 'complete') return { current: 4, done: 5, label: 'All five steps done' }
  return { current, done: current, label: `Step ${current + 1} of 5: ${STEPS[current]}` }
}

// The start workflow's questions, said the way the assistant will ask them.
const QUESTIONS                         = {
  scope: 'Should we start with your personal life, your work, or both?',
  name: 'What should I call you?',
  current_world: 'What takes up most of your time right now?',
  desired_change: 'What would you most like to make easier?',
  repeated_friction: 'What keeps repeating or getting delayed?',
  information_and_tools: 'Where does your information live today?',
  people: 'Who else does this affect?',
  proof: 'What would you notice if this really helped?',
  control: 'What should I always ask you about first?',
}



export function nextStep(setup       )           {
  if (setup.status === null) {
    return { headline: 'Home Base could not find your setup notes.', detail: 'Open this folder in your assistant. It can check what is missing.', say: 'Start' }
  }
  if (setup.status === 'not_started') {
    return { headline: 'Let’s get started.', detail: 'Open this folder in your assistant. It will ask a few short questions, one at a time.', say: 'Start' }
  }
  switch (setup.stage) {
    case 'opportunity_map':
      return { headline: 'Your first map of ideas is ready.', detail: 'Pick one idea to try. If none fit, say so. That helps too.', say: 'Review my opportunities' }
    case 'blueprint':
      return { headline: 'Design the idea you picked.', detail: 'Your assistant will plan the smallest useful version with you.', say: 'Blueprint it' }
    case 'build':
      return { headline: 'Build the smallest version.', detail: 'Nothing outside this folder changes unless you approve the exact plan.', say: 'Build this system' }
    case 'complete':
      return { headline: 'Setup is done.', detail: 'Come back any time to add more or improve what you have.', say: 'Make Home Base better' }
    default: {
      const question = setup.nextQuestion ? QUESTIONS[setup.nextQuestion] : undefined
      const answered = setup.orientationCompleted ?? 0
      const counted = answered > 0 ? ` You have answered ${answered} so far.` : ''
      return question
        ? { headline: `Next question: “${question}”`, detail: `Your assistant will pick up right there.${counted}`, say: 'Continue my setup' }
        : { headline: 'Keep going with your first questions.', detail: `Your assistant will pick up where you left off.${counted}`, say: 'Continue my setup' }
    }
  }
}

// "Verified" only with a valid check date. The server already downgrades an
// undated verified line; this keeps the words honest either way.
export function stateLabel(state                , checked               )         {
  if (state === 'blocked') return 'Blocked'
  if (state === 'verified' && checked) return 'Verified'
  return checked ? 'Not verified yet' : 'Not verified yet (no valid check date)'
}

// One line on how to open Home Base in a given assistant. Only verified,
// dated assistants get steps; the two adapters this folder ships get specific
// ones, others a careful hint.
export function howToOpen(name        , state                , checked               )         {
  const key = name.toLowerCase()
  if (state === 'blocked') return 'Not working yet. Ask another assistant: “What capability is missing?”'
  if (state !== 'verified' || !checked) return 'Not checked yet. In that assistant, ask: “What can you access?”'
  if (key.includes('codex')) return 'Open Codex, choose the whole Home Base folder, then say “Start.”'
  if (key.includes('claude code')) return 'Open the whole Home Base folder in Claude Code, then type “Start.”'
  if (key.includes('grok build')) return 'In a terminal, open the Home Base folder, run grok, trust the folder when asked, then type “Start.”'
  return 'Open the whole Home Base folder in it. Ask it to read AGENTS.md first.'
}

// Index lines without a local link are not shown; say how many, never what.
export function notShown(count        )                {
  if (!count) return null
  return count === 1
    ? '1 more entry not shown — add a link to show it.'
    : `${count} more entries not shown — add a link to show them.`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function checkedLabel(iso               )         {
  if (!iso) return 'No check date recorded'
  const [year, month, day] = iso.split('-').map(Number)
  return `Checked ${day} ${MONTHS[month - 1]} ${year}`
}

// One line in the footer: which theme applies, and in plain words why all or
// part of it does not. The stylesheets themselves are linked by the server.
export function themeNote(theme             )                                            {
  const notes = theme.notes.slice(0, 3)
  const more = theme.notes.length > 3 ? ` (and ${theme.notes.length - 3} more)` : ''
  const custom = theme.customCss ? ' Your theme.css is applied.' : ''
  if (theme.state === 'not-applied') {
    return { text: `Theme not applied: ${notes.join('; ')}${more}. The default look is shown.${custom}`, problem: true }
  }
  if (theme.state === 'applied') {
    const kept = notes.length ? ` Some colours kept the default so text stays readable: ${notes.join('; ')}${more}.` : ''
    return { text: `Theme: ${theme.name ?? 'Your theme'}.${kept}${custom}`, problem: notes.length > 0 }
  }
  if (notes.length) return { text: `${notes.join('; ')}${more}.${custom}`, problem: true }
  return theme.customCss ? { text: custom.trim(), problem: false } : null
}

// ------------------------------------------------------------ online copy

export const ONLINE_WHERE = 'Online, locked to your Vercel sign-in'

export const ONLINE_FAILURE = 'This online copy could not load. Reload the page. If Vercel asks you to sign in, use the account that owns it.'

// The online copy's footer says when it was published, in the viewer's own
// date format. A date that cannot be read is left out rather than shown wrong.
export function onlineNote(version               , publishedAt        )         {
  const when = new Date(publishedAt)
  const date = publishedAt && !Number.isNaN(when.getTime()) ? ` from ${when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` : ''
  return `${version ? `Home Base ${version}. ` : ''}A copy of your Home Base${date}. It changes when your assistant updates it.`
}
