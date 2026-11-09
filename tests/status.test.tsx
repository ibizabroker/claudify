import type { On, SessionRepo, SessionUsage, TurnStepResult } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { formatLine, formatCount, modelName, tildify } from '../hooks/register.tsx'

test('tokens are written the way the status line reads them', () => {
  expect(formatCount(0)).toBe('0')
  expect(formatCount(999)).toBe('999')
  expect(formatCount(134_400)).toBe('134.4k')
  expect(formatCount(200_000)).toBe('200k')
  expect(formatCount(1_000_000)).toBe('1M')
})

test('a model id reads as its name', () => {
  expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelName('claude-sonnet-5-5[1m]')).toBe('Sonnet 5.5 (1M)')
  expect(modelName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(modelName('claude-fable-5-1')).toBe('Fable 5.1')
  expect(modelName('Opus 5.5')).toBe('Opus 5.5')
})

test('the fill is a percentage to two decimals', () => {
  const line = { model: 'claude-opus-5-5', effort: undefined, cwd: '/tmp', home: undefined, branch: null }
  expect(formatLine({ ...line, tokens: 49_512, window: 1_000_000 })).toBe('Opus 5.5 · (4.95%) 49.5k / 1M · /tmp')
  expect(formatLine({ ...line, tokens: 1, window: 200_000 })).toBe('Opus 5.5 · (0.00%) 1 / 200k · /tmp')
})

test('the home folder becomes ~', () => {
  expect(tildify('/Users/me/Projects/x', '/Users/me')).toBe('~/Projects/x')
  expect(tildify('/Users/me', '/Users/me')).toBe('~')
  expect(tildify('/Users/meow', '/Users/me')).toBe('/Users/meow')
  expect(tildify('/tmp', undefined)).toBe('/tmp')
})

test('the branch is left out outside a repo, and an unknown fill reads 0', () => {
  expect(
    formatLine({ model: 'Opus 5.5', effort: undefined, cwd: '/tmp', home: '/Users/me', branch: null, tokens: undefined, window: 200_000 }),
  ).toBe('Opus 5.5 · (0.00%) 0 / 200k · /tmp')
})

const TURN = { answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as const

type Session = {
  inRepo: boolean
  branch: string
  tokens?: number
  saved?: Record<string, string>
  model?: string
  printed?: string[]
}

function engine(on: On, session: Session) {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.messages', () => ({
    value: (session.printed ?? []).map(text => ({ role: 'user' as const, text, toolUses: [] })),
  }))
  on('session.model', () => ({ value: session.model ?? 'claude-opus-5-5' }))
  on('fs.read', (_, e) => {
    if (e.path !== '/Users/me/.claude/settings.json' || session.saved === undefined) return { deny: 'ENOENT' }
    const modelSettings = Object.fromEntries(Object.entries(session.saved).map(([m, effortLevel]) => [m, { effortLevel }]))
    return { value: JSON.stringify({ modelSettings }) }
  })
  on('session.cwd', () => ({ value: '/Users/me/Projects/claudify' }))
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/Users/me' : undefined }))
  on('session.usage', () => {
    const context =
      session.tokens === undefined
        ? { window: 200_000 }
        : { tokens: session.tokens, window: 200_000, percent: Math.round((session.tokens / 200_000) * 100) }
    return { value: { startedAt: 0, rateLimits: {}, context } as unknown as SessionUsage }
  })
  on('session.repo', () => ({
    value: session.inRepo
      ? ({ root: '/Users/me/Projects/claudify', name: 'claudify', internal: false, remote: null } as unknown as SessionRepo)
      : null,
  }))
  on('process.run', (_, e) => {
    const stdout = e.argv.includes('--show-current') ? `${session.branch}\n` : 'abc1234\n'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('classic.PostModelSwitch', () => ({}))
  on('classic.SessionStart', () => ({}))
  // Stands for the engine's own hint row.
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>auto mode on (shift+tab to cycle)</Text>
  })
}

// The rows of the hint area as the terminal would draw them, top to bottom.
async function shown($: Engine): Promise<string[]> {
  const ui = await $.ui.mount({
    plugin: 'claudify',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: 'auto mode on (shift+tab to cycle)' },
  })
  const rows = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  await ui.unmount()
  return rows
}

test('the line is drawn at start and redrawn after a turn', async ($, on) => {
  const session: Session = { inRepo: true, branch: 'main' }
  engine(on, session)

  await $.session.start({ cwd: '/Users/me/Projects/claudify', surface: 'terminal', isInteractive: true })
  expect(await shown($)).toEqual(['auto mode on (shift+tab to cycle)', 'Opus 5.5 · (0.00%) 0 / 200k · ~/Projects/claudify · main'])

  session.tokens = 134_400
  await $.turn.complete(TURN)
  expect(await shown($)).toEqual(['auto mode on (shift+tab to cycle)', 'Opus 5.5 · (67.20%) 134.4k / 200k · ~/Projects/claudify · main'])
})

test('a detached HEAD shows its short hash, and no repo shows no branch', async ($, on) => {
  const session: Session = { inRepo: true, branch: '' }
  engine(on, session)

  await $.session.start({ cwd: '/Users/me/Projects/claudify', surface: 'terminal', isInteractive: true })
  expect(await shown($)).toEqual(['auto mode on (shift+tab to cycle)', 'Opus 5.5 · (0.00%) 0 / 200k · ~/Projects/claudify · abc1234'])

  session.inRepo = false
  await $.turn.complete(TURN)
  expect(await shown($)).toEqual(['auto mode on (shift+tab to cycle)', 'Opus 5.5 · (0.00%) 0 / 200k · ~/Projects/claudify'])
})

