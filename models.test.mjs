// Run with HOME=$(mktemp -d) bun test: a plan's models when ZCode's config
// can't be had stand in from the plugin's table, said to be a fallback,
// so magpie keeps the list it was told last, as the built-in keeps the one
// it fetched last.
import { test, expect, beforeAll, afterAll } from "bun:test"
import { homedir, tmpdir } from "node:os"
import { existsSync, realpathSync } from "node:fs"

let ZCodeAuthPlugin
const fetched = globalThis.fetch
beforeAll(async () => {
  if (![tmpdir(), realpathSync(tmpdir())].some((t) => homedir().startsWith(t))) throw new Error("run with HOME=$(mktemp -d) bun test")
  ;({ ZCodeAuthPlugin } = await import("./index.mjs"))
})
afterAll(() => {
  globalThis.fetch = fetched
})

// an installed ZCode (macOS) has a config of its own, which is no fallback
const app = process.platform === "darwin" && existsSync("/Applications/ZCode.app/Contents/Resources/config/provider/zcode-builtin.json")

test("ZCode's config out of reach, the table stands in, said to be a fallback", async () => {
  globalThis.fetch = async () => {
    throw new Error("connection refused")
  }
  const hooks = await ZCodeAuthPlugin({ client: {} })
  const ms = await hooks.provider.models({ models: {} }, { auth: { type: "api", key: "k" } })
  expect(Object.keys(ms).length).toBeGreaterThan(0)
  expect(ms[Symbol.for("magpie.fellBack")]).toBe(app ? undefined : true)
  // OpenCode, reading the list, sees only the models
  expect(Object.keys(ms).every((k) => ms[k].id === k)).toBe(true)
})
