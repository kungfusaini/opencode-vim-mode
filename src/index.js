import indicator from "./indicator.js"
import vimMode from "./vim-mode.js"

export const id = "opencode-vim-mode"

export async function tui(api) {
  await indicator.tui(api)
  await vimMode.tui(api)
}

export default {
  id,
  tui,
}
