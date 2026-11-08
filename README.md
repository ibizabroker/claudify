# claudify

A Claude Code mod that adds a status line under the prompt, in the same dim style as the
mode hint above it:

```
  ⏵⏵ auto mode on (shift+tab to cycle)
  Opus 5.5 (medium) · (4.95%) 49.5k / 1M · ~/Projects/claudify · main
```

- **Model and effort**: updates as soon as you change either with `/model` or `/effort`,
  including "this session only" choices.
- **Context used**: the share of the model's context window, to two decimals, with tokens
  used over the window size. After `/resume` it shows the resumed session's last fill.
- **Folder**: the session's working directory, with `~` for your home folder.
- **Git branch**: only inside a git repository; a short commit hash on a detached HEAD.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install claudify --marketplace ibizabroker/claudify
```

Answer `y` to add the marketplace, then pick a scope. From a shell:

```
claude plugin install claudify --marketplace ibizabroker/claudify
```

## Notes

- The git branch is read by running `git`, which mods can do in the terminal only.
- Claude Code gives mods no direct way to read the effort level, so claudify reads the level
  saved in `~/.claude/settings.json`, what `/effort` and `/model` print, and the level each
  request is sent at. Before the first request, a model with no saved level shows no effort.

## Develop

```
claude --plugin-dir .      # run a session with the mod loaded; edits reload it
claude plugin test .       # run the tests
claude plugin validate .
```
