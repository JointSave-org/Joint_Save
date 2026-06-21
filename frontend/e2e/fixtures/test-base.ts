import { test as base, expect } from "@playwright/test"

/**
 * Extended Playwright `test` that collects browser-side errors for every test.
 *
 * `consoleErrors` accumulates `console.error` output and uncaught page errors so
 * specs (notably navigation.spec) can assert the app runs clean. We deliberately
 * do NOT auto-fail — a spec opts in by asserting on the array — because some
 * third-party libs log benign warnings we filter explicitly.
 */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = []
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text())
    })
    page.on("pageerror", (err) => errors.push(err.message))
    await use(errors)
  },
})

export { expect }
export * from "./wallet"
export * from "./mock-pools"
export * from "./constants"
