import { afterAll, afterEach, beforeAll } from 'vitest'
import { resetProviderRequests } from './mocks/handlers'
import { providerMockServer } from './mocks/server'

if (process.env.MSW === 'true') {
  beforeAll(() => {
    providerMockServer.listen({
      onUnhandledRequest(request) {
        const url = new URL(request.url)
        if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return
        throw new Error(
          `MSW blocked an unhandled network request: ${request.method} ${request.url}`,
        )
      },
    })
  })

  afterEach(() => {
    providerMockServer.resetHandlers()
    resetProviderRequests()
  })

  afterAll(() => providerMockServer.close())
}
