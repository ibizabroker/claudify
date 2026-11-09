# <img src=".claude-plugin/icon.png" alt="" width="40" align="top"> claudify

A Claude Code mod that adds a status line under the prompt, in the same dim style as the
mode hint above it:

```
  ⏵⏵ auto mode on (shift+tab to cycle)
  Opus 5.5 (medium) · (4.95%) 49.5k / 1M · ~/Projects/claudify · main
```

## What it reads and runs

claudify works only on your machine and sends nothing anywhere. To draw the line it:

- asks the session for its model, context usage, working folder and transcript;
- reads `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`) for the
  effort level saved for the current model;
- runs `git branch --show-current`, and `git rev-parse --short HEAD` on a detached
  HEAD, in the working folder when it is a git repository.

It writes no files and changes no settings.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install claudify --marketplace ibizabroker/claudify
```

Answer `y` to add the marketplace, then pick a scope. From a shell:

```
claude plugin install claudify --marketplace ibizabroker/claudify
```

## Develop

```
claude --plugin-dir .      # run a session with the mod loaded; edits reload it
claude plugin test .       # run the tests
claude plugin validate .
```
