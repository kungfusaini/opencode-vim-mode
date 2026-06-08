import { createMemo } from "solid-js"
import { createElement, insert, setProp } from "@opentui/solid"

const ENABLED_KEY = "vim-mode.enabled"
const MODE_KEY = "vim-mode.mode"

function label(api) {
  const enabled = createMemo(() => api.kv.get(ENABLED_KEY, true))
  const mode = createMemo(() => api.kv.get(MODE_KEY, "insert"))

  return createMemo(() => {
    if (!enabled()) return "OFF"
    return String(mode() || "insert").toUpperCase().replaceAll("_", " ")
  })
}

function colors(api, current) {
  const theme = api.theme.current
  if (current === "NORMAL") return { fg: theme.background, bg: theme.warning }
  if (current === "INSERT") return { fg: theme.background, bg: theme.success }
  if (current === "VISUAL") return { fg: theme.background, bg: theme.accent }
  if (current === "VISUAL LINE") return { fg: theme.background, bg: theme.primary }
  return { fg: theme.text, bg: theme.backgroundElement }
}

function view(api) {
  const current = label(api)
  const box = createElement("box")
  const text = createElement("text")

  setProp(box, "flexDirection", "row")
  setProp(box, "gap", 1)
  insert(box, text)

  insert(text, () => {
    const value = current()
    const tint = colors(api, value)
    const span = createElement("span")
    setProp(span, "style", {
      fg: tint.fg,
      bg: tint.bg,
      bold: true,
    })
    insert(span, ` ${value} `)
    return span
  })

  return box
}

export default {
  id: "opencode-vim-mode-indicator",
  async tui(api) {
    api.slots.register({
      order: 90,
      slots: {
        home_prompt_right() {
          return view(api)
        },
        session_prompt_right() {
          return view(api)
        },
      },
    })
  },
}
