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
 *   pnpm build && OPENAI_API_KEY=<your-key> node demo/server.mjs
 */

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { nanoid } from 'nanoid'
import sharp from 'sharp'
import { generateImageBuffer as defaultGenerateImageBuffer } from '../dist/server.js'
import {
  detectImageMimeType,
  MAX_PROMPT_TEXT_BYTES,
  MAX_REFERENCE_DIMENSION,
  MAX_REFERENCE_FILE_BYTES,
  MAX_REFERENCE_IMAGES,
  MAX_REFERENCE_PIXELS,
  MAX_REFERENCE_TOTAL_BYTES,
  MAX_STRUCTURED_PROMPT_PARTS,
} from './media-prompt.js'

const __dir = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dir, '..')
const PORT = parseInt(process.env.PORT || '3000', 10)
const DEFAULT_IMAGES_DIR = path.join(root, 'images')
/** Maximum JSON request size, including up to 10 MiB of base64 image data. */
export const MAX_REQUEST_BODY_BYTES = 14 * 1024 * 1024
/** Bound bodies retained by concurrent generation requests in this demo server. */
export const MAX_CONCURRENT_IMAGE_REQUESTS = 4
const MAX_CACHE_LOOKUP_BODY_BYTES = 1024
const MAX_CONCURRENT_CACHE_LOOKUPS = 4

function createAdmission(limit) {
  let active = 0
  return {
    tryAcquire() {
      if (active >= limit) return false
      active += 1
      return true
    },
    release() {
      active -= 1
    },
  }
}

function json(res, status, payload) {
  if (res.destroyed || res.writableEnded) return
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(payload))
}

function readBody(req, limit = MAX_REQUEST_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const declaredLength = Number(req.headers['content-length'] || 0)
    if (declaredLength > limit) {
      // Keep an error listener while draining: a peer can reset the stream after
      // we reject, and an unhandled IncomingMessage error would crash Node.
      req.once('error', () => undefined)
      req.resume()
      return reject(
        Object.assign(new Error('request body too large'), { status: 413 }),
      )
    }

    const chunks = []
    let size = 0
    const onData = (chunk) => {
      size += chunk.length
      if (size <= limit) {
        chunks.push(chunk)
        return
      }
      req.off('data', onData)
      req.off('end', onEnd)
      req.resume()
      reject(
        Object.assign(new Error('request body too large'), { status: 413 }),
      )
    }
    const onEnd = () => {
      req.off('error', onError)
      resolve(Buffer.concat(chunks).toString('utf8'))
    }
    const onError = (error) => reject(error)
    req.on('data', onData)
    req.on('end', onEnd)
    req.once('error', onError)
  })
}

function decodeBase64(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length % 4 !== 0
  ) {
    throw new TypeError('Reference image data must be valid base64.')
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value) {
    throw new TypeError('Reference image data must be valid base64.')
  }
  return bytes
}

const MAX_CONCURRENT_IMAGE_DECODES = 2
let activeImageDecodes = 0
const imageDecodeQueue = []

class ImageDimensionsError extends RangeError {}

function acquireImageDecode(signal) {
  signal.throwIfAborted()
  if (activeImageDecodes < MAX_CONCURRENT_IMAGE_DECODES) {
    activeImageDecodes += 1
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    const entry = { resolve, reject, signal, onAbort: undefined }
    entry.onAbort = () => {
      const index = imageDecodeQueue.indexOf(entry)
      if (index >= 0) imageDecodeQueue.splice(index, 1)
      reject(signal.reason)
    }
    signal.addEventListener('abort', entry.onAbort, { once: true })
    imageDecodeQueue.push(entry)
  })
}

function releaseImageDecode() {
  while (imageDecodeQueue.length > 0) {
    const entry = imageDecodeQueue.shift()
    entry.signal.removeEventListener('abort', entry.onAbort)
    if (entry.signal.aborted) {
      entry.reject(entry.signal.reason)
      continue
    }
    entry.resolve()
    return
  }
  activeImageDecodes -= 1
}

async function assertDecodableImage(bytes, signal) {
  await acquireImageDecode(signal)
  try {
    signal.throwIfAborted()
    const image = sharp(bytes, {
      failOn: 'warning',
      limitInputPixels: MAX_REFERENCE_PIXELS,
    })
    const { width, height } = await image.metadata()
    if (
      !width ||
      !height ||
      width > MAX_REFERENCE_DIMENSION ||
      height > MAX_REFERENCE_DIMENSION ||
      width * height > MAX_REFERENCE_PIXELS
    ) {
      throw new ImageDimensionsError(
        `Reference image dimensions must not exceed ${MAX_REFERENCE_DIMENSION} px per side or ${MAX_REFERENCE_PIXELS} total pixels.`,
      )
    }
    signal.throwIfAborted()
    await image.stats()
    signal.throwIfAborted()
  } catch (error) {
    if (signal.aborted) throw signal.reason
    if (error instanceof ImageDimensionsError) throw error
    throw new TypeError(
      'Reference image does not contain a valid PNG, JPEG, or WebP image.',
    )
  } finally {
    releaseImageDecode()
  }
}

