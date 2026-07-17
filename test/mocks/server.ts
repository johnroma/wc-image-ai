import { setupServer } from 'msw/node'
import { providerHandlers } from './handlers'

export const providerMockServer = setupServer(...providerHandlers)
