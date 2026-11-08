import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

const SEPARATOR = ' · '

const line = atom({ plugin: 'claudify', key: 'line' } as const, null)

export type Line = {
  model: string
  effort: string | undefined
  cwd: string
  home: string | undefined
  branch: string | null
  tokens: number | undefined
  window: number
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${trim(n / 1_000_000)}M`
  if (n >= 1_000) return `${trim(n / 1_000)}k`
  return String(n)
}

function trim(n: number): string {
  return n.toFixed(1).replace(/\.0$/, '')
}

export function modelName(id: string): string {
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(\[1m\])?$/.exec(id)
  if (!match) return id
  const [, family = '', major, minor, longContext] = match
  const name = `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}${minor ? `.${minor}` : ''}`
  return longContext ? `${name} (1M)` : name
}

export function tildify(path: string, home: string | undefined): string {
  if (!home) return path
  if (path === home) return '~'
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

export function formatLine(line: Line): string {
  const tokens = line.tokens ?? 0
  const percent = (line.window > 0 ? (tokens / line.window) * 100 : 0).toFixed(2)
  const context = `(${percent}%) ${formatTokens(tokens)} / ${formatTokens(line.window)}`

  const model = line.effort ? `${modelName(line.model)} (${line.effort})` : modelName(line.model)

  return [model, context, tildify(line.cwd, line.home), line.branch]
    .filter(part => part !== null && part !== '')
    .join(SEPARATOR)
}

let latest = 0

type Known = { model?: string }

const LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])

let effort: string | undefined

async function savedEffort($: EngineInterface, model: string): Promise<string | undefined> {
  const dir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${await $.env.get('HOME')}/.claude`
  try {
    const settings = JSON.parse(await $.fs.read(`${dir}/settings.json`))
    const level = settings?.modelSettings?.[model]?.effortLevel
    return typeof level === 'string' ? level : undefined
  } catch {
    return undefined
  }
}

let resumedTokens: number | undefined

async function refresh($: EngineInterface, known: Known = {}) {
  const id = ++latest
  const [model, cwd, home, usage] = await Promise.all([
    known.model ?? $.session.model(),
    $.session.cwd(),
    $.env.get('HOME'),
    $.session.usage(),
  ])
  const branch = await readBranch($, cwd)

  if (id !== latest) return

  const tokens = usage.context.tokens ?? resumedTokens
  const text = formatLine({ model, effort, cwd, home, branch, tokens, window: usage.context.window })
  await update($, line, () => text)
}

async function readBranch($: EngineInterface, cwd: string): Promise<string | null> {
  if ((await $.session.repo()) === null) return null

  const current = await $.process.run(['git', 'branch', '--show-current'], { cwd })
  const name = current.stdout.trim()
  if (current.exitCode === 0 && name !== '') return name

  const head = await $.process.run(['git', 'rev-parse', '--short', 'HEAD'], { cwd })
  return head.exitCode === 0 ? head.stdout.trim() || null : null
}

const EFFORT_PRINTED = /<local-command-stdout>(?:Set effort level to `?(\w+)`?|Set model to [^<]* with `?(\w+)`? effort)/

async function printedEfforts($: EngineInterface): Promise<string[]> {
  const rows = await $.session.messages()
  return rows.flatMap(row => {
    const match = EFFORT_PRINTED.exec(row.text)
    const level = match?.[1] ?? match?.[2]
    return level === undefined ? [] : [level.toLowerCase()]
  })
}

async function redrawAfterPicker<T>($: EngineInterface, run: () => Promise<T>): Promise<T> {
  const seenBefore = (await printedEfforts($)).length
  const result = await run()
  effort = await savedEffort($, await $.session.model())
  await refresh($)
  $.clock.after(100, () => takePrintedEffort($, seenBefore))
  return result
}

async function takePrintedEffort($: EngineInterface, seenBefore: number) {
  const printed = await printedEfforts($)
  const level = printed.at(-1)
  if (printed.length > seenBefore && level !== undefined && level !== effort) {
    effort = level
    await refresh($)
  }
}

async function redrawWithSavedEffort<T>($: EngineInterface, handled: Promise<T>, known: Known = {}): Promise<T> {
  const result = await handled
  effort = await savedEffort($, known.model ?? (await $.session.model()))
  await refresh($, known)
  return result
}

async function redrawAfter<T>($: EngineInterface, handled: Promise<T>, known?: Known): Promise<T> {
  const result = await handled
  await refresh($, known)
  return result
}

export const register: Register = on => {
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const text = await read($, line)
    const hint = await next(e)
    if (text === null) return hint

    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {hint}
        <Text dimColor>{text}</Text>
      </Box>
    )
  })

  on('session.start', ($, e, next) => redrawWithSavedEffort($, next(e)))
  on('session.measure', ($, e, next) => redrawAfter($, next(e)))
  on('turn.complete', ($, e, next) => redrawAfter($, next(e)))
  on('classic.PostModelSwitch', ($, e, next) => redrawWithSavedEffort($, next(e), { model: e.to_model }))

  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const named = e.args.trim().toLowerCase()
    if (LEVELS.has(named)) {
      effort = named
      await refresh($)
      return next(e)
    }

    return redrawAfterPicker($, () => next(e))
  })

  on('command.run', { command: 'model' }, ($, e, next) => redrawAfterPicker($, () => next(e)))

  on('turn.step', async function* ($, e, next) {
    const sent = e.agentId === undefined && e.effort !== undefined ? String(e.effort) : effort
    if (sent !== effort) {
      effort = sent
      await refresh($)
    }
    return yield* next(e)
  })

  on('classic.SessionStart', ($, e, next) => {
    resumedTokens = e.source === 'resume' || e.source === 'fork' ? e.context_tokens : undefined
    return redrawAfter($, next(e))
  })
  on('classic.CwdChanged', ($, e, next) => redrawAfter($, next(e)))
}
