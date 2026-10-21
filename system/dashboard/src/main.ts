import { RequestFailed, dbName, getModules, getStatus } from './api.ts'
import type { FailureReason } from './api.ts'
import { STEPS, checkedLabel, howToOpen, nextStep, notShown, progress, stateLabel } from './copy.ts'
import { SAMPLE_NOTICE, formatMoney, sampleFinance, sampleHabits } from './sample.ts'
import type { HomeBaseStatus, InstanceModule, ModuleApi } from './types.ts'

// ------------------------------------------------------------ helpers
// Text only: every string goes in through text nodes, never as HTML.

type Child = Node | string | null | undefined | false

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    node.append(child)
  }
  return node
}

// Like el(): skips empty children. The DOM's own replaceChildren would print
// a null child as the text "null".
function fill(target: HTMLElement, ...children: Child[]): void {
  target.replaceChildren(...children.filter((child): child is Node | string => child !== null && child !== undefined && child !== false))
}

function hidden(text: string): HTMLSpanElement {
  return el('span', 'visually-hidden', text)
}

function body(id: string): HTMLElement {
  const element = document.getElementById(id)
  if (!element) throw new Error(`Missing #${id}`)
  return element
}

function setValue(node: HTMLElement, value: number): HTMLElement {
  node.style.setProperty('--v', String(Math.max(0, Math.min(1, value))))
  return node
}

// ------------------------------------------------------------- options

const params = new URLSearchParams(window.location.search)
const showSamples = params.get('samples') !== 'off'

// ------------------------------------------------------- Your Home Base

const STATUS_TEXT: Record<string, string> = {
  not_started: 'Setup not started',
  in_progress: 'Setup in progress',
  complete: 'Setup complete',
}

function sayLine(phrase: string): HTMLElement {
  const line = el('p', 'say', el('span', 'say-label', 'Say'), el('span', 'say-phrase', `“${phrase}”`))
  if (navigator.clipboard) {
    // Visible text plus a hidden phrase, so the button's name changes with
    // it; a status region announces the result to screen readers.
    const label = el('span', 'copy-label', 'Copy')
    const button = el('button', 'copy', label, hidden(` “${phrase}”`))
    button.type = 'button'
    const announce = el('span', 'visually-hidden')
    announce.setAttribute('role', 'status')
    announce.setAttribute('aria-live', 'polite')
    button.addEventListener('click', () => {
      navigator.clipboard.writeText(phrase).then(
        () => { label.textContent = 'Copied'; announce.textContent = `Copied “${phrase}”` },
        () => { label.textContent = 'Copy failed'; announce.textContent = 'Copy failed. Select the words and copy them yourself.' },
      )
    })
    line.append(button, announce)
  }
  return line
}

function fact(term: string, value: string, detail: string, hiddenCount = 0): HTMLElement {
  const more = notShown(hiddenCount)
  return el('div', 'fact',
    el('dt', 'label', term),
    el('dd', 'fact-value', value),
    el('dd', 'fact-detail', detail),
    more ? el('dd', 'fact-more', more) : null,
  )
}

