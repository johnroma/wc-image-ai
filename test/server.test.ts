import type { MediaPromptPart } from '@tanstack/ai'
import { HttpResponse, http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateImageBuffer } from '../src/server.js'
import { MOCK_IMAGE_BYTES, providerRequests } from './mocks/handlers'
import { providerMockServer } from './mocks/server'

const OPENAI_GENERATIONS_URL = 'https://api.openai.com/v1/images/generations'
const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/:model\\:generateContent'

const imagePart = (
  value: string,
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' = 'image/png',
) => ({
  type: 'image' as const,
  source: {
    type: 'data' as const,
    value: Buffer.from(value).toString('base64'),
    mimeType,
  },
})

describe('generateImageBuffer with mocked provider uploads', () => {
  beforeEach(() => {
    vi.stubEnv('OPENAI_API_KEY', 'test-only-openai-key')
    vi.stubEnv('GEMINI_API_KEY', 'test-only-gemini-key')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('OpenAI', () => {
    it('mocks a text-only generation without making a live request', async () => {
      const result = await generateImageBuffer(
        'draw a tiny rocket',
        1024,
        1024,
        {
          provider: 'openai',
        },
      )

      expect(result).toEqual({
        buffer: MOCK_IMAGE_BYTES,
        mimeType: 'image/png',
        width: 1024,
        height: 1024,
      })
      expect(providerRequests).toEqual([
        {
          provider: 'openai',
          endpoint: '/v1/images/generations',
          body: {
            model: 'gpt-image-2',
            prompt: 'draw a tiny rocket',
            n: 1,
            size: '1024x1024',
          },
        },
      ])
    })

    it('mocks the complete multipart upload for a reference-image edit', async () => {
      const result = await generateImageBuffer(
        [
          { type: 'text', content: 'turn image 1 into a blueprint' },
          imagePart('reference'),
        ],
        1024,
        1024,
        { provider: 'openai' },
      )

      expect(result.buffer).toEqual(MOCK_IMAGE_BYTES)
      expect(providerRequests).toEqual([
        {
          provider: 'openai',
          endpoint: '/v1/images/edits',
          body: {
            fields: {
              model: 'gpt-image-2',
              prompt: 'turn image 1 into a blueprint',
              n: '1',
              size: '1024x1024',
            },
            files: [
              {
                field: 'image[]',
                name: 'reference-image-1.png',
                type: 'image/png',
                size: Buffer.byteLength('reference'),
                base64: Buffer.from('reference').toString('base64'),
              },
            ],
          },
        },
      ])
    })

    it('mocks every uploaded reference image without collapsing duplicate fields', async () => {
      await generateImageBuffer(
        [
          { type: 'text', content: 'Use image 1 for structure.' },
          imagePart('first'),
          { type: 'text', content: 'Use image 2 for color.' },
          imagePart('second', 'image/webp'),
        ],
        1024,
        1024,
        { provider: 'openai' },
      )

      expect(providerRequests[0]?.body).toEqual({
        fields: {
          model: 'gpt-image-2',
          prompt: 'Use image 1 for structure.\n\nUse image 2 for color.',
          n: '1',
          size: '1024x1024',
        },
        files: [
          expect.objectContaining({
            field: 'image[]',
            name: 'reference-image-1.png',
            type: 'image/png',
            base64: Buffer.from('first').toString('base64'),
          }),
          expect.objectContaining({
            field: 'image[]',
            name: 'reference-image-2.webp',
            type: 'image/webp',
            base64: Buffer.from('second').toString('base64'),
          }),
        ],
      })
    })

    it.each([
      [
        'a URL source',
        { type: 'url', value: 'https://example.test/image.png' },
        'must use a data source',
      ],
      [
        'empty image data',
        { type: 'data', value: '', mimeType: 'image/png' },
        'is empty',
      ],
      [
        'an unsupported MIME type',
        {
          type: 'data',
          value: Buffer.from('image').toString('base64'),
          mimeType: 'image/svg+xml',
        },
        'unsupported MIME type',
      ],
    ])('rejects %s before attempting an upload', async (_label, source, message) => {
      await expect(
        generateImageBuffer(
          [
            { type: 'text', content: 'edit image 1' },
            { type: 'image', source } as MediaPromptPart,
          ],
          1024,
          1024,
          { provider: 'openai' },
        ),
      ).rejects.toThrow(message)

      expect(providerRequests).toHaveLength(0)
    })

    it.each([
      [
        'JSON',
        HttpResponse.json(
          { error: { message: 'mocked OpenAI rejection' } },
          { status: 429 },
        ),
        'mocked OpenAI rejection',
      ],
      [
        'plain text',
        new HttpResponse('mocked gateway failure', { status: 502 }),
        'mocked gateway failure',
      ],
    ])('surfaces a mocked %s provider error', async (_label, response, message) => {
      providerMockServer.use(http.post(OPENAI_GENERATIONS_URL, () => response))

      await expect(
        generateImageBuffer('draw a tiny rocket', 1024, 1024, {
          provider: 'openai',
        }),
      ).rejects.toThrow(message)
    })

    it('rejects a mocked success response with no image data', async () => {
      providerMockServer.use(
        http.post(OPENAI_GENERATIONS_URL, () =>
          HttpResponse.json({ data: [{}] }),
        ),
      )

      await expect(
        generateImageBuffer('draw a tiny rocket', 1024, 1024, {
          provider: 'openai',
        }),
      ).rejects.toThrow('returned no image data')
    })

    it('fails before the mock endpoint when the API key is missing', async () => {
      vi.stubEnv('OPENAI_API_KEY', '')

      await expect(
        generateImageBuffer('draw a tiny rocket', 1024, 1024, {
          provider: 'openai',
        }),
      ).rejects.toThrow('OPENAI_API_KEY is not set')
      expect(providerRequests).toHaveLength(0)
    })
  })

  describe('Gemini', () => {
    it('mocks a multimodal request with text and image parts intact', async () => {
      const reference = imagePart('reference')
      const result = await generateImageBuffer(
        [{ type: 'text', content: 'Restyle this reference.' }, reference],
        1024,
        1024,
        { provider: 'gemini' },
      )

      expect(result.buffer).toEqual(MOCK_IMAGE_BYTES)
      expect(providerRequests).toHaveLength(1)
      expect(providerRequests[0]).toMatchObject({
        provider: 'gemini',
        endpoint: '/v1beta/models/gemini-3.1-flash-image:generateContent',
        body: {
          contents: [
            {
              parts: [
                { text: 'Restyle this reference.' },
                {
                  inlineData: {
                    data: reference.source.value,
                    mimeType: 'image/png',
                  },
                },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
            imageConfig: { aspectRatio: '1:1', imageSize: '1K' },
          },
        },
      })
    })

    it.each([
      [
        'JSON',
        HttpResponse.json(
          { error: { message: 'mocked Gemini rejection' } },
          { status: 429 },
        ),
        'mocked Gemini rejection',
      ],
      [
        'plain text',
        new HttpResponse('mocked Gemini gateway failure', { status: 502 }),
        'mocked Gemini gateway failure',
      ],
    ])('surfaces a mocked %s provider error', async (_label, response, message) => {
      providerMockServer.use(http.post(GEMINI_URL, () => response))

      await expect(
        generateImageBuffer('draw a tiny rocket', 1024, 1024, {
          provider: 'gemini',
        }),
      ).rejects.toThrow(message)
    })

    it('rejects a mocked success response with no image data', async () => {
      providerMockServer.use(
        http.post(GEMINI_URL, () =>
          HttpResponse.json({ candidates: [{ content: { parts: [] } }] }),
        ),
      )

      await expect(
        generateImageBuffer('draw a tiny rocket', 1024, 1024, {
          provider: 'gemini',
        }),
      ).rejects.toThrow('returned no image data')
    })

    it('fails before the mock endpoint when the API key is missing', async () => {
      vi.stubEnv('GEMINI_API_KEY', '')

      await expect(
        generateImageBuffer('draw a tiny rocket', 1024, 1024, {
          provider: 'gemini',
        }),
      ).rejects.toThrow('GEMINI_API_KEY is not set')
      expect(providerRequests).toHaveLength(0)
    })
  })

  describe('custom and validation paths', () => {
    it('uses a custom generator without any outbound request', async () => {
      const generate = vi.fn().mockResolvedValue({
        buffer: new Uint8Array([1, 2, 3]),
        mimeType: 'image/webp',
      })

      const result = await generateImageBuffer('custom', 320, 180, {
        provider: 'custom',
        generate,
      })

      expect(result).toEqual({
        buffer: Buffer.from([1, 2, 3]),
        mimeType: 'image/webp',
        width: 320,
        height: 180,
      })
      expect(generate).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'custom',
          width: 320,
          height: 180,
          signal: expect.any(AbortSignal),
        }),
      )
      expect(providerRequests).toHaveLength(0)
    })

    it.each([
      [
        'empty bytes',
        { buffer: new Uint8Array(), mimeType: 'image/png' },
        'empty or invalid buffer',
      ],
      [
        'a non-image MIME type',
        { buffer: new Uint8Array([1]), mimeType: 'text/plain' },
        'invalid MIME type',
      ],
    ])('rejects custom generators returning %s', async (_label, result, message) => {
      await expect(
        generateImageBuffer('custom', 320, 180, {
          provider: 'custom',
          generate: async () => result as never,
        }),
      ).rejects.toThrow(message)
    })

    it('rejects oversized dimensions before contacting a provider', async () => {
      await expect(
        generateImageBuffer('large', 4097, 1024, { provider: 'openai' }),
      ).rejects.toThrow('cannot exceed 4096px')
      expect(providerRequests).toHaveLength(0)
    })

    it('rejects an unknown provider before any request', async () => {
      await expect(
        generateImageBuffer('unknown', 1024, 1024, {
          // @ts-expect-error verifies the runtime guard for JavaScript consumers.
          provider: 'other',
        }),
      ).rejects.toThrow('Unknown provider: other')
      expect(providerRequests).toHaveLength(0)
    })

    it('propagates a caller abort signal to custom generation', async () => {
      const controller = new AbortController()
      let downstreamSignal: AbortSignal | undefined
      const generate = vi.fn(
        ({ signal }: { signal: AbortSignal }) =>
          new Promise<never>((_resolve, reject) => {
            downstreamSignal = signal
            signal.addEventListener('abort', () => reject(signal.reason), {
              once: true,
            })
          }),
      )

      const pending = generateImageBuffer('cancel me', 320, 180, {
        provider: 'custom',
        generate,
        signal: controller.signal,
      })
      controller.abort(new Error('client disconnected'))

      await expect(pending).rejects.toThrow('client disconnected')
      expect(downstreamSignal?.aborted).toBe(true)
    })
  })
})
