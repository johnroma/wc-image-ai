import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateImageBuffer } from '../src/server.js'

const OPENAI_GENERATIONS_URL = 'https://api.openai.com/v1/images/generations'
const OPENAI_EDITS_URL = 'https://api.openai.com/v1/images/edits'

const openAiImageResponse = (bytes: string) =>
  Response.json({
    data: [{ b64_json: Buffer.from(bytes).toString('base64') }],
  })

describe('OpenAI reference-image routing', () => {
  beforeEach(() => {
    vi.stubEnv('OPENAI_API_KEY', 'test-only-key')
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('Unexpected live network request')
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('keeps text-only requests on images/generations with JSON', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(openAiImageResponse('generated'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateImageBuffer('draw a tiny rocket', 1024, 1024, {
      provider: 'openai',
    })

    expect(result.buffer.toString()).toBe('generated')
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(OPENAI_GENERATIONS_URL)
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: ['Bearer', 'test-only-key'].join(' '),
    })
    expect(JSON.parse(init.body as string)).toMatchObject({
      prompt: 'draw a tiny rocket',
      n: 1,
      size: '1024x1024',
    })
  })

  it('combines ordered text and image prompt parts in one edit request', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(openAiImageResponse('edited'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateImageBuffer(
      [
        { type: 'text', content: 'turn image 1 into a blueprint' },
        {
          type: 'image',
          source: {
            type: 'data',
            value: Buffer.from('reference').toString('base64'),
            mimeType: 'image/png',
          },
        },
      ],
      1024,
      1024,
      { provider: 'openai' },
    )

    expect(result.buffer.toString()).toBe('edited')
    expect(fetchMock).toHaveBeenCalledOnce()

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(OPENAI_EDITS_URL)
    expect(init.headers).toHaveProperty('Authorization')
    expect(init.body).toBeInstanceOf(FormData)

    const formData = init.body as FormData
    expect(formData.get('prompt')).toBe('turn image 1 into a blueprint')
    expect(formData.get('model')).toBe('gpt-image-2')
    expect(formData.get('n')).toBe('1')
    expect(formData.get('size')).toBe('1024x1024')
    const image = formData.get('image[]')
    expect(image).toBeInstanceOf(Blob)
    expect((image as Blob).type).toBe('image/png')
    expect((image as File).name).toBe('reference-image-1.png')
    expect(await (image as Blob).text()).toBe('reference')
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
  ])('rejects %s before making a request', async (_label, source, message) => {
    const fetchMock = vi.mocked(fetch)

    await expect(
      generateImageBuffer(
        [
          { type: 'text', content: 'edit image 1' },
          { type: 'image', source },
        ],
        1024,
        1024,
        { provider: 'openai' },
      ),
    ).rejects.toThrow(message)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('preserves all image parts and combines text parts verbatim', async () => {
    const fetchMock = vi.fn().mockResolvedValue(openAiImageResponse('edited'))
    vi.stubGlobal('fetch', fetchMock)

    await generateImageBuffer(
      [
        { type: 'text', content: 'Use image 1 for structure.' },
        {
          type: 'image',
          source: {
            type: 'data',
            value: Buffer.from('first').toString('base64'),
            mimeType: 'image/png',
          },
        },
        { type: 'text', content: 'Use image 2 for color.' },
        {
          type: 'image',
          source: {
            type: 'data',
            value: Buffer.from('second').toString('base64'),
            mimeType: 'image/webp',
          },
        },
      ],
      1024,
      1024,
      { provider: 'openai' },
    )

    const formData = fetchMock.mock.calls[0][1].body as FormData
    expect(formData.get('prompt')).toBe(
      'Use image 1 for structure.\n\nUse image 2 for color.',
    )
    expect(formData.getAll('image[]')).toHaveLength(2)
    expect(
      await Promise.all(
        formData.getAll('image[]').map((image) => (image as Blob).text()),
      ),
    ).toEqual(['first', 'second'])
  })
})

describe('Gemini multimodal prompt routing', () => {
  beforeEach(() => {
    vi.stubEnv('GEMINI_API_KEY', 'test-only-key')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('keeps text and image parts together in generateContent', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    data: Buffer.from('generated').toString('base64'),
                    mimeType: 'image/png',
                  },
                },
              ],
            },
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await generateImageBuffer(
      [
        { type: 'text', content: 'Restyle this reference.' },
        {
          type: 'image',
          source: {
            type: 'data',
            value: Buffer.from('reference').toString('base64'),
            mimeType: 'image/png',
          },
        },
      ],
      1024,
      1024,
      { provider: 'gemini' },
    )

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.contents[0].parts).toEqual([
      { text: 'Restyle this reference.' },
      {
        inlineData: {
          data: Buffer.from('reference').toString('base64'),
          mimeType: 'image/png',
        },
      },
    ])
  })
})