function renderHome(status: HomeBaseStatus): void {
  const { setup } = status
  const step = progress(setup)
  const next = nextStep(setup)
  const statusKey = setup.status ?? 'missing'

  const steps = el('ol', 'steps')
  steps.setAttribute('aria-label', 'Setup steps')
  STEPS.forEach((name, index) => {
    const state = index < step.done ? 'done' : index === step.current && step.done < 5 ? 'current' : 'todo'
    const item = el('li', `step step-${state}`,
      el('span', 'step-mark', el('span', 'step-num', String(index + 1))),
      el('span', 'step-name', name),
      state === 'done' ? hidden(' (done)') : state === 'current' ? hidden(' (you are here)') : null,
    )
    if (state === 'current') item.setAttribute('aria-current', 'step')
    steps.append(item)
  })

  const { active, building } = status.systems
  const { unlinked } = status
  const systemsValue = active.length
    ? `${active.length} running`
    : building.length ? `${building.length} being built` : unlinked.systems ? 'None shown' : 'None yet'
  const systemsDetail = [...active, ...building.map((name) => `${name} (being built)`)].join(' · ')

  fill(body('home-body'),
    el('p', `status-line status-${statusKey}`,
      el('span', 'status-dot'),
      el('span', 'status-text', STATUS_TEXT[statusKey] ?? 'Setup notes missing'),
      el('span', 'status-step', step.label),
    ),
    steps,
    el('div', 'next',
      el('p', 'label', 'Your next step'),
      el('p', 'next-headline', next.headline),
      el('p', 'next-detail', next.detail),
      next.say ? sayLine(next.say) : null,
    ),
    el('dl', 'facts',
      fact('Projects',
        status.projects.active.length ? `${status.projects.active.length} active` : unlinked.projects ? 'None shown' : 'None yet',
        status.projects.active.join(' · ') || 'Your assistant adds one when you start something real.',
        unlinked.projects),
      fact('Systems', systemsValue, systemsDetail || 'A system is a helper you design and build together.', unlinked.systems),
      fact('Skills',
        `${status.skills.repository + status.skills.user} ready`,
        `${status.skills.repository} built in · ${status.skills.user ? `${status.skills.user} of your own` : unlinked.skills ? 'none of your own shown' : 'none of your own yet'}`,
        unlinked.skills),
    ),
  )
}

// ------------------------------------------------------------ Assistants

function renderAssistants(status: HomeBaseStatus): void {
  const list = el('ul', 'assistant-list')
  for (const assistant of status.assistants) {
    list.append(el('li', `assistant assistant-${assistant.state}`,
      el('div', 'assistant-head',
        el('h3', 'assistant-name', assistant.name),
        el('span', `pill pill-${assistant.state}`, stateLabel(assistant.state, assistant.checked)),
      ),
      el('p', 'assistant-checked', checkedLabel(assistant.checked)),
      el('p', 'assistant-how', howToOpen(assistant.name, assistant.state, assistant.checked)),
    ))
  }
  const adapters: Array<[string, boolean]> = [
    ['AGENTS.md', status.adapters.agentsMd],
    ['.agents/skills', status.adapters.agentsSkills],
    ['CLAUDE.md', status.adapters.claudeMd],
    ['.claude/skills', status.adapters.claudeSkills],
  ]
  const chips = el('ul', 'chips')
  for (const [name, present] of adapters) {
    chips.append(el('li', `chip ${present ? 'chip-on' : 'chip-off'}`, el('span', 'chip-dot'), name, hidden(present ? ' (in this folder)' : ' (missing)')))
  }
  const more = notShown(status.unlinked.assistants)
  fill(body('assistants-body'),
    el('p', 'intro', 'Assistants Home Base has checked, whether each one works here, and the date of the check.'),
    status.assistants.length
      ? list
      : el('div', 'empty',
          el('span', 'empty-mark'),
          el('div', 'empty-text',
            el('p', 'empty-title', more ? 'No assistants shown yet.' : 'No assistants checked yet.'),
            el('p', '', 'Ask your assistant: “What can you access?” It will check and note the date here.'),
          ),
        ),
    more ? el('p', 'more', more) : null,
    el('div', 'adapters',
      el('p', 'label', 'Instructions in this folder'),
      chips,
      el('p', 'adapters-note', 'Codex reads AGENTS.md and .agents/skills. Claude Code reads CLAUDE.md and .claude/skills.'),
    ),
  )
}

// ---------------------------------------------------------- Life domains

