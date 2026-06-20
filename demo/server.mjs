#!/usr/bin/env node
/**
 * Minimal demo server — uses wc-img-ai/server for generation.
 *
 * The endpoint contract <ai-img> expects:
 *   POST /api/img { prompt, imageId?, width, height, llm?, ratio? }
 *     imageId given & on disk  → 200 { id, url }  (no AI)
 *     prompt given             → generate → 200 { id, url }
 *     otherwise                → 404
 *   GET /images/<id>.png       → stored bytes
 *
 * Usage:
 *   pnpm build && OPENAI_API_KEY=sk-… node demo/server.mjs
 */

import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { nanoid } from "nanoid"
import { generateImageBuffer } from "../dist/server.js"

const __dir = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dir, "..")
const IMAGES_DIR = path.join(root, "images")
fs.mkdirSync(IMAGES_DIR, { recursive: true })

const PORT = parseInt(process.env.PORT || "3000", 10)

function imagePath(id) {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return null
  return path.join(IMAGES_DIR, `${id}.png`)
}

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" })
  res.end(JSON.stringify(payload))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ""
    req.on("data", (chunk) => (data += chunk))
    req.on("end", () => resolve(data))
    req.on("error", reject)
  })
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)

  if (req.method === "POST" && url.pathname === "/api/img") {
    let body
    try {
      body = JSON.parse((await readBody(req)) || "{}")
    } catch {
      return json(res, 400, { error: "invalid JSON" })
    }

    const { prompt, imageId, width, height, llm, ratio } = body

    if (imageId) {
      const p = imagePath(imageId)
      if (p && fs.existsSync(p)) {
        return json(res, 200, { id: imageId, url: `/images/${imageId}.png` })
      }
    }

    if (!prompt) return json(res, 404, { error: "not found" })

    try {
      const { buffer, mimeType } = await generateImageBuffer(prompt, width ?? 0, height ?? 0, {
        provider: llm,
        aspectRatio: ratio,
      })
      const id = nanoid()
      const ext = mimeType === "image/jpeg" ? "jpg" : "png"
      fs.writeFileSync(path.join(IMAGES_DIR, `${id}.${ext}`), buffer)
      return json(res, 200, { id, url: `/images/${id}.${ext}` })
    } catch (err) {
      return json(res, 502, { error: err instanceof Error ? err.message : "generation failed" })
    }
  }

  if (req.method === "GET" && url.pathname.startsWith("/images/")) {
    const id = path.basename(url.pathname).replace(/\.[^.]+$/, "")
    const p = imagePath(id)
    if (!p) { res.writeHead(400); return res.end("Bad id") }
    const ext = path.extname(url.pathname).slice(1) || "png"
    const mime = ext === "jpg" ? "image/jpeg" : "image/png"
    try {
      const data = fs.readFileSync(p.replace(".png", `.${ext}`))
      res.writeHead(200, { "Content-Type": mime })
      return res.end(data)
    } catch {
      res.writeHead(404); return res.end("Not found")
    }
  }

  if (req.method === "GET" && url.pathname.startsWith("/dist/")) {
    try {
      const data = fs.readFileSync(path.join(root, url.pathname))
      res.writeHead(200, { "Content-Type": "application/javascript" })
      return res.end(data)
    } catch { res.writeHead(404); return res.end("Not found") }
  }

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    try {
      const data = fs.readFileSync(path.join(__dir, "index.html"))
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      return res.end(data)
    } catch { res.writeHead(404); return res.end("Not found") }
  }

  res.writeHead(404)
  res.end("Not found")
})

server.listen(PORT, () => {
  console.log(`\n  wc-img-ai demo`)
  console.log(`  OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? "set" : "⚠ not set"}`)
  console.log(`  images → ${IMAGES_DIR}`)
  console.log(`  → http://localhost:${PORT}\n`)
})
