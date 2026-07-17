import fs from 'node:fs/promises'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createMediaPrompt,
  MAX_PROMPT_TEXT_BYTES,
  MAX_REFERENCE_DIMENSION,
  MAX_REFERENCE_FILE_BYTES,
  MAX_STRUCTURED_PROMPT_PARTS,
} from '../demo/media-prompt.js'
import { createDemoServer } from '../demo/server.mjs'
import { MOCK_IMAGE_BYTES, providerRequests } from './mocks/handlers'

const UPLOADED_REFERENCE_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWP4z8DwH4QBEfcD/RSF9bkAAAAASUVORK5CYII=',
  'base64',
)
const SECOND_UPLOADED_REFERENCE_BYTES = Buffer.from(
  'UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoBAAEAAUAmJaACdLoB+AADsAD+8ut//NgVzXPv9//S4P0uD9Lg/9KQAAA=',
  'base64',
)

const cleanupDirectories: Array<string> = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(
    cleanupDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  )
})

async function startDemo(options = {}) {
  const imagesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wc-img-ai-e2e-'))
  cleanupDirectories.push(imagesDir)
  const server = createDemoServer({ imagesDir, ...options })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    imagesDir,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

async function generate(
  baseUrl: string,
  llm: 'openai' | 'gemini',
  prompt: unknown = `MSW end-to-end ${llm} image`,
) {
  const response = await fetch(`${baseUrl}/api/img`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt,
      width: 1024,
      height: 1024,
      llm,
      ratio: '1:1',
    }),
  })
  expect(response.status).toBe(200)
  const body = (await response.json()) as { id: string; url: string }
  const image = await fetch(`${baseUrl}${body.url}`)
  expect(image.status).toBe(200)
  expect(Buffer.from(await image.arrayBuffer())).toEqual(MOCK_IMAGE_BYTES)
  return body
}

