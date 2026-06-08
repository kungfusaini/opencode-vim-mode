import indicator from "./indicator.js"
import vimMode from "./vim-mode.js"

export default {
  id: "opencode-vim-mode",
  async tui(api) {
    await indicator.tui(api)
    await vimMode.tui(api)
  },
}
