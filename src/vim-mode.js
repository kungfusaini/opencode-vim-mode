import { spawn } from "node:child_process"

const ENABLED_KEY = "vim-mode.enabled"
const MODE_KEY = "vim-mode.mode"
const SELECTED_MESSAGE_KEY = "vim-mode.selected-message"
const INSERT = "insert"
const NORMAL = "normal"
const VISUAL = "visual"
const VISUAL_LINE = "visual_line"
const OFF = "off"

function isPromptFocused(api) {
  if (api.ui.dialog.open) return false
  const route = api.route.current?.name
  if (route !== "home" && route !== "session") return false
  return Boolean(api.renderer.currentFocusedEditor)
}

function normalizeKey(event) {
  const name = String(event?.name ?? "").toLowerCase()
  if (!name) return ""
  if (name === "return") return "enter"
  if (name === "space") return "space"
  if (event?.shift && name === "4") return "$"
  return name
}

function isModified(event) {
  return Boolean(event?.ctrl || event?.meta || event?.super || event?.hyper)
}

function shouldSwallowInNormalMode(key) {
  return key === "enter" || key === "backspace" || key === "space" || key.length === 1
}

function stopEvent(event) {
  event?.preventDefault?.()
  event?.stopPropagation?.()
}

function lighten(color, amount = 0.08) {
  if (!color) return color
  return {
    ...color,
    r: Math.min(255, Math.round(color.r + (255 - color.r) * amount)),
    g: Math.min(255, Math.round(color.g + (255 - color.g) * amount)),
    b: Math.min(255, Math.round(color.b + (255 - color.b) * amount)),
  }
}

function currentSessionID(api) {
  const route = api.route.current
  if (route?.name !== "session") return undefined
  return typeof route.params?.sessionID === "string" ? route.params.sessionID : undefined
}

function sessionIsBusy(api) {
  const sessionID = currentSessionID(api)
  if (!sessionID) return false
  const status = api.state.session.status(sessionID)
  return Boolean(status && status.type !== "idle")
}

function messageHasVisibleText(api, sessionID, messageID) {
  const parts = api.state.part(messageID)
  if (!parts || !Array.isArray(parts)) return false
  return parts.some((part) => part && part.type === "text" && !part.synthetic && !part.ignored)
}

function validMessageIDs(api, sessionID) {
  return api.state.session.messages(sessionID).filter((message) => messageHasVisibleText(api, sessionID, message.id)).map((message) => message.id)
}

function messageRenderable(api, messageID) {
  return api.renderer.root?.findDescendantById?.(messageID)
}

function isRenderableVisible(api, renderable) {
  if (!renderable || renderable.isDestroyed || !renderable.visible) return false
  return renderable.screenY + renderable.height > 0 && renderable.screenY < api.renderer.height
}

function visibleMessageIDs(api, sessionID) {
  return validMessageIDs(api, sessionID)
    .map((id) => ({ id, renderable: messageRenderable(api, id) }))
    .filter((entry) => isRenderableVisible(api, entry.renderable))
    .sort((a, b) => a.renderable.screenY - b.renderable.screenY)
    .map((entry) => entry.id)
}

function stripPromptPart(part) {
  if (part.type === "file" || part.type === "agent" || part.type === "text") {
    const { id, messageID, sessionID, ...rest } = part
    return rest
  }
  return part
}

async function copyText(text) {
  await new Promise((resolve, reject) => {
    const child = spawn("pbcopy")
    child.on("error", reject)
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`pbcopy exited with code ${code}`))))
    child.stdin.on("error", reject)
    child.stdin.end(text)
  })
}

function lineOffsetsAndBounds(text) {
  const lines = text.split("\n")
  const bounds = []
  let offset = 0
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const start = offset
    const endExclusive = start + line.length
    bounds.push({ start, endExclusive, lineIndex: i, lineCount: lines.length })
    offset = endExclusive + 1
  }
  if (bounds.length === 0) bounds.push({ start: 0, endExclusive: 0, lineIndex: 0, lineCount: 1 })
  return bounds
}

