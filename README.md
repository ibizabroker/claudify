# claudify

A Claude Code mod that adds a status line under the prompt, in the same dim style as the
mode hint above it:

```
  ⏵⏵ auto mode on (shift+tab to cycle)
  Opus 5.5 (medium) · (4.95%) 49.5k / 1M · ~/Projects/claudify · main
```

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