test('a model switch shows the new model before $.session catches up', async ($, on) => {
  engine(on, { inRepo: false, branch: '' })

  await $.session.start({ cwd: '/Users/me/Projects/claudify', surface: 'terminal', isInteractive: true })
  await $.classic.PostModelSwitch({
    from_model: 'claude-opus-5-5',
    to_model: 'claude-sonnet-5-5',
    requested_model: 'sonnet',
    source: 'command',
    context_tokens: 0,
    prompt_cache_warm: false,
    cache_ttl: '5m',
    estimated_cache_write_usd: 0,
    pricing: 'default',
  })
  expect(await shown($)).toEqual(['auto mode on (shift+tab to cycle)', 'Sonnet 5.5 · (0.00%) 0 / 200k · ~/Projects/claudify'])
})

test('a resumed session shows the fill it ended on until its next response', async ($, on) => {
  const session: Session = { inRepo: false, branch: '' }
  engine(on, session)

  await $.session.start({ cwd: '/Users/me/Projects/claudify', surface: 'terminal', isInteractive: true })
  await $.classic.SessionStart({ source: 'resume', context_tokens: 134_400 })
  expect(await shown($)).toEqual(['auto mode on (shift+tab to cycle)', 'Opus 5.5 · (67.20%) 134.4k / 200k · ~/Projects/claudify'])

  session.tokens = 140_000
  await $.turn.complete(TURN)
  expect(await shown($)).toEqual(['auto mode on (shift+tab to cycle)', 'Opus 5.5 · (70.00%) 140k / 200k · ~/Projects/claudify'])

  session.tokens = undefined
  await $.classic.SessionStart({ source: 'clear' })
  expect(await shown($)).toEqual(['auto mode on (shift+tab to cycle)', 'Opus 5.5 · (0.00%) 0 / 200k · ~/Projects/claudify'])
})

test('effort follows the saved setting, /effort, and what a request is sent at', async ($, on) => {
  const session: Session = { inRepo: false, branch: '', saved: { 'claude-opus-5-5': 'medium', 'claude-sonnet-5-5': 'low' } }
  engine(on, session)
  on('command.run', () => ({ ref: 1 }))
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [] } as unknown as TurnStepResult
  })
  const row = async () => (await shown($))[1]

  await $.session.start({ cwd: '/Users/me/Projects/claudify', surface: 'terminal', isInteractive: true })
  expect(await row()).toBe('Opus 5.5 (medium) · (0.00%) 0 / 200k · ~/Projects/claudify')

  await $.command.run({ command: 'effort', args: 'high' } as never)
  expect(await row()).toBe('Opus 5.5 (high) · (0.00%) 0 / 200k · ~/Projects/claudify')

  await $.classic.PostModelSwitch({
    from_model: 'claude-opus-5-5',
    to_model: 'claude-sonnet-5-5',
    requested_model: 'sonnet',
    source: 'command',
    context_tokens: 0,
    prompt_cache_warm: false,
    cache_ttl: '5m',
    estimated_cache_write_usd: 0,
    pricing: 'default',
  })
  expect(await row()).toBe('Sonnet 5.5 (low) · (0.00%) 0 / 200k · ~/Projects/claudify')
  session.model = 'claude-sonnet-5-5'

  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-sonnet-5-5', effort: 'xhigh', messageCount: 1 })) {
  }
  expect(await row()).toBe('Sonnet 5.5 (xhigh) · (0.00%) 0 / 200k · ~/Projects/claudify')
})

test('a level picked for this session only is read from the row /effort prints', async ($, on) => {
  const session: Session = {
    inRepo: false,
    branch: '',
    saved: { 'claude-opus-5-5': 'high' },
    printed: ['<local-command-stdout>Set effort level to max (this session only): …</local-command-stdout>'],
  }
  engine(on, session)
  const clock = mock.clock(on)
  // The engine prints the picker's choice after the command's hooks return.
  on('command.run', () => ({ ref: 1 }))
  const row = async () => (await shown($))[1]

  await $.session.start({ cwd: '/Users/me/Projects/claudify', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'effort', args: '' } as never)
  expect(await row()).toBe('Opus 5.5 (high) · (0.00%) 0 / 200k · ~/Projects/claudify')

  // An earlier run's row is not taken for this one.
  await clock.advance(100)
  expect(await row()).toBe('Opus 5.5 (high) · (0.00%) 0 / 200k · ~/Projects/claudify')

  await $.command.run({ command: 'effort', args: '' } as never)
  session.printed?.push('<local-command-stdout>Set effort level to low (this session only): …</local-command-stdout>')
  await clock.advance(100)
  expect(await row()).toBe('Opus 5.5 (low) · (0.00%) 0 / 200k · ~/Projects/claudify')
})

test('an effort set in the /model picker is read from the row it prints', async ($, on) => {
  const session: Session = { inRepo: false, branch: '', saved: { 'claude-opus-5-5': 'medium' }, printed: [] }
  engine(on, session)
  const clock = mock.clock(on)
  on('command.run', () => ({ ref: 1 }))
  const row = async () => (await shown($))[1]

  await $.session.start({ cwd: '/Users/me/Projects/claudify', surface: 'terminal', isInteractive: true })
  expect(await row()).toBe('Opus 5.5 (medium) · (0.00%) 0 / 200k · ~/Projects/claudify')

  // Same model, a new level for this session only: no switch, nothing saved.
  await $.command.run({ command: 'model', args: '' } as never)
  session.printed?.push('<local-command-stdout>Set model to `Opus 5.5` for this session only with `high` effort</local-command-stdout>')
  await clock.advance(100)
  expect(await row()).toBe('Opus 5.5 (high) · (0.00%) 0 / 200k · ~/Projects/claudify')
})
