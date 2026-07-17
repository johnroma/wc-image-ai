import fs from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDemoServer } from '../demo/server.mjs'
import { MOCK_IMAGE_BYTES, providerRequests } from './mocks/handlers'

const cleanupDirectories: Array<string> = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(
    cleanupDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  )
})

async function startDemo() {
  const imagesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wc-img-ai-e2e-'))
  cleanupDirectories.push(imagesDir)
  const server = createDemoServer({ imagesDir })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}`,
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

  it('runs every provider route from the HTTP endpoint through stored image bytes', async () => {
    expect(process.env.MSW).toBe('true')
    vi.stubEnv('OPENAI_API_KEY', 'test-only-key')
    vi.stubEnv('GEMINI_API_KEY', 'test-only-key')

    const demo = await startDemo()
    try {
      const openai = await generate(demo.baseUrl, 'openai')
      const openaiEdit = await generate(demo.baseUrl, 'openai', [
        { type: 'text', content: 'Restyle this mock reference.' },
        {
          type: 'image',
          source: {
            type: 'data',
            value: MOCK_IMAGE_BYTES.toString('base64'),
            mimeType: 'image/png',
          },
        },
      ])
      const gemini = await generate(demo.baseUrl, 'gemini')

      expect(openai.url).toMatch(/^\/images\/[A-Za-z0-9_-]+\.png$/)
      expect(openaiEdit.url).toMatch(/^\/images\/[A-Za-z0-9_-]+\.png$/)
      expect(gemini.url).toMatch(/^\/images\/[A-Za-z0-9_-]+\.png$/)
      expect(providerRequests).toHaveLength(3)
      expect(providerRequests[0]).toMatchObject({
        provider: 'openai',
        endpoint: '/v1/images/generations',
        body: {
          model: 'gpt-image-2',
          prompt: 'MSW end-to-end openai image',
          n: 1,
          size: '1024x1024',
        },
      })
      expect(providerRequests[1]).toMatchObject({
        provider: 'openai',
        endpoint: '/v1/images/edits',
        body: {
          model: 'gpt-image-2',
          prompt: 'Restyle this mock reference.',
          n: '1',
          size: '1024x1024',
          'image[]': {
            name: 'reference-image-1.png',
            size: MOCK_IMAGE_BYTES.byteLength,
            type: 'image/png',
          },
        },
      })
      expect(providerRequests[2]).toMatchObject({
        provider: 'gemini',
        endpoint: '/v1beta/models/gemini-3.1-flash-image:generateContent',
        body: {
          contents: [{ parts: [{ text: 'MSW end-to-end gemini image' }] }],
          generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
            imageConfig: { aspectRatio: '1:1', imageSize: '1K' },
          },
        },
      })
    } finally {
      await demo.close()
    }
  })
})
