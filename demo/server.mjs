#!/usr/bin/env node
/**
 * Reference demo server for wc-img-ai.
 *
 * Demonstrates the "smart endpoint" contract the <ai-img> component talks to:
 * a single POST decides whether to return an already-stored image (looked up
 * by `imageId`) or generate a new one with OpenAI gpt-image-2. The real API key
 * never leaves the server. Generated images are minted a nanoid, written to
 * disk under images/<id>.png, and served back as a stable URL.
 *
 *   Contract
 *   --------
 *   POST /api/img { prompt, imageId?, width, height }
 *     imageId given & on disk          -> 200 {id,url}   (no AI call)
 *     imageId given, missing, + prompt -> generate        -> 200 {id,url}
 *     no imageId, + prompt             -> generate        -> 200 {id,url}
 *     otherwise                        -> 404
 *   GET /images/<id>.png  -> the stored bytes
 *
 * Usage:
 *   cp .env.example .env   # add OPENAI_API_KEY
 *   pnpm build && pnpm demo
 *   # or: PORT=4000 node demo/server.mjs
 */

import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { nanoid } from "nanoid"

const __dir = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dir, "..")
const IMAGES_DIR = path.join(root, "images")
fs.mkdirSync(IMAGES_DIR, { recursive: true })

// --- minimal .env loader (no dotenv dependency) ---
function loadEnv(envPath) {
  try {
    const env = {}
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const eq = trimmed.indexOf("=")
      if (eq < 0) continue
      const key = trimmed.slice(0, eq).trim()
      let val = trimmed.slice(eq + 1).trim()
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      env[key] = val
    }
    return env
  } catch {
    return {}
  }
}

const env = loadEnv(path.join(root, ".env"))
const OPENAI_KEY = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY || ""
const OPENAI_MODEL = env.OPENAI_IMAGE_MODEL || "gpt-image-2"
const PORT = parseInt(process.env.PORT || "3000", 10)
// gpt-image-2 accepts arbitrary pixel sizes up to a 3:1 aspect ratio, so the
// image is composed for the exact requested canvas — no cropping needed.
const MAX_NATIVE_RATIO = 3

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
}
const mime = (ext) => MIME[ext] || "application/octet-stream"

// Exact size when the ratio is natively supported; otherwise the nearest
// legacy fixed size (the caller's box then scales/crops the result).
function requestSize(width, height) {
  const w = Number(width) || 1024
  const h = Number(height) || 1024
  const ratio = w / h
  if (ratio <= MAX_NATIVE_RATIO && ratio >= 1 / MAX_NATIVE_RATIO) {
    return `${w}x${h}`
  }
  if (w > h * 1.2) return "1536x1024"
  if (h > w * 1.2) return "1024x1536"
  return "1024x1024"
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ""
    req.on("data", (chunk) => (data += chunk))
    req.on("end", () => resolve(data))
    req.on("error", reject)
  })
}

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" })
  res.end(JSON.stringify(payload))
}

function imagePath(id) {
  // ids are nanoid (url-safe alphabet) — reject anything else as a path guard
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return null
  return path.join(IMAGES_DIR, `${id}.png`)
}

async function generate(prompt, width, height) {
  if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY is not set in .env")

  const resp = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      prompt,
      n: 1,
      size: requestSize(width, height),
    }),
    signal: AbortSignal.timeout(120_000),
  })

  if (!resp.ok) {
    const detail = await resp.text()
    throw new Error(`OpenAI ${resp.status}: ${detail.slice(0, 300)}`)
  }

  const data = await resp.json()
  const b64 = data?.data?.[0]?.b64_json
  if (!b64) throw new Error("OpenAI returned no image data")

  const id = nanoid()
  fs.writeFileSync(imagePath(id), Buffer.from(b64, "base64"))
  return id
}

async function handleImagePost(req, res) {
  let body
  try {
    body = JSON.parse((await readBody(req)) || "{}")
  } catch {
    return json(res, 400, { error: "invalid JSON" })
  }

  const { prompt, imageId, width, height } = body

  // 1. Known id already stored -> return it, no AI.
  if (imageId) {
    const p = imagePath(imageId)
    if (p && fs.existsSync(p)) {
      return json(res, 200, { id: imageId, url: `/images/${imageId}.png` })
    }
  }

  // 2. A prompt is present -> generate (covers both "no id" and "stale id").
  if (prompt) {
    try {
      const id = await generate(prompt, width, height)
      return json(res, 200, { id, url: `/images/${id}.png` })
    } catch (err) {
      return json(res, 502, { error: err instanceof Error ? err.message : "generation failed" })
    }
  }

  // 3. Nothing to look up and nothing to generate.
  return json(res, 404, { error: "not found" })
}

function serveStatic(res, filePath) {
  try {
    const data = fs.readFileSync(filePath)
    res.writeHead(200, { "Content-Type": mime(path.extname(filePath)) })
    res.end(data)
  } catch {
    res.writeHead(404)
    res.end("Not found")
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const pathname = url.pathname

  if (req.method === "POST" && pathname === "/api/img") {
    return handleImagePost(req, res)
  }

  if (req.method === "GET" && pathname.startsWith("/images/")) {
    const id = path.basename(pathname, ".png")
    const p = imagePath(id)
    if (!p) {
      res.writeHead(400)
      return res.end("Bad id")
    }
    return serveStatic(res, p)
  }

  if (req.method === "GET" && pathname.startsWith("/dist/")) {
    return serveStatic(res, path.join(root, pathname))
  }

  if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
    return serveStatic(res, path.join(__dir, "index.html"))
  }

  res.writeHead(404)
  res.end("Not found")
})

server.listen(PORT, () => {
  const keyStatus = OPENAI_KEY
    ? `✓ OPENAI_API_KEY loaded (${OPENAI_KEY.slice(0, 8)}…)`
    : "⚠  OPENAI_API_KEY not set — add it to .env"
  console.log(`\n  wc-img-ai demo`)
  console.log(`  ${keyStatus}`)
  console.log(`  images → ${IMAGES_DIR}`)
  console.log(`  → http://localhost:${PORT}\n`)
})
