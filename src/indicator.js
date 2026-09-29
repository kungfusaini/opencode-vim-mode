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

function toRGB01(color) {
  if (!color) return null
  if (typeof color === "string") {
    const hex = color.trim().toLowerCase()
    if (hex === "transparent" || hex === "none") return null
    const h = hex.replace("#", "")
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(full)) return null
    return {
      r: parseInt(full.slice(0, 2), 16) / 255,
      g: parseInt(full.slice(2, 4), 16) / 255,
      b: parseInt(full.slice(4, 6), 16) / 255,
    }
  }
  if (typeof color.r === "number" && typeof color.g === "number" && typeof color.b === "number") {
    const scale = color.r > 1 || color.g > 1 || color.b > 1 ? 255 : 1
    return { r: color.r / scale, g: color.g / scale, b: color.b / scale }
  }
  return null
}

// The `system` theme resolves `theme.background` to a transparent color
// (alpha 0, same RGB as the terminal background) so it can show the terminal
// through. Using it directly as badge text color makes NORMAL/INSERT/VISUAL
// labels invisible. Pick black/white by badge luminance instead, same idea
// as opencode's own selectedForeground().
function contrastingFg(bg, fallback) {
  const rgb = toRGB01(bg)
  if (!rgb) return fallback ?? "#ffffff"
  const luminance = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b
  return luminance > 0.5 ? "#000000" : "#ffffff"
}

function colors(api, current) {
  const theme = api.theme.current
  if (current === "NORMAL") return { fg: contrastingFg(theme.warning, theme.text), bg: theme.warning }
  if (current === "INSERT") return { fg: contrastingFg(theme.success, theme.text), bg: theme.success }
  if (current === "VISUAL") return { fg: contrastingFg(theme.accent, theme.text), bg: theme.accent }
  if (current === "VISUAL LINE") return { fg: contrastingFg(theme.primary, theme.text), bg: theme.primary }
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