describe('demo provider flow with MSW', () => {
  it('keeps mock mode opt-in while documenting both provider keys', async () => {
    const example = await fs.readFile(
      path.resolve(import.meta.dirname, '../.env.example'),
      'utf8',
    )
    expect(example).not.toMatch(/^MSW=true$/m)
    expect(example).toContain('# MSW=true')
    expect(example).toContain('OPENAI_API_KEY=')
    expect(example).toContain('GEMINI_API_KEY=')
  })

  it('uses one MSW switch in Node and Vite browser contexts', () => {
    expect(process.env.MSW).toBe('true')
    expect(import.meta.env.MSW).toBe('true')
  })

  it('blocks unmatched external requests instead of reaching the network', async () => {
    expect(process.env.MSW).toBe('true')
    const response = await fetch(
      'https://api.openai.com/v1/unhandled-provider-route',
    )
    expect(response.status).toBe(500)
    expect(response.statusText).toBe('Unhandled Exception')
  })

  it('serves the reference-image picker and browser prompt helper', async () => {
    const demo = await startDemo()
    try {
      const page = await fetch(demo.baseUrl)
      expect(page.status).toBe(200)
      const html = await page.text()
      expect(html).toContain('id="references"')
      expect(html).toContain('accept="image/png,image/jpeg,image/webp"')
      expect(html).toContain('for="prompt"')
      expect(html).toContain('role="status"')
      expect(html).toContain('aria-live="polite"')

      const helper = await fetch(`${demo.baseUrl}/demo/media-prompt.js`)
      expect(helper.status).toBe(200)
      expect(helper.headers.get('content-type')).toContain(
        'application/javascript',
      )
      expect(await helper.text()).toContain('export const createMediaPrompt')
    } finally {
      await demo.close()
    }
  })

  it.each([
    'openai',
    'gemini',
  ] as const)('preserves text-only, one-image, and two-image behavior for %s', async (provider) => {
    expect(process.env.MSW).toBe('true')
    vi.stubEnv('OPENAI_API_KEY', 'test-only-key')
    vi.stubEnv('GEMINI_API_KEY', 'test-only-key')

    const demo = await startDemo()
    try {
      const firstReference = new File(
        [UPLOADED_REFERENCE_BYTES],
        'browser-upload.png',
        { type: 'image/png' },
      )
      const secondReference = new File(
        [SECOND_UPLOADED_REFERENCE_BYTES],
        'browser-upload.webp',
        { type: 'image/webp' },
      )
      const textOnly = await generate(demo.baseUrl, provider)
      const oneImage = await generate(
        demo.baseUrl,
        provider,
        await createMediaPrompt('Restyle this mock reference.', [
          firstReference,
        ]),
      )
      const twoImages = await generate(
        demo.baseUrl,
        provider,
        await createMediaPrompt(
          'Use image 1 for structure and image 2 for color.',
          [firstReference, secondReference],
        ),
      )

      for (const result of [textOnly, oneImage, twoImages]) {
        expect(result.url).toMatch(/^\/images\/[A-Za-z0-9_-]+\.png$/)
      }
      expect(providerRequests).toHaveLength(3)

      if (provider === 'openai') {
        expect(providerRequests).toEqual([
          {
            provider: 'openai',
            endpoint: '/v1/images/generations',
            body: {
              model: 'gpt-image-2',
              prompt: 'MSW end-to-end openai image',
              n: 1,
              size: '1024x1024',
            },
          },
          {
            provider: 'openai',
            endpoint: '/v1/images/edits',
            body: {
              fields: {
                model: 'gpt-image-2',
                prompt: 'Restyle this mock reference.',
                n: '1',
                size: '1024x1024',
              },
              files: [
                {
                  field: 'image[]',
                  name: 'reference-image-1.png',
                  size: UPLOADED_REFERENCE_BYTES.byteLength,
                  type: 'image/png',
                  base64: UPLOADED_REFERENCE_BYTES.toString('base64'),
                },
              ],
            },
          },
          {
            provider: 'openai',
            endpoint: '/v1/images/edits',
            body: {
              fields: {
                model: 'gpt-image-2',
                prompt: 'Use image 1 for structure and image 2 for color.',
                n: '1',
                size: '1024x1024',
              },
              files: [
                {
                  field: 'image[]',
                  name: 'reference-image-1.png',
                  size: UPLOADED_REFERENCE_BYTES.byteLength,
                  type: 'image/png',
                  base64: UPLOADED_REFERENCE_BYTES.toString('base64'),
                },
                {
                  field: 'image[]',
                  name: 'reference-image-2.webp',
                  size: SECOND_UPLOADED_REFERENCE_BYTES.byteLength,
                  type: 'image/webp',
                  base64: SECOND_UPLOADED_REFERENCE_BYTES.toString('base64'),
                },
              ],
            },
          },
        ])
        return
      }

      const generationConfig = {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio: '1:1', imageSize: '1K' },
      }
      expect(providerRequests).toEqual([
        {
          provider: 'gemini',
          endpoint: '/v1beta/models/gemini-3.1-flash-image:generateContent',
          body: {
            contents: [{ parts: [{ text: 'MSW end-to-end gemini image' }] }],
            generationConfig,
          },
        },
        {
          provider: 'gemini',
          endpoint: '/v1beta/models/gemini-3.1-flash-image:generateContent',
          body: {
            contents: [
              {
                parts: [
                  { text: 'Restyle this mock reference.' },
                  {
                    inlineData: {
                      data: UPLOADED_REFERENCE_BYTES.toString('base64'),
                      mimeType: 'image/png',
                    },
                  },
                ],
              },
            ],
            generationConfig,
          },
        },
        {
          provider: 'gemini',
          endpoint: '/v1beta/models/gemini-3.1-flash-image:generateContent',
          body: {
            contents: [
              {
                parts: [
                  {
                    text: 'Use image 1 for structure and image 2 for color.',
                  },
                  {
                    inlineData: {
                      data: UPLOADED_REFERENCE_BYTES.toString('base64'),
                      mimeType: 'image/png',
                    },
                  },
                  {
                    inlineData: {
                      data: SECOND_UPLOADED_REFERENCE_BYTES.toString('base64'),
                      mimeType: 'image/webp',
                    },
                  },
                ],
              },
            ],
            generationConfig,
          },
        },
      ])
    } finally {
      await demo.close()
    }
  })

  it('rejects malformed and oversized structured image prompts before a provider request', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-only-key')
    const demo = await startDemo()
    try {
      const response = await fetch(`${demo.baseUrl}/api/img`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: [
            { type: 'text', content: 'malformed upload' },
            {
              type: 'image',
              source: {
                type: 'data',
                value: Buffer.from('not an image').toString('base64'),
                mimeType: 'image/png',
              },
            },
          ],
          width: 1024,
          height: 1024,
          llm: 'openai',
        }),
      })

      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({
        error: expect.stringContaining('valid PNG, JPEG, or WebP'),
      })

      const oversizedImage = Buffer.alloc(MAX_REFERENCE_FILE_BYTES + 1)
      MOCK_IMAGE_BYTES.copy(oversizedImage)
      const oversizedResponse = await fetch(`${demo.baseUrl}/api/img`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: [
            {
              type: 'image',
              source: {
                type: 'data',
                value: oversizedImage.toString('base64'),
                mimeType: 'image/png',
              },
            },
          ],
          width: 1024,
          height: 1024,
          llm: 'openai',
        }),
      })
      expect(oversizedResponse.status).toBe(400)
      expect(await oversizedResponse.json()).toMatchObject({
        error: expect.stringContaining('5 MiB'),
      })
      expect(providerRequests).toHaveLength(0)
    } finally {
      await demo.close()
    }
  })

  it('rejects empty, excessive, and oversized structured text before a provider request', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-only-key')
    const demo = await startDemo()
    try {
      const prompts = [
        [{ type: 'text', content: '   ' }],
        Array.from({ length: MAX_STRUCTURED_PROMPT_PARTS + 1 }, () => ({
          type: 'text',
          content: 'part',
        })),
        [{ type: 'text', content: 'x'.repeat(MAX_PROMPT_TEXT_BYTES + 1) }],
      ]

      for (const prompt of prompts) {
        const response = await fetch(`${demo.baseUrl}/api/img`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt, llm: 'openai' }),
        })
        expect(response.status).toBe(400)
      }
      expect(providerRequests).toHaveLength(0)
    } finally {
      await demo.close()
    }
  })

  it('rejects truncated image payloads before a provider request', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-only-key')
    const demo = await startDemo()
    try {
      const payloads: Array<[string, Buffer]> = [
        ['image/png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])],
        ['image/jpeg', Buffer.from([255, 216, 255, 224])],
        [
          'image/webp',
          Buffer.from([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]),
        ],
      ]
      for (const [mimeType, bytes] of payloads) {
        const response = await fetch(`${demo.baseUrl}/api/img`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            prompt: [
              { type: 'text', content: 'Restyle it.' },
              {
                type: 'image',
                source: {
                  type: 'data',
                  value: bytes.toString('base64'),
                  mimeType,
                },
              },
            ],
            llm: 'openai',
          }),
        })
        expect(response.status).toBe(400)
      }
      expect(providerRequests).toHaveLength(0)
    } finally {
      await demo.close()
    }
  })

  it('rejects structurally plausible but undecodable images before a provider request', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-only-key')
    const demo = await startDemo()
    try {
      const malformedPng = Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        Buffer.from([0, 0, 0, 13]),
        Buffer.from('IHDR'),
        Buffer.alloc(13),
        Buffer.alloc(4),
        Buffer.alloc(4),
        Buffer.from('IDAT'),
        Buffer.alloc(4),
        Buffer.alloc(4),
        Buffer.from('IEND'),
        Buffer.alloc(4),
      ])
      const malformedWebp = Buffer.from([
        82, 73, 70, 70, 12, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 88, 0, 0, 0, 0,
      ])
      const malformedJpeg = Buffer.from([
        0xff, 0xd8, 0xff, 0xc0, 0, 8, 0, 0, 0, 0, 0, 0, 0xff, 0xda, 0xff, 0xd9,
      ])

      for (const [mimeType, bytes] of [
        ['image/png', malformedPng],
        ['image/webp', malformedWebp],
        ['image/jpeg', malformedJpeg],
      ] as const) {
        const response = await fetch(`${demo.baseUrl}/api/img`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            prompt: [
              { type: 'text', content: 'Restyle it.' },
              {
                type: 'image',
                source: {
                  type: 'data',
                  value: bytes.toString('base64'),
                  mimeType,
                },
              },
            ],
            llm: 'openai',
          }),
        })

        expect(response.status).toBe(400)
      }
      expect(providerRequests).toHaveLength(0)
    } finally {
      await demo.close()
    }
  })

  it('rejects reference images whose decoded dimensions exceed the browser limit', async () => {
    const tooWide = await sharp({
      create: {
        width: MAX_REFERENCE_DIMENSION + 1,
        height: 1,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      },
    })
      .png()
      .toBuffer()
    const generateImage = vi.fn()
    const demo = await startDemo({ generateImage })

    try {
      const response = await fetch(`${demo.baseUrl}/api/img`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: [
            { type: 'text', content: 'Restyle it.' },
            {
              type: 'image',
              source: {
                type: 'data',
                value: tooWide.toString('base64'),
                mimeType: 'image/png',
              },
            },
          ],
        }),
      })

      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({
        error: expect.stringContaining(`${MAX_REFERENCE_DIMENSION}`),
      })
      expect(generateImage).not.toHaveBeenCalled()
    } finally {
      await demo.close()
    }
  })

  it('bounds request-body reads', async () => {
    const demo = await startDemo()
    try {
      const response = await fetch(`${demo.baseUrl}/api/img`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'x'.repeat(14 * 1024 * 1024 + 1),
      })
      expect(response.status).toBe(413)

      const malformed = await fetch(`${demo.baseUrl}/api/img`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'null',
      })
      expect(malformed.status).toBe(400)
    } finally {
      await demo.close()
    }
  })

  it('aborts downstream generation when the client disconnects', async () => {
    let started!: () => void
    const generationStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    let downstreamSignal: AbortSignal | undefined
    const generateImage = vi.fn(
      (_prompt, _width, _height, options) =>
        new Promise<never>((_resolve, reject) => {
          downstreamSignal = options.signal
          started()
          options.signal.addEventListener(
            'abort',
            () => reject(options.signal.reason),
            { once: true },
          )
        }),
    )
    const demo = await startDemo({ generateImage })
    try {
      const request = http.request(`${demo.baseUrl}/api/img`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      })
      request.on('error', () => undefined)
      request.end(JSON.stringify({ prompt: 'cancel this generation' }))
      await generationStarted
      request.destroy()

      await vi.waitFor(() => expect(downstreamSignal?.aborted).toBe(true))
      expect(generateImage).toHaveBeenCalledOnce()
    } finally {
      await demo.close()
    }
  })

  it('rejects excess concurrent image requests before retaining their bodies', async () => {
    const generateImage = vi.fn(
      (_prompt, _width, _height, options) =>
        new Promise<never>((_resolve, reject) => {
          options.signal.addEventListener(
            'abort',
            () => reject(options.signal.reason),
            { once: true },
          )
        }),
    )
    const demo = await startDemo({ generateImage })
    const controllers = Array.from({ length: 4 }, () => new AbortController())

    try {
      const cachedImageId = 'AbCdEfGhIjKlMnOpQrStU'
      await fs.writeFile(
        path.join(demo.imagesDir, `${cachedImageId}.png`),
        MOCK_IMAGE_BYTES,
      )
      const activeRequests = controllers.map((controller, index) =>
        fetch(`${demo.baseUrl}/api/img`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt: `hold request ${index}` }),
          signal: controller.signal,
        }).catch(() => undefined),
      )
      await vi.waitFor(() => expect(generateImage).toHaveBeenCalledTimes(4))

      const cacheHit = await fetch(`${demo.baseUrl}/api/img`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ imageId: cachedImageId }),
      })
      expect(cacheHit.status).toBe(200)
      expect(await cacheHit.json()).toEqual({
        id: cachedImageId,
        url: `/images/${cachedImageId}.png`,
      })

      await fs.writeFile(
        path.join(demo.imagesDir, 'short-id.png'),
        MOCK_IMAGE_BYTES,
      )
      const invalidCacheLookups = ['../../package', 'short-id', 42]
      for (const imageId of invalidCacheLookups) {
        const invalidCacheLookup = await fetch(`${demo.baseUrl}/api/img`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ imageId }),
        })
        expect(invalidCacheLookup.status).toBe(503)
      }

      const response = await fetch(`${demo.baseUrl}/api/img`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'reject this request' }),
      })

      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({
        error: 'image generation capacity reached',
      })
      expect(generateImage).toHaveBeenCalledTimes(4)

      controllers.forEach((controller) => {
        controller.abort()
      })
      await Promise.all(activeRequests)
    } finally {
      controllers.forEach((controller) => {
        controller.abort()
      })
      await demo.close()
    }
  })
})