function chart(label: string, points: Array<{ name: string; value: number; text: string }>): HTMLElement {
  const max = Math.max(...points.map((point) => point.value))
  const min = Math.min(...points.map((point) => point.value))
  const floor = Math.max(0, min - (max - min) * 0.6)
  const figure = el('div', 'chart')
  figure.setAttribute('role', 'img')
  figure.setAttribute('aria-label', `${label}: ${points.map((point) => `${point.name} ${point.text}`).join(', ')}`)
  points.forEach((point, index) => {
    const bar = setValue(el('span', 'chart-bar'), (point.value - floor) / (max - floor || 1))
    figure.append(el('span', `chart-col${index === points.length - 1 ? ' chart-col-last' : ''}`, bar, el('span', 'chart-label', point.name)))
  })
  return figure
}

function domainHead(id: string, title: string): HTMLElement {
  const heading = el('h3', 'domain-title', title)
  heading.id = id
  return el('div', 'domain-head', heading, el('span', 'pill pill-sample', 'Sample'))
}

function financeCard(): HTMLElement {
  const finance = sampleFinance()
  const top = finance.categories.slice(0, 4)
  const biggest = top[0]?.amount ?? 1
  const rows = el('ul', 'rows')
  rows.setAttribute('aria-label', finance.categoriesCaption)
  for (const item of top) {
    rows.append(el('li', 'row',
      el('span', 'row-name', item.name),
      el('span', 'row-meter', setValue(el('span', 'row-fill'), item.amount / biggest)),
      el('span', 'row-value', formatMoney(item.amount)),
    ))
  }
  const percent = Math.round((finance.goal.saved / finance.goal.target) * 100)
  const card = el('article', 'domain domain-finance',
    domainHead('finance-title', 'Finance'),
    el('p', 'metric', el('span', 'metric-value', formatMoney(finance.total)), el('span', 'metric-caption', finance.totalCaption)),
    chart(finance.trendCaption, finance.trend.map((point) => ({ name: point.name, value: point.amount, text: formatMoney(point.amount) }))),
    el('p', 'chart-caption', finance.trendCaption),
    el('p', 'label rows-label', finance.categoriesCaption),
    rows,
    el('div', 'goal',
      el('div', 'goal-head', el('span', 'goal-name', `${finance.goal.name} (sample)`), el('span', 'goal-value', `${percent}%`)),
      el('span', 'meter', setValue(el('span', 'meter-fill'), percent / 100)),
      el('p', 'goal-caption', finance.goal.caption),
    ),
    el('p', 'fineprint', SAMPLE_NOTICE),
  )
  card.setAttribute('aria-labelledby', 'finance-title')
  return card
}

function commitmentList(items: Array<{ name: string; done: boolean }>, label: string): HTMLElement {
  const list = el('ul', 'commitments')
  list.setAttribute('aria-label', label)
  for (const item of items) {
    const mark = el('span', `commitment-mark${item.done ? ' commitment-done' : ''}`, item.done ? '✓' : '')
    mark.setAttribute('aria-hidden', 'true')
    list.append(el('li', 'commitment', mark, el('span', 'commitment-name', item.name), hidden(item.done ? ' (done)' : ' (not done yet)')))
  }
  return list
}

function habitsCard(): HTMLElement {
  const habits = sampleHabits()
  const card = el('article', 'domain domain-habits',
    domainHead('habits-title', 'Daily habits'),
    el('p', 'metric', el('span', 'metric-value', `${habits.doneToday} of ${habits.habits}`), el('span', 'metric-caption', habits.todayCaption)),
    el('p', 'label rows-label', habits.todayListCaption),
    commitmentList(habits.today, habits.todayListCaption),
    chart(habits.weekCaption, habits.week.map((day) => ({ name: day.name, value: day.done, text: `${day.done} of ${habits.habits}` }))),
    el('p', 'chart-caption', habits.weekCaption),
    el('dl', 'minis',
      el('div', 'mini', el('dt', 'label', habits.walkCaption), el('dd', 'mini-value', `${habits.walkMinutes} min`)),
      el('div', 'mini', el('dt', 'label', habits.fullDaysCaption), el('dd', 'mini-value', `${habits.fullDays} days`)),
    ),
    el('p', 'fineprint', SAMPLE_NOTICE),
  )
  card.setAttribute('aria-labelledby', 'habits-title')
  return card
}

