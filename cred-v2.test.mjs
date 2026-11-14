// ZCode 3.18's v2 credential envelope: a random 32-byte key in the OS
// credential store, "enc:v2:os:<sha256(key) fingerprint>:<iv>.<tag>.<data>".
// The plugin reads the store's keys through powershell's CredRead and
// matches the envelope's own fingerprint, so it never has to reproduce the
// app's path hashing. A caller may hand keys over directly (extraKeys).
import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import { homedir, tmpdir } from "node:os"
import { realpathSync } from "node:fs"
import { createCipheriv, createHash, randomBytes } from "node:crypto"

mock.module("./attest.mjs", () => ({ solveCaptcha: async () => ({ error: "off in this file" }) }))

if (![tmpdir(), realpathSync(tmpdir())].some((t) => homedir().startsWith(t))) throw new Error("run in HOME=$(mktemp -d) bun test")
const { _internal } = await import("./index.mjs")

const sealV2 = (key, text, flavor = "os") => {
  const iv = randomBytes(12)
  const c = createCipheriv("aes-256-gcm", key, iv)
  const data = Buffer.concat([c.update(text, "utf8"), c.final()])
  const fp = createHash("sha256").update(key).digest("hex").slice(0, 24)
  return `enc:v2:${flavor}:${fp}:${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${data.toString("base64url")}`
}

const v1Key = _internal.secret ? null : null
const keyA = randomBytes(32)
const keyB = randomBytes(32)
const candA = { fp: createHash("sha256").update(keyA).digest("hex").slice(0, 24), key: keyA }

test("a v2:os envelope opens with the key its fingerprint names", async () => {
  const env = sealV2(keyA, '{"user_id":"u1"}')
  const out = _internal.decrypt(null, env, [candA])
  expect(out).toBe('{"user_id":"u1"}')
})

test("a v2 envelope whose key is not held decrypts to null", async () => {
  const env = sealV2(keyB, "secret")
  // candA is held, keyB's is not: no match, null — never a wrong decrypt
  expect(_internal.decrypt(null, env, [candA])).toBeNull()
})

test("a v2:env envelope opens with the managed secret's key", async () => {
  const env = sealV2(keyB, "hello", "env")
  expect(_internal.decrypt(null, env, [{ fp: createHash("sha256").update(keyB).digest("hex").slice(0, 24), key: keyB }])).toBe("hello")
})

test("v1 envelopes open as they always did", async () => {
  const legacy = _internal.decrypt
  const key = randomBytes(32)
  const iv = randomBytes(12)
  const c = createCipheriv("aes-256-gcm", key, iv)
  const data = Buffer.concat([c.update("old secret", "utf8"), c.final()])
  const env = `enc:v1:${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${data.toString("base64url")}`
  expect(legacy(key, env)).toBe("old secret")
})

test("a malformed v2 envelope is null, never a throw", async () => {
  expect(_internal.decrypt(null, "enc:v2:os:onlyafp")).toBeNull()
  expect(_internal.decrypt(null, "enc:v2:os:")).toBeNull()
  expect(_internal.decrypt(null, "enc:v2:os:eba0373f843eb8487991ac79:not.base64!")).toBeNull()
})