function currentLineIndex(editor) {
  return Math.max(0, editor?.logicalCursor?.row ?? 0)
}

function lineBoundsByIndex(text, index) {
  const bounds = lineOffsetsAndBounds(text)
  const clamped = Math.max(0, Math.min(index, bounds.length - 1))
  return bounds[clamped]
}

async function readClipboardText() {
  return await new Promise((resolve, reject) => {
    const child = spawn("pbpaste")
    let stdout = ""
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk)
    })
    child.on("error", reject)
    child.on("close", (code) => (code === 0 ? resolve(stdout) : reject(new Error(`pbpaste exited with code ${code}`))))
  })
}

export default {
  id: "opencode-vim-mode-core",
  async tui(api) {
    let enabled = true
    let hydrated = false
    let mode = INSERT
    let selectedMessageID
    let pendingG = false
    let pendingGTimer
    let pendingOperator
    let pendingOperatorTimer
    let visualLineAnchor
    let visualLineCurrent
    let highlightedEntries = []

    const clearPendingG = () => {
      pendingG = false
      if (pendingGTimer) {
        clearTimeout(pendingGTimer)
        pendingGTimer = undefined
      }
    }

    const armPendingG = () => {
      clearPendingG()
      pendingG = true
      pendingGTimer = setTimeout(() => {
        pendingG = false
        pendingGTimer = undefined
      }, 500)
    }

    const clearPendingOperator = () => {
      pendingOperator = undefined
      if (pendingOperatorTimer) {
        clearTimeout(pendingOperatorTimer)
        pendingOperatorTimer = undefined
      }
    }

    const armPendingOperator = (operator) => {
      clearPendingOperator()
      pendingOperator = operator
      pendingOperatorTimer = setTimeout(() => {
        pendingOperator = undefined
        pendingOperatorTimer = undefined
      }, 600)
    }

    const hydrateEnabled = () => {
      if (hydrated || !api.kv.ready) return
      enabled = api.kv.get(ENABLED_KEY, true)
      mode = enabled ? INSERT : OFF
      api.kv.set(MODE_KEY, mode)
      selectedMessageID = api.kv.get(SELECTED_MESSAGE_KEY, undefined)
      hydrated = true
    }

    const ensureHydrated = () => {
      hydrateEnabled()
      if (!hydrated) return
      api.renderer.off("frame", ensureHydrated)
    }

    ensureHydrated()
    if (!hydrated) api.renderer.on("frame", ensureHydrated)

    const setEnabled = (next) => {
      hydrated = true
      enabled = next
      api.kv.set(ENABLED_KEY, next)
      mode = next ? INSERT : OFF
      api.kv.set(MODE_KEY, mode)
      api.ui.toast({ message: next ? "Vim mode enabled" : "Vim mode disabled", duration: 1200 })
    }

    const setMode = (next) => {
      if (mode === next) return
      mode = next
      api.kv.set(MODE_KEY, next)
    }

    const focusedEditor = () => api.renderer.currentFocusedEditor
    const clearVisualSelection = () => {
      focusedEditor()?.clearSelection?.()
    }

    const applyVisualLineSelection = () => {
      const editor = focusedEditor()
      if (!editor || visualLineAnchor == null || visualLineCurrent == null) return false
      const text = editor.plainText ?? ""
      const anchor = lineBoundsByIndex(text, visualLineAnchor)
      const current = lineBoundsByIndex(text, visualLineCurrent)
      const start = Math.min(anchor.start, current.start)
      const end = Math.max(anchor.endExclusive, current.endExclusive)
      editor.setSelection?.(start, end)
      editor.requestRender?.()
      api.renderer.requestRender()
      return true
    }

    const moveVisualLineSelection = (delta) => {
      const editor = focusedEditor()
      if (!editor || visualLineCurrent == null) return false
      const text = editor.plainText ?? ""
      const { lineCount } = lineBoundsByIndex(text, visualLineCurrent)
      visualLineCurrent = Math.max(0, Math.min(lineCount - 1, visualLineCurrent + delta))
      return applyVisualLineSelection()
    }

    const enterVisualMode = (linewise = false) => {
      const editor = focusedEditor()
      if (!editor) return false
      const offset = editor.cursorOffset
      if (linewise) {
        visualLineAnchor = currentLineIndex(editor)
        visualLineCurrent = visualLineAnchor
        applyVisualLineSelection()
      } else {
        visualLineAnchor = undefined
        visualLineCurrent = undefined
        editor.setSelectionInclusive?.(offset, offset)
      }
      setMode(linewise ? VISUAL_LINE : VISUAL)
      api.renderer.requestRender()
      return true
    }

    const exitVisualMode = () => {
      visualLineAnchor = undefined
      visualLineCurrent = undefined
      clearVisualSelection()
      setMode(NORMAL)
      api.renderer.requestRender()
    }

    const yankVisualSelection = async () => {
      const editor = focusedEditor()
      const selection = editor?.getSelection?.()
      const text = selection
        ? editor.plainText.slice(Math.min(selection.start, selection.end), Math.max(selection.start, selection.end))
        : editor?.getSelectedText?.() || api.renderer.getSelection()?.getSelectedText?.() || ""
      if (!text) {
        api.ui.toast({ message: "Nothing selected", duration: 1000 })
        exitVisualMode()
        return true
      }
      exitVisualMode()
      try {
        await copyText(text)
        api.ui.toast({ message: "Yanked selection", duration: 1000 })
      } catch {
        api.ui.toast({ message: "Failed to copy selection", variant: "error", duration: 1500 })
      }
      return true
    }

    const deleteVisualSelection = (enterInsert = false) => {
      const editor = focusedEditor()
      if (!editor?.hasSelection?.()) {
        exitVisualMode()
        return true
      }
      editor.deleteSelection?.()
      clearVisualSelection()
      setMode(enterInsert ? INSERT : NORMAL)
      api.renderer.requestRender()
      return true
    }

    const restoreHighlight = () => {
      for (const entry of highlightedEntries) {
        if (!entry.renderable || entry.renderable.isDestroyed) continue
        entry.renderable.borderColor = entry.original.borderColor
        if (entry.original.backgroundColor !== undefined && "backgroundColor" in entry.renderable) {
          entry.renderable.backgroundColor = entry.original.backgroundColor
        }
        if (entry.content && !entry.content.isDestroyed) {
          entry.content.backgroundColor = entry.original.contentBackgroundColor
        }
      }
      highlightedEntries = []
    }

    const highlightedMessageIDs = () => (selectedMessageID ? [selectedMessageID] : [])

    const syncHighlight = () => {
      if (!enabled) {
        restoreHighlight()
        return
      }
      const ids = highlightedMessageIDs()
      if (!ids.length) {
        restoreHighlight()
        return
      }
      if (highlightedEntries.length === ids.length && highlightedEntries.every((entry, index) => entry.messageID === ids[index] && entry.renderable && !entry.renderable.isDestroyed)) {
        return
      }
      restoreHighlight()
      highlightedEntries = ids.flatMap((messageID, index) => {
        const renderable = messageRenderable(api, messageID)
        if (!renderable || renderable.isDestroyed) return []
        const content = renderable.getChildren?.()[0]
        const borderColor = lighten(api.theme.current.primary, 0.1)
        const backgroundColor = lighten(api.theme.current.backgroundElement, 0.06)
        const original = {
          borderColor: renderable.borderColor,
          backgroundColor: "backgroundColor" in renderable ? renderable.backgroundColor : undefined,
          contentBackgroundColor: content?.backgroundColor,
        }
        renderable.borderColor = borderColor
        if ("backgroundColor" in renderable) renderable.backgroundColor = backgroundColor
        if (content && "backgroundColor" in content) content.backgroundColor = backgroundColor
        return [{ messageID, renderable, content, original, index }]
      })
      if (highlightedEntries.length) api.renderer.requestRender()
    }

    const setSelectedMessage = (messageID) => {
      selectedMessageID = messageID
      if (messageID) api.kv.set(SELECTED_MESSAGE_KEY, messageID)
      syncHighlight()
    }

    const clearSelectedMessage = () => {
      if (!selectedMessageID) return
      selectedMessageID = undefined
      api.kv.set(SELECTED_MESSAGE_KEY, undefined)
      syncHighlight()
    }

    const selectedMessage = () => {
      const sessionID = currentSessionID(api)
      if (!sessionID) return undefined
      if (!selectedMessageID) return undefined
      const ids = validMessageIDs(api, sessionID)
      const current = ids.includes(selectedMessageID) ? selectedMessageID : undefined
      if (!current) return undefined
      return api.state.session.messages(sessionID).find((message) => message.id === current)
    }

    const promptInfoFromMessage = (messageID) => {
      const parts = api.state.part(messageID)
      return parts.reduce((agg, part) => {
        if (part.type === "text" && !part.synthetic) agg.input += part.text
        if (part.type === "file") agg.parts.push(stripPromptPart(part))
        return agg
      }, { input: "", parts: [] })
    }

    const openSelectedMessageDialog = () => {
      const sessionID = currentSessionID(api)
      const message = selectedMessage()
      if (!sessionID || !message) {
        api.ui.toast({ message: "Select a message first with J or K", duration: 1200 })
        return true
      }
      if (message.role !== "user") {
        api.ui.toast({ message: "Message actions are only available for user messages right now.", duration: 1500 })
        return true
      }
      api.ui.dialog.replace(() =>
        api.ui.DialogSelect({
          title: "Message Actions",
          options: [
            { title: "Revert", value: "session.revert", description: "undo messages and file changes" },
            { title: "Copy", value: "message.copy", description: "message text to clipboard" },
            { title: "Fork", value: "session.fork", description: "create a new session" },
          ],
          onSelect: async (option) => {
            if (option.value === "session.revert") {
              await api.client.session.revert({ sessionID, messageID: message.id })
              api.ui.dialog.clear()
              return
            }
            if (option.value === "message.copy") {
              const text = api.state.part(message.id).reduce((agg, part) => {
                if (part.type === "text" && !part.synthetic) agg += part.text
                return agg
              }, "")
              try {
                await copyText(text)
                api.ui.toast({ message: "Copied message to clipboard", duration: 1200 })
              } catch {
                api.ui.toast({ message: "Failed to copy message", variant: "error", duration: 1500 })
              }
              api.ui.dialog.clear()
              return
            }
            if (option.value === "session.fork") {
              const result = await api.client.session.fork({ sessionID, messageID: message.id })
              api.route.navigate("session", { sessionID: result.data.id, prompt: promptInfoFromMessage(message.id) })
              api.ui.dialog.clear()
            }
          },
        }),
      )
      return true
    }

    const deriveSelectedMessage = () => {
      const sessionID = currentSessionID(api)
      if (!sessionID) return undefined
      const visible = visibleMessageIDs(api, sessionID)
      if (selectedMessageID && visible.includes(selectedMessageID)) return selectedMessageID
      return visible[0]
    }

    const setSelectedFromVisible = (position = "first") => {
      const sessionID = currentSessionID(api)
      if (!sessionID) return false
      const visible = visibleMessageIDs(api, sessionID)
      if (!visible.length) return false
      setSelectedMessage(position === "last" ? visible[visible.length - 1] : visible[0])
      return true
    }

    const run = (command) => {
      api.keymap.dispatchCommand(command)
    }

    const runMessageCommand = (command, position = "first") => {
      run(command)
      setTimeout(() => {
        setSelectedFromVisible(position)
      }, 0)
      return true
    }

    const isMessageSelectionGesture = (key, event) => {
      if (event?.shift && (key === "j" || key === "k" || key === "g")) return true
      if (pendingG && key === "g" && !event?.shift) return true
      return false
    }

    const moveSelectedMessage = (delta) => runMessageCommand(delta > 0 ? "session.message.next" : "session.message.previous")

    const jumpToEdgeMessage = (edge) => {
      const sessionID = currentSessionID(api)
      if (!sessionID) return false
      const ids = validMessageIDs(api, sessionID)
      if (!ids.length) return false
      setSelectedMessage(edge === "first" ? ids[0] : ids[ids.length - 1])
      return runMessageCommand(edge === "first" ? "session.first" : "session.last", edge === "first" ? "first" : "last")
    }

    const enterInsertAfter = (command) => {
      if (command) run(command)
      setMode(INSERT)
    }

    const moveInputOrScroll = (direction) => {
      const editor = focusedEditor()
      const before = editor?.cursorOffset
      run(direction === "down" ? "input.move.down" : "input.move.up")
      const after = editor?.cursorOffset
      if (before !== undefined && after !== undefined && after !== before) return true
      run(direction === "down" ? "session.line.down" : "session.line.up")
      return true
    }

    const handleCtrlMotion = (key, event) => {
      if (!event?.ctrl || event?.meta || event?.super || event?.hyper) return false
      if (mode !== NORMAL) return false
      if (key === "d") {
        run("session.half.page.down")
        return true
      }
      if (key === "u") {
        run("session.half.page.up")
        return true
      }
      return false
    }

    const applyPendingOperator = (key, event) => {
      if (!pendingOperator) return false
      const operator = pendingOperator
      clearPendingOperator()
      if (operator === "d") {
        if (event?.shift && key === "d") return run("input.delete.to.line.end"), true
        if (key === "d") return run("input.delete.line"), true
        if (key === "w") return run("input.delete.word.forward"), true
        if (key === "b") return run("input.delete.word.backward"), true
        return false
      }
      if (operator === "c") {
        if (event?.shift && key === "c") return enterInsertAfter("input.delete.to.line.end"), true
        if (key === "c") return enterInsertAfter("input.delete.line"), true
        if (key === "w") return enterInsertAfter("input.delete.word.forward"), true
        if (key === "b") return enterInsertAfter("input.delete.word.backward"), true
        return false
      }
      return false
    }

    const disposeCommand = api.command?.register(() => [
      {
        title: "Toggle vim mode",
        value: "vim-mode.toggle",
        description: "Toggle modal vim-style prompt navigation.",
        category: "Vim",
        slash: { name: "vim-mode", aliases: ["vim"] },
        onSelect: () => {
          hydrateEnabled()
          setEnabled(!enabled)
        },
      },
    ])

    const disposeIntercept = api.keymap.intercept("key", ({ event }) => {
      hydrateEnabled()
      if (!enabled) return
      if (!isPromptFocused(api)) return

      const key = normalizeKey(event)
      if (!key) return
      if (handleCtrlMotion(key, event)) {
        clearPendingG()
        clearPendingOperator()
        stopEvent(event)
        return
      }
      if (isModified(event)) {
        clearPendingG()
        clearPendingOperator()
        clearSelectedMessage()
        return
      }

      if (mode === INSERT) {
        clearPendingG()
        clearPendingOperator()
        if (selectedMessageID) clearSelectedMessage()
        if (key !== "escape") return
        stopEvent(event)
        setMode(NORMAL)
        return
      }

      if (mode === VISUAL || mode === VISUAL_LINE) {
        clearPendingG()
        clearPendingOperator()
        if (selectedMessageID) clearSelectedMessage()
        if (key === "escape") {
          stopEvent(event)
          exitVisualMode()
          return
        }
        if (key === "y") {
          stopEvent(event)
          void yankVisualSelection()
          return
        }
        if (key === "d") {
          stopEvent(event)
          deleteVisualSelection(false)
          return
        }
        if (key === "c") {
          stopEvent(event)
          deleteVisualSelection(true)
          return
        }
        let handledVisual = true
        switch (key) {
          case "h":
            if (mode === VISUAL_LINE) handledVisual = false
            else run("input.select.left")
            break
          case "l":
            if (mode === VISUAL_LINE) handledVisual = false
            else run("input.select.right")
            break
          case "j":
            if (mode === VISUAL_LINE) moveVisualLineSelection(1)
            else run("input.select.down")
            break
          case "k":
            if (mode === VISUAL_LINE) moveVisualLineSelection(-1)
            else run("input.select.up")
            break
          case "w":
            run("input.select.word.forward")
            break
          case "b":
            run("input.select.word.backward")
            break
          case "0":
            if (mode === VISUAL_LINE) handledVisual = false
            else run("input.select.line.home")
            break
          case "$":
            if (mode === VISUAL_LINE) handledVisual = false
            else run("input.select.line.end")
            break
          default:
            handledVisual = false
            break
        }
        if (handledVisual || shouldSwallowInNormalMode(key)) stopEvent(event)
        return
      }

      if (key === "escape") {
        clearPendingOperator()
        clearSelectedMessage()
        if (sessionIsBusy(api)) run("session.interrupt")
        stopEvent(event)
        return
      }

      if (key === "enter") {
        clearPendingG()
        openSelectedMessageDialog()
        clearSelectedMessage()
        stopEvent(event)
        return
      }

      if (event?.shift && key === "i") {
        clearPendingG()
        clearPendingOperator()
        clearSelectedMessage()
        run("input.line.home")
        setMode(INSERT)
        stopEvent(event)
        return
      }

      if (selectedMessageID && !isMessageSelectionGesture(key, event)) clearSelectedMessage()

      if (event?.shift && key === "g") {
        clearPendingG()
        jumpToEdgeMessage("last")
        stopEvent(event)
        return
      }
      if (pendingG) {
        if (key === "g" && !event?.shift) {
          clearPendingG()
          clearPendingOperator()
          jumpToEdgeMessage("first")
          stopEvent(event)
          return
        }
        clearPendingG()
      }
      if (key === "g" && !event?.shift) {
        clearPendingOperator()
        armPendingG()
        stopEvent(event)
        return
      }
      if (applyPendingOperator(key, event)) {
        stopEvent(event)
        return
      }

      let handled = true
      switch (key) {
        case "i":
          clearPendingOperator()
          setMode(INSERT)
          break
        case "a":
          clearPendingOperator()
          if (event?.shift) enterInsertAfter("input.line.end")
          else enterInsertAfter("input.move.right")
          break
        case "c":
          if (event?.shift) {
            clearPendingOperator()
            enterInsertAfter("input.delete.to.line.end")
          } else {
            armPendingOperator("c")
          }
          break
        case "d":
          if (event?.shift) {
            clearPendingOperator()
            run("input.delete.to.line.end")
          } else {
            armPendingOperator("d")
          }
          break
        case "h":
          clearPendingOperator()
          run("input.move.left")
          break
        case "l":
          clearPendingOperator()
          run("input.move.right")
          break
        case "j":
          clearPendingOperator()
          if (event?.shift) moveSelectedMessage(1)
          else moveInputOrScroll("down")
          break
        case "k":
          clearPendingOperator()
          if (event?.shift) moveSelectedMessage(-1)
          else moveInputOrScroll("up")
          break
        case "0":
          clearPendingOperator()
          run("input.line.home")
          break
        case "$":
          clearPendingOperator()
          run("input.line.end")
          break
        case "w":
          clearPendingOperator()
          run("input.word.forward")
          break
        case "b":
          clearPendingOperator()
          run("input.word.backward")
          break
        case "x":
          clearPendingOperator()
          run("input.delete")
          break
        case "p":
          clearPendingOperator()
          handled = false
          stopEvent(event)
          readClipboardText().then((text) => {
            if (!text) return
            focusedEditor()?.insertText?.(text)
            api.renderer.requestRender()
          }).catch(() => {
            api.ui.toast({ message: "Failed to paste clipboard", variant: "error", duration: 1500 })
          })
          return
        case "v":
          clearPendingOperator()
          enterVisualMode(Boolean(event?.shift))
          break
        default:
          clearPendingOperator()
          handled = false
          break
      }

      if (handled || shouldSwallowInNormalMode(key)) stopEvent(event)
    }, { priority: 100 })

    api.lifecycle.onDispose(() => {
      api.renderer.off("frame", ensureHydrated)
      clearPendingG()
      clearPendingOperator()
      clearSelectedMessage()
      restoreHighlight()
      disposeCommand?.()
      disposeIntercept?.()
    })

    api.renderer.on("frame", syncHighlight)
    api.lifecycle.onDispose(() => {
      api.renderer.off("frame", syncHighlight)
    })
  },
}
