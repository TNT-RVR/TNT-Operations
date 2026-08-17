import { describe, it, expect } from 'vitest'
import { MAPPING_FIELDS } from '../functions/qbo-sync.mjs'

/**
 * The set-mapping whitelist.
 *
 * `qbo_connection` holds the OAuth tokens, the realm and the environment
 * alongside the four operator choices. set-mapping takes a column name from the
 * CLIENT, so the whitelist is the only thing standing between an editor and
 * rewriting a credential or repointing the connection at another company.
 *
 * A widening is easy to do by accident and impossible to see in review, so the
 * exact contents are pinned here rather than merely spot-checked.
 */
describe('MAPPING_FIELDS', () => {
  it('is exactly the operator choices, and nothing else', () => {
    expect([...MAPPING_FIELDS].sort()).toEqual([
      'bee_expense_account_id',
      'default_tax_code_id',
      'exempt_tax_code_id',
      'income_account_id',
      'shipping_item_id',
    ])
  })

  it('admits nothing that carries a credential or identity', () => {
    for (const forbidden of [
      'access_token',
      'refresh_token',
      'realm_id',
      'environment',
      'refresh_token_expires_at',
      'disconnected_at',
      'connected_by',
      'multicurrency_enabled',
    ]) {
      expect(MAPPING_FIELDS.has(forbidden), `${forbidden} must not be client-writable`).toBe(false)
    }
  })
})
