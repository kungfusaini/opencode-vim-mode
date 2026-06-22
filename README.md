# opencode-vim-mode

`@kungfusaini/opencode-vim-mode` is an OpenCode TUI plugin that adds a practical Vim-style modal layer to the prompt without patching OpenCode itself.

It is designed for people who want a more Vim-like OpenCode experience while still using the built-in TUI.

## Features

### Modal prompt editing

- insert and normal modes
- prompt mode badge in the footer
- startup defaults to insert mode

### Normal-mode prompt motions and editing

- `h` / `l` move left and right
- `j` / `k` are context-sensitive:
  - move inside multiline prompt input when possible
  - otherwise scroll the pane
- `w` / `b`, `0` / `$`
- `a`, `A`, `I`
- `x`, `dd`, `dw`, `db`, `D`
- `cc`, `cw`, `cb`, `C`
- `p` paste from clipboard

### Prompt visual mode

- `v` characterwise visual mode in the input box
- `V` linewise visual mode in the input box
- `y`, `d`, `c` for selected prompt text

### Message navigation and actions

- `J` / `K` select next and previous visible messages
- `gg` / `G` jump to first and last message
- selected message highlight
- `Enter` opens message actions for an explicitly selected message
- message actions currently include:
  - Revert
  - Copy
  - Fork

### Scrolling

- `ctrl+u` half-page up
- `ctrl+d` half-page down

## Install

Use the normal OpenCode plugin installation path by adding the package to your `tui.json` plugin list:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    "@kungfusaini/opencode-vim-mode"
  ]
}
```

Then restart OpenCode.

## Notes

- `ctrl+d` in normal mode is repurposed for Vim-style half-page down while the prompt is focused, so use `ctrl+c` or your other quit bindings to exit.
- unhandled modified-key chords such as `ctrl+x, m` are passed through in normal mode so OpenCode can complete them.
- `Enter` for message actions only works when a message is actively selected with `J`, `K`, `gg`, or `G`.
- This plugin intentionally leans on current OpenCode/OpenTUI behavior and should be considered experimental.

## Development

For local development, you can point OpenCode to your local build in `tui.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    "file:///Users/sumeet/matrix/tools/opencode/opencode-vim-mode/src/index.js"
  ]
}
```

Restart OpenCode after editing this config so it picks up file-based plugin changes.

## Compatibility

- tested against OpenCode 1.15.x TUI behavior

## License

MIT
