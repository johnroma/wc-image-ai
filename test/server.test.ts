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

  it('switches to multipart images/edits only when a reference Blob exists', async () => {
    const referenceBlob = new Blob(['reference'], { type: 'image/png' })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(openAiImageResponse('edited'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateImageBuffer(
      'turn it into a blueprint',
      1024,
      1024,
      {
        provider: 'openai',
        referenceImage: referenceBlob,
      },
    )

    expect(result.buffer.toString()).toBe('edited')
    expect(fetchMock).toHaveBeenCalledOnce()

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(OPENAI_EDITS_URL)
    expect(init.headers).toEqual({
      Authorization: ['Bearer', 'test-only-key'].join(' '),
    })
    expect(init.body).toBeInstanceOf(FormData)

    const formData = init.body as FormData
    expect(formData.get('prompt')).toBe('turn it into a blueprint')
    expect(formData.get('model')).toBe('gpt-image-2')
    expect(formData.get('n')).toBe('1')
    expect(formData.get('size')).toBe('1024x1024')
    const image = formData.get('image')
    expect(image).toBeInstanceOf(Blob)
    expect((image as Blob).type).toBe('image/png')
    expect((image as File).name).toBe('reference-image.png')
    expect(await (image as Blob).text()).toBe('reference')
  })

  it.each([
    ['a non-Blob value', 'https://example.test/image.png', 'must be a Blob'],
    ['null', null, 'must be a Blob'],
    ['false', false, 'must be a Blob'],
    ['zero', 0, 'must be a Blob'],
    ['an empty string', '', 'must be a Blob'],
    ['an empty Blob', new Blob([], { type: 'image/png' }), 'is empty'],
    [
      'an unsupported MIME type',
      new Blob(['image'], { type: 'image/svg+xml' }),
      'unsupported MIME type',
    ],
  ])('rejects %s before making a request', async (_label, referenceImage, message) => {
    const fetchMock = vi.mocked(fetch)

    await expect(
      generateImageBuffer('edit me', 1024, 1024, {
        provider: 'openai',
        referenceImage: referenceImage as Blob,
      }),
    ).rejects.toThrow(message)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('normalizes a File name to match its validated MIME type', async () => {
    const referenceFile = new File(['reference'], '../concept.svg', {
      type: 'image/png',
    })
    const fetchMock = vi.fn().mockResolvedValue(openAiImageResponse('edited'))
    vi.stubGlobal('fetch', fetchMock)

    await generateImageBuffer('edit me', 1024, 1024, {
      provider: 'openai',
      referenceImage: referenceFile,
    })

    const formData = fetchMock.mock.calls[0][1].body as FormData
    expect((formData.get('image') as File).name).toBe('concept.png')
  })
})