async function validatePrompt(prompt, signal) {
  signal.throwIfAborted()
  if (typeof prompt === 'string') {
    if (!prompt.trim()) throw new TypeError('Prompt must not be empty.')
    if (Buffer.byteLength(prompt) > MAX_PROMPT_TEXT_BYTES) {
      throw new RangeError('Prompt text must be 16 KiB or smaller.')
    }
    return
  }
  if (!Array.isArray(prompt) || prompt.length === 0) {
    throw new TypeError('Prompt must be text or a non-empty structured prompt.')
  }
  if (prompt.length > MAX_STRUCTURED_PROMPT_PARTS) {
    throw new RangeError(
      `Structured prompts support at most ${MAX_STRUCTURED_PROMPT_PARTS} parts.`,
    )
  }

  let imageCount = 0
  let totalImageBytes = 0
  let totalTextBytes = 0
  let hasNonEmptyText = false
  for (const part of prompt) {
    signal.throwIfAborted()
    if (!part || typeof part !== 'object') {
      throw new TypeError('Structured prompt parts must be objects.')
    }
    if (part.type === 'text') {
      if (typeof part.content !== 'string') {
        throw new TypeError('Structured text prompt content must be a string.')
      }
      hasNonEmptyText ||= Boolean(part.content.trim())
      totalTextBytes += Buffer.byteLength(part.content)
      if (totalTextBytes > MAX_PROMPT_TEXT_BYTES) {
        throw new RangeError('Prompt text must be 16 KiB or smaller.')
      }
      continue
    }
    if (part.type !== 'image' || !part.source || part.source.type !== 'data') {
      throw new TypeError(
        'Structured prompts may contain only text and data images.',
      )
    }

    imageCount += 1
    if (imageCount > MAX_REFERENCE_IMAGES) {
      throw new RangeError(
        `Structured prompts support at most ${MAX_REFERENCE_IMAGES} images.`,
      )
    }
    if (
      !['image/png', 'image/jpeg', 'image/webp'].includes(part.source.mimeType)
    ) {
      throw new TypeError(
        'Reference image MIME type must be PNG, JPEG, or WebP.',
      )
    }
    if (
      typeof part.source.value !== 'string' ||
      part.source.value.length >
        Math.ceil((MAX_REFERENCE_FILE_BYTES * 4) / 3) + 4
    ) {
      throw new RangeError('Each reference image must be 5 MiB or smaller.')
    }
    const bytes = decodeBase64(part.source.value)
    if (bytes.byteLength > MAX_REFERENCE_FILE_BYTES) {
      throw new RangeError('Each reference image must be 5 MiB or smaller.')
    }
    totalImageBytes += bytes.byteLength
    if (totalImageBytes > MAX_REFERENCE_TOTAL_BYTES) {
      throw new RangeError('Reference images must total 10 MiB or less.')
    }
    const detectedType = detectImageMimeType(bytes)
    if (!detectedType) {
      throw new TypeError(
        'Reference image does not contain a valid PNG, JPEG, or WebP image.',
      )
    }
    if (detectedType !== part.source.mimeType) {
      throw new TypeError('Reference image bytes do not match its MIME type.')
    }
    await assertDecodableImage(bytes, signal)
  }

  if (!hasNonEmptyText) {
    throw new TypeError('Prompt must include non-empty text.')
  }
}

function imagePath(imagesDir, id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{21}$/.test(id)) return null
  return path.join(imagesDir, `${id}.png`)
}

async function serveCacheHitAtCapacity(imagesDir, req, res) {
  const declaredLength = Number(req.headers['content-length'])
  if (
    !Number.isSafeInteger(declaredLength) ||
    declaredLength <= 0 ||
    declaredLength > MAX_CACHE_LOOKUP_BODY_BYTES
  ) {
    req.resume()
    return json(res, 503, { error: 'image generation capacity reached' })
  }

  try {
    const body = JSON.parse(await readBody(req, MAX_CACHE_LOOKUP_BODY_BYTES))
    if (
      body &&
      typeof body === 'object' &&
      !Array.isArray(body) &&
      body.imageId
    ) {
      const cachedPath = imagePath(imagesDir, body.imageId)
      if (cachedPath && fs.existsSync(cachedPath)) {
        return json(res, 200, {
          id: body.imageId,
          url: `/images/${body.imageId}.png`,
        })
      }
    }
  } catch {
    // A malformed or oversized request cannot be a safe cache lookup.
  }
  return json(res, 503, { error: 'image generation capacity reached' })
}

