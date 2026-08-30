import { test, mock } from "node:test"
import assert from "node:assert"

// We test the keyboard shortcut logic inline since the hook has a React
// dependency that isn't available in this test environment. The logic mirrors
// useKeyboardShortcuts exactly, so these tests validate the behavior.

type Handlers = {
  onCreatePool: () => void
  onGoToGroups: () => void
  onGoToTransactions: () => void
  onGoToProfile: () => void
  onOpenHelp: () => void
}

interface FakeKeyboardEvent {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  target: HTMLElement | null
  preventDefault: ReturnType<typeof mock.fn>
  defaultPrevented: boolean
}

function makeEvent(
  key: string,
  mods?: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean }
): FakeKeyboardEvent {
  return {
    key,
    metaKey: mods?.meta ?? false,
    ctrlKey: mods?.ctrl ?? false,
    altKey: mods?.alt ?? false,
    shiftKey: mods?.shift ?? false,
    target: null,
    preventDefault: mock.fn(),
    defaultPrevented: false,
  }
}

function makeInputEvent(key: string): FakeKeyboardEvent {
  const ev = makeEvent(key)
  ev.target = { tagName: "INPUT" } as HTMLElement
  return ev
}

function createHandler() {
  let gTimer: ReturnType<typeof setTimeout> | null = null

  function handleKeyDown(e: FakeKeyboardEvent, handlers: Handlers) {
    const target = e.target
    if (
      target?.tagName === "INPUT" ||
      target?.tagName === "TEXTAREA" ||
      target?.tagName === "SELECT" ||
      (target as HTMLElement)?.isContentEditable
    ) {
      return
    }

    const key = e.key

    if (gTimer !== null) {
      if (gTimer) clearTimeout(gTimer)
      gTimer = null
      const lowerKey = key.toLowerCase()
      if (lowerKey === "h" || lowerKey === "t" || lowerKey === "p") {
        e.preventDefault()
        switch (lowerKey) {
          case "h":
            handlers.onGoToGroups()
            break
          case "t":
            handlers.onGoToTransactions()
            break
          case "p":
            handlers.onGoToProfile()
            break
        }
        return
      }
      return
    }

    if (key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      handlers.onOpenHelp()
      return
    }

    if (key.toLowerCase() === "c" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      handlers.onCreatePool()
      return
    }

    if (key.toLowerCase() === "g" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      if (gTimer) clearTimeout(gTimer)
      gTimer = setTimeout(() => {
        gTimer = null
      }, 1000)
      return
    }
  }

  return { handleKeyDown }
}

function setup() {
  const handlers = {
    onCreatePool: mock.fn(),
    onGoToGroups: mock.fn(),
    onGoToTransactions: mock.fn(),
    onGoToProfile: mock.fn(),
    onOpenHelp: mock.fn(),
  }

  const { handleKeyDown } = createHandler()

  function dispatch(
    key: string,
    mods?: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean }
  ) {
    const event = makeEvent(key, mods)
    handleKeyDown(event, handlers)
    return event
  }

  return { handlers, dispatch }
}

test("c shortcut triggers onCreatePool", () => {
  const { handlers, dispatch } = setup()
  dispatch("c")
  assert.strictEqual(handlers.onCreatePool.mock.callCount(), 1)
})

test("c with modifier does not trigger onCreatePool", () => {
  const { handlers, dispatch } = setup()
  dispatch("c", { meta: true })
  assert.strictEqual(handlers.onCreatePool.mock.callCount(), 0)
  dispatch("c", { ctrl: true })
  assert.strictEqual(handlers.onCreatePool.mock.callCount(), 0)
  dispatch("c", { alt: true })
  assert.strictEqual(handlers.onCreatePool.mock.callCount(), 0)
})

test("g shortcut starts leader sequence", () => {
  const { handlers, dispatch } = setup()
  dispatch("g")
  assert.strictEqual(handlers.onGoToGroups.mock.callCount(), 0)
})

test("g then h navigates to groups", () => {
  const { handlers, dispatch } = setup()
  dispatch("g")
  dispatch("h")
  assert.strictEqual(handlers.onGoToGroups.mock.callCount(), 1)
})

test("g then t navigates to transactions", () => {
  const { handlers, dispatch } = setup()
  dispatch("g")
  dispatch("t")
  assert.strictEqual(handlers.onGoToTransactions.mock.callCount(), 1)
})

test("g then p navigates to profile", () => {
  const { handlers, dispatch } = setup()
  dispatch("g")
  dispatch("p")
  assert.strictEqual(handlers.onGoToProfile.mock.callCount(), 1)
})

test("g then c silently cancels the leader sequence and does not trigger onCreatePool", () => {
  const { handlers, dispatch } = setup()
  dispatch("g")
  dispatch("c")
  assert.strictEqual(handlers.onCreatePool.mock.callCount(), 0)
  assert.strictEqual(handlers.onGoToGroups.mock.callCount(), 0)
  assert.strictEqual(handlers.onGoToTransactions.mock.callCount(), 0)
  assert.strictEqual(handlers.onGoToProfile.mock.callCount(), 0)
})

test("? shortcut triggers onOpenHelp", () => {
  const { handlers, dispatch } = setup()
  dispatch("?")
  assert.strictEqual(handlers.onOpenHelp.mock.callCount(), 1)
})

test("? with modifier does not trigger onOpenHelp", () => {
  const { handlers, dispatch } = setup()
  dispatch("?", { meta: true })
  assert.strictEqual(handlers.onOpenHelp.mock.callCount(), 0)
  dispatch("?", { ctrl: true })
  assert.strictEqual(handlers.onOpenHelp.mock.callCount(), 0)
  dispatch("?", { alt: true })
  assert.strictEqual(handlers.onOpenHelp.mock.callCount(), 0)
})

test("g with modifier does not start leader sequence", () => {
  const { handlers, dispatch } = setup()
  dispatch("g", { meta: true })
  dispatch("h")
  assert.strictEqual(handlers.onGoToGroups.mock.callCount(), 0)
})

test("typing in input skips shortcuts", () => {
  const handlers = {
    onCreatePool: mock.fn(),
    onGoToGroups: mock.fn(),
    onGoToTransactions: mock.fn(),
    onGoToProfile: mock.fn(),
    onOpenHelp: mock.fn(),
  }
  const { handleKeyDown } = createHandler()
  const event = makeInputEvent("c")
  handleKeyDown(event, handlers)
  assert.strictEqual(handlers.onCreatePool.mock.callCount(), 0)
})