const MODULE_TIMEOUT_MS = 8000

function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const limit = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Timed out')), milliseconds) })
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer))
}

async function renderDomains(modules: InstanceModule[]): Promise<void> {
  const container = body('domains-body')
  const mounted = el('div', 'modules')
  fill(container,
    el('p', 'intro', 'A life domain is one part of life Home Base helps you keep track of, like money or health.'),
    mounted,
  )
  if (modules.length === 0) {
    container.append(el('div', 'empty',
      el('span', 'empty-mark'),
      el('div', 'empty-text',
        el('p', 'empty-title', 'No life domains yet.'),
        el('p', '', 'When you are ready, ask your assistant: “What could AI help me with?”'),
      ),
    ))
    if (showSamples) {
      container.append(
        el('p', 'label preview-label', 'Preview with sample data'),
        el('div', 'domain-grid', financeCard(), habitsCard()),
      )
    }
    return
  }
  // Private modules load at runtime from the user's instance/ folder through
  // the local server. The public build never reads or bundles instance code.
  // They are the user's own code and run with this page's access (see the
  // dashboard README). They load side by side, each with a time limit, so one
  // slow or broken module cannot hold up the others.
  const api: ModuleApi = { getStatus, dbName }
  const failed = (section: HTMLElement, title: string): void => { section.replaceChildren(el('p', 'error', `${title} could not load.`)) }
  await Promise.allSettled(modules.map(async (module) => {
    const section = el('section', 'domain domain-module', el('p', 'loading', `Loading ${module.title}…`))
    section.setAttribute('aria-label', module.title)
    mounted.append(section)
    try {
      const loaded = (await withTimeout(import(module.url), MODULE_TIMEOUT_MS)) as { mount?: (element: HTMLElement, moduleApi: ModuleApi) => unknown }
      if (typeof loaded.mount !== 'function') throw new Error('No mount function')
      section.replaceChildren()
      const result = loaded.mount(section, api)
      if (result instanceof Promise) result.catch(() => failed(section, module.title))
    } catch {
      failed(section, module.title)
    }
  }))
}

// ---------------------------------------------------------------- start

// Plain words for each way loading can fail.
const FAILURES: Record<FailureReason, string> = {
  'stale-page': 'The dashboard restarted since this page opened. Reload the page.',
  'no-session': 'This browser is not signed in to the dashboard any more. Open the address your assistant printed (run the launch command again to see it).',
  'no-fetch-metadata': 'This browser is too old to open the dashboard safely. Update Safari to version 16.4 or later, or use Chrome, Edge, or Firefox.',
  'not-running': 'The dashboard is not running. Ask your assistant to “open my dashboard,” or run node system/dashboard/serve.mjs, then reload this page.',
  other: 'Home Base could not read its local status. Reload the page. If that does not help, run the launch command again.',
}

async function start(): Promise<void> {
  // The address the launcher prints carries the key after #. This page is
  // already signed in, so take the key out of the address bar and history.
  const dropKey = (): void => {
    if (window.location.hash.includes('key=')) history.replaceState(null, '', window.location.pathname + window.location.search)
  }
  dropKey()
  window.addEventListener('hashchange', dropKey)
  let status: HomeBaseStatus
  try {
    status = await getStatus()
  } catch (error) {
    const message = FAILURES[error instanceof RequestFailed ? error.reason : 'other']
    for (const id of ['home-body', 'assistants-body', 'domains-body']) body(id).replaceChildren(el('p', 'error', message))
    return
  }
  renderHome(status)
  renderAssistants(status)
  if (status.version) body('foot-note').textContent = `Home Base ${status.version}. Reads a few names from your Home Base folder. It only writes its own settings file.`
  let modules: InstanceModule[] = []
  try { modules = (await getModules()).modules } catch { modules = [] }
  await renderDomains(modules)
}

void start()