async function handleRequest(
  imagesDir,
  generateImageBuffer,
  imageRequestAdmission,
  cacheLookupAdmission,
  req,
  res,
) {
  const controller = new AbortController()
  const abort = () => {
    if (!controller.signal.aborted)
      controller.abort(new Error('client disconnected'))
  }
  req.once('aborted', abort)
  req.once('close', () => {
    if (!req.complete) abort()
  })
  res.once('close', () => {
    if (!res.writableFinished) abort()
  })
  const { signal } = controller
  const url = new URL(req.url, `http://localhost:${PORT}`)

  if (req.method === 'POST' && url.pathname === '/api/img') {
    if (!imageRequestAdmission.tryAcquire()) {
      if (!cacheLookupAdmission.tryAcquire()) {
        req.resume()
        return json(res, 503, { error: 'image generation capacity reached' })
      }
      try {
        return await serveCacheHitAtCapacity(imagesDir, req, res)
      } finally {
        cacheLookupAdmission.release()
      }
    }
    try {
      let body
      try {
        body = JSON.parse((await readBody(req)) || '{}')
      } catch (error) {
        if (error?.status === 413) {
          return json(res, 413, { error: 'request body too large' })
        }
        return json(res, 400, { error: 'invalid JSON' })
      }

      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return json(res, 400, { error: 'request body must be a JSON object' })
      }

      const { prompt, imageId, width, height, llm, ratio } = body

      if (imageId) {
        const p = imagePath(imagesDir, imageId)
        if (p && fs.existsSync(p)) {
          return json(res, 200, { id: imageId, url: `/images/${imageId}.png` })
        }
      }

      if (!prompt) return json(res, 404, { error: 'not found' })

      if (signal.aborted) return
      try {
        await validatePrompt(prompt, signal)
        signal.throwIfAborted()
      } catch (error) {
        if (signal.aborted) return
        return json(res, 400, {
          error: error instanceof Error ? error.message : 'invalid prompt',
        })
      }

      try {
        const { buffer, mimeType } = await generateImageBuffer(
          prompt,
          width ?? 0,
          height ?? 0,
          {
            provider: llm,
            aspectRatio: ratio,
            signal,
          },
        )
        if (signal.aborted) return
        const id = nanoid()
        const ext = mimeType === 'image/jpeg' ? 'jpg' : 'png'
        fs.writeFileSync(path.join(imagesDir, `${id}.${ext}`), buffer)
        return json(res, 200, { id, url: `/images/${id}.${ext}` })
      } catch (err) {
        if (signal.aborted) return
        return json(res, 502, {
          error: err instanceof Error ? err.message : 'generation failed',
        })
      }
    } finally {
      imageRequestAdmission.release()
    }
  }

  if (req.method === 'GET' && url.pathname.startsWith('/images/')) {
    const id = path.basename(url.pathname).replace(/\.[^.]+$/, '')
    const p = imagePath(imagesDir, id)
    if (!p) {
      res.writeHead(400)
      return res.end('Bad id')
    }
    const ext = path.extname(url.pathname).slice(1) || 'png'
    const mime = ext === 'jpg' ? 'image/jpeg' : 'image/png'
    try {
      const data = fs.readFileSync(p.replace('.png', `.${ext}`))
      res.writeHead(200, { 'Content-Type': mime })
      return res.end(data)
    } catch {
      res.writeHead(404)
      return res.end('Not found')
    }
  }

  if (req.method === 'GET' && url.pathname.startsWith('/dist/')) {
    try {
      const data = fs.readFileSync(path.join(root, url.pathname))
      res.writeHead(200, { 'Content-Type': 'application/javascript' })
      return res.end(data)
    } catch {
      res.writeHead(404)
      return res.end('Not found')
    }
  }

  if (req.method === 'GET' && url.pathname === '/demo/media-prompt.js') {
    try {
      const data = fs.readFileSync(path.join(__dir, 'media-prompt.js'))
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
      })
      return res.end(data)
    } catch {
      res.writeHead(404)
      return res.end('Not found')
    }
  }

  if (
    req.method === 'GET' &&
    (url.pathname === '/' || url.pathname === '/index.html')
  ) {
    try {
      const data = fs.readFileSync(path.join(__dir, 'index.html'))
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end(data)
    } catch {
      res.writeHead(404)
      return res.end('Not found')
    }
  }

  res.writeHead(404)
  res.end('Not found')
}

export function createDemoServer({
  imagesDir = DEFAULT_IMAGES_DIR,
  generateImage = defaultGenerateImageBuffer,
  generateImageBuffer = generateImage,
} = {}) {
  fs.mkdirSync(imagesDir, { recursive: true })
  const imageRequestAdmission = createAdmission(MAX_CONCURRENT_IMAGE_REQUESTS)
  const cacheLookupAdmission = createAdmission(MAX_CONCURRENT_CACHE_LOOKUPS)
  return http.createServer((req, res) =>
    handleRequest(
      imagesDir,
      generateImageBuffer,
      imageRequestAdmission,
      cacheLookupAdmission,
      req,
      res,
    ),
  )
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const server = createDemoServer()
  server.listen(PORT, () => {
    console.log(`\n  wc-img-ai demo`)
    console.log(
      `  OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? 'set' : '⚠ not set'}`,
    )
    console.log(`  images → ${DEFAULT_IMAGES_DIR}`)
    console.log(`  → http://localhost:${PORT}\n`)
  })
}
