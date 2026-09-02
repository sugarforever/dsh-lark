import { describe, expect, it } from 'vitest'
import { LARK_APP_SECRET_REF, resolveRuntimeConfig, resolveSettingsConfig } from '../src/config.ts'

describe('resolveSettingsConfig', () => {
  it('allows an installed plugin to remain unconfigured', () => {
    expect(resolveSettingsConfig({})).toMatchObject({
      appId: '', appSecretRef: LARK_APP_SECRET_REF, domain: 'feishu', requireMention: true, dmMode: 'open',
    })
  })

  it('applies safe conversational defaults', () => {
    expect(resolveSettingsConfig({ appId: 'id' })).toMatchObject({
      domain: 'feishu', requireMention: true, dmMode: 'open',
      errorMessage: '抱歉，处理这条消息时遇到了问题，请稍后重试。',
    })
    expect(resolveSettingsConfig({ appId: 'id' })).not.toHaveProperty('workspace')
  })

  it('preserves Lark and access-policy configuration', () => {
    expect(resolveSettingsConfig({
      appId: 'id', domain: 'lark', requireMention: false,
      dmMode: 'allowlist', groupAllowlist: ['oc_a'], dmAllowlist: ['ou_a'],
      provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: ' low ', maxTokens: 8192,
      typingReaction: ' Typing ', workspace: '/work', agentPreset: 'coding',
    })).toMatchObject({
      domain: 'lark', dmMode: 'allowlist', groupAllowlist: ['oc_a'], dmAllowlist: ['ou_a'],
      reasoningEffort: 'low', maxTokens: 8192, typingReaction: 'Typing', workspace: '/work', agentPreset: 'coding',
    })
  })

  it('requires a POSIX credential reference', () => {
    expect(() => resolveSettingsConfig({ appSecretRef: 'not-valid-ref' })).toThrow(/appSecretRef/)
  })

  it('rejects an unbounded error response', () => {
    expect(() => resolveSettingsConfig({ appId: 'id', errorMessage: 'x'.repeat(501) })).toThrow(/errorMessage/)
  })

  it('keeps optional latency controls disabled and validates configured bounds', () => {
    expect(resolveSettingsConfig({ appId: 'id', typingReaction: ' ', reasoningEffort: '' }))
      .not.toMatchObject({ typingReaction: expect.anything(), reasoningEffort: expect.anything() })
    expect(() => resolveSettingsConfig({ appId: 'id', maxTokens: 0 })).toThrow(/maxTokens/)
    expect(() => resolveSettingsConfig({ appId: 'id', maxTokens: 1.5 })).toThrow(/maxTokens/)
    expect(() => resolveSettingsConfig({ appId: 'id', typingReaction: 'x'.repeat(65) })).toThrow(/typingReaction/)
  })
})

describe('resolveRuntimeConfig', () => {
  it('requires the application id and resolved secret only at activation', () => {
    const config = resolveSettingsConfig({})
    expect(() => resolveRuntimeConfig(config, 'secret')).toThrow(/appId/)
    expect(() => resolveRuntimeConfig({ ...config, appId: 'id' }, '')).toThrow(/appSecret/)
    expect(resolveRuntimeConfig({ ...config, appId: 'id' }, 'secret')).toMatchObject({ appId: 'id', appSecret: 'secret' })
  })
})
