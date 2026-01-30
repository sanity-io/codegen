/**
 * TODO: Remove once we have a proper telemetry logger through the `@sanity/cli-core`
 *
 * This logger does nothing, except provide the interface to interact with
 */

import {createBatchedStore, createSessionId} from '@sanity/telemetry'

const session = createSessionId()
const store = createBatchedStore(session, {
  async resolveConsent() {
    return {status: 'denied'}
  },
  sendEvents: async () => {},
})

export const telemetry = store.logger
