import * as React from 'react'
import { Button, Input, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'

type Translate = (key: string) => string
type RuntimeState = 'unconfigured' | 'connecting' | 'connected' | 'error' | 'stopped'

interface SettingsPayload {
  revision: number
  settings: {
    appId: string
    domain: 'feishu' | 'lark'
    requireMention: boolean
    dmMode: 'open' | 'allowlist' | 'disabled'
    groupAllowlist: string[]
    dmAllowlist: string[]
    provider?: string
    model?: string
    reasoningEffort?: string
    maxTokens?: number
    typingReaction?: string
    workspace?: string
    agentPreset?: string
    errorMessage: string
  }
  credential: { configured: boolean; source?: string; writable: boolean }
  runtime: { state: RuntimeState; message?: string }
}

interface FormState {
  appId: string
  appSecret: string
  domain: 'feishu' | 'lark'
  requireMention: boolean
  dmMode: 'open' | 'allowlist' | 'disabled'
  groupAllowlist: string
  dmAllowlist: string
  provider: string
  model: string
  reasoningEffort: string
  maxTokens: string
  typingReaction: string
  workspace: string
  agentPreset: string
  errorMessage: string
}

export interface ModelCatalogModel {
  id: string
  name: string
  description?: string
  reasoning?: boolean
}

export interface ModelProviderGroup {
  id: string
  name: string
  models: ModelCatalogModel[]
}

export interface ModelCatalog {
  groups: ModelProviderGroup[]
  failures: unknown[]
}

interface LarkSettingsSectionProps {
  t: Translate
  loadModels?: () => Promise<ModelCatalog>
}

const EMPTY_FORM: FormState = {
  appId: '', appSecret: '', domain: 'feishu', requireMention: true, dmMode: 'open',
  groupAllowlist: '', dmAllowlist: '', provider: '', model: '', reasoningEffort: '', maxTokens: '', typingReaction: '', workspace: '', agentPreset: '', errorMessage: '',
}

export function LarkSettingsSection({ t, loadModels }: LarkSettingsSectionProps): JSX.Element {
  const [payload, setPayload] = React.useState<SettingsPayload | null>(null)
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM)
  const [modelCatalog, setModelCatalog] = React.useState<ModelCatalog | null>(null)
  const [modelCatalogFailed, setModelCatalogFailed] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [notice, setNotice] = React.useState('')

  const adopt = React.useCallback((next: SettingsPayload) => {
    setPayload(next)
    setForm({
      appId: next.settings.appId,
      appSecret: '',
      domain: next.settings.domain,
      requireMention: next.settings.requireMention,
      dmMode: next.settings.dmMode,
      groupAllowlist: next.settings.groupAllowlist.join('\n'),
      dmAllowlist: next.settings.dmAllowlist.join('\n'),
      provider: next.settings.provider ?? '',
      model: next.settings.model ?? '',
      reasoningEffort: next.settings.reasoningEffort ?? '',
      maxTokens: next.settings.maxTokens === undefined ? '' : String(next.settings.maxTokens),
      typingReaction: next.settings.typingReaction ?? '',
      workspace: next.settings.workspace ?? '',
      agentPreset: next.settings.agentPreset ?? '',
      errorMessage: next.settings.errorMessage,
    })
  }, [])

  React.useEffect(() => {
    const controller = new AbortController()
    fetch('/dsh-lark/settings', { headers: { accept: 'application/json' }, cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const value = await response.json() as SettingsPayload & { error?: string }
        if (!response.ok) throw new Error(value.error ?? t('loadFailed'))
        adopt(value)
      })
      .catch(error => {
        if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : String(error))
      })
    return () => controller.abort()
  }, [adopt, t])

  React.useEffect(() => {
    if (loadModels === undefined) return
    let active = true
    setModelCatalogFailed(false)
    loadModels()
      .then(value => {
        if (active) setModelCatalog(value)
      })
      .catch(() => {
        if (active) setModelCatalogFailed(true)
      })
    return () => { active = false }
  }, [loadModels])

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm(current => ({ ...current, [key]: value }))
  const lines = (value: string) => value.split(/\n/u).map(item => item.trim()).filter(Boolean)

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setNotice(t('saving'))
    const body: Record<string, unknown> = {
      expectedRevision: payload?.revision,
      appId: form.appId.trim(), domain: form.domain, requireMention: form.requireMention, dmMode: form.dmMode,
      groupAllowlist: lines(form.groupAllowlist), dmAllowlist: lines(form.dmAllowlist), errorMessage: form.errorMessage,
    }
    for (const key of ['provider', 'model', 'reasoningEffort', 'typingReaction', 'workspace', 'agentPreset'] as const) {
      body[key] = form[key].trim() === '' ? null : form[key].trim()
    }
    body.maxTokens = form.maxTokens.trim() === '' ? null : Number(form.maxTokens)
    if (form.appSecret !== '') body.appSecret = form.appSecret
    try {
      const response = await fetch('/dsh-lark/settings', {
        method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(body),
      })
      const value = await response.json() as SettingsPayload & { error?: string }
      if (!response.ok) throw new Error(value.error ?? t('saveFailed'))
      adopt(value)
      setNotice(t('saved'))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const removeSecret = async () => {
    setBusy(true)
    setNotice(t('removing'))
    try {
      const response = await fetch('/dsh-lark/settings', { method: 'DELETE', headers: { accept: 'application/json' } })
      const value = await response.json() as SettingsPayload & { error?: string }
      if (!response.ok) throw new Error(value.error ?? t('removeFailed'))
      adopt(value)
      setNotice(t('removed'))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const runtimeState = payload?.runtime.state ?? 'connecting'
  const dotState = runtimeState === 'connected' ? 'done' : runtimeState === 'error' ? 'error' : runtimeState === 'connecting' ? 'ongoing' : 'warning'
  const providerGroup = modelCatalog?.groups.find(group => group.id === form.provider)
  const providerIsUnknown = form.provider !== '' && modelCatalog !== null && providerGroup === undefined
  const modelIsUnknown = form.model !== '' && modelCatalog !== null && providerGroup?.models.some(model => model.id === form.model) !== true
  const useModelSelects = loadModels !== undefined && !modelCatalogFailed

  return <section className="dsh-lark-settings" aria-labelledby="dsh-lark-title">
    <header className="dsh-lark-header">
      <div>
        <h2 id="dsh-lark-title">{t('title')}</h2>
        <p>{t('subtitle')}</p>
      </div>
      <div className="dsh-lark-runtime" aria-label={t('runtimeStatus')}>
        <StateDot state={dotState} size={8} />
        <span>{runtimeState}</span>
      </div>
    </header>

    {payload === null && notice === '' ? <p className="dsh-lark-loading">{t('loading')}</p> : null}
    {payload !== null ? <form onSubmit={save}>
      <div className="dsh-lark-card">
        <h3>{t('application')}</h3>
        <div className="dsh-lark-grid">
          <label><span>{t('appId')}</span><Input aria-label="appId" value={form.appId} onChange={event => update('appId', event.target.value)} autoComplete="off" /></label>
          <label><span>{t('domain')}</span><select aria-label="domain" value={form.domain} onChange={event => update('domain', event.target.value as FormState['domain'])}><option value="feishu">Feishu</option><option value="lark">Lark</option></select></label>
        </div>
        <label><span>{t('appSecret')}</span><Input aria-label="appSecret" type="password" disabled={!payload.credential.writable} value={form.appSecret} onChange={event => update('appSecret', event.target.value)} autoComplete="new-password" placeholder={t('secretPlaceholder')} /></label>
        <div
          className="dsh-lark-credential"
          aria-label={payload.credential.configured ? t('credentialConfigured') : t('credentialMissing')}
          data-state={payload.credential.configured ? 'configured' : 'missing'}
        >
          <span className="dsh-lark-credential-badge">
            <span className="dsh-lark-credential-dot" aria-hidden="true" />
            {payload.credential.configured ? t('credentialConfigured') : t('credentialMissing')}
          </span>
          {payload.credential.source !== undefined ? <code>{payload.credential.source}</code> : null}
          {!payload.credential.writable ? <span>{t('readOnly')}</span> : null}
        </div>
      </div>

      <div className="dsh-lark-card">
        <h3>{t('access')}</h3>
        <label className="dsh-lark-check"><input type="checkbox" checked={form.requireMention} onChange={event => update('requireMention', event.target.checked)} /><span>{t('requireMention')}</span></label>
        <label><span>{t('dmMode')}</span><select value={form.dmMode} onChange={event => update('dmMode', event.target.value as FormState['dmMode'])}><option value="open">{t('open')}</option><option value="allowlist">{t('allowlist')}</option><option value="disabled">{t('disabled')}</option></select></label>
        <div className="dsh-lark-grid">
          <label><span>{t('groupAllowlist')}</span><textarea value={form.groupAllowlist} onChange={event => update('groupAllowlist', event.target.value)} placeholder={t('onePerLine')} /></label>
          <label><span>{t('dmAllowlist')}</span><textarea value={form.dmAllowlist} onChange={event => update('dmAllowlist', event.target.value)} placeholder={t('onePerLine')} /></label>
        </div>
      </div>

      <div className="dsh-lark-card">
        <h3>{t('agent')}</h3>
        <div className="dsh-lark-grid">
          <label><span>{t('provider')}</span>{useModelSelects ? <select aria-label={t('provider')} disabled={modelCatalog === null} value={form.provider} onChange={event => setForm(current => ({ ...current, provider: event.target.value, model: '' }))}>
            <option value="">{modelCatalog === null ? t('modelCatalogLoading') : t('harnessDefault')}</option>
            {providerIsUnknown ? <option value={form.provider}>{form.provider} ({t('notInCatalog')})</option> : null}
            {modelCatalog?.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
          </select> : <Input aria-label={t('provider')} value={form.provider} onChange={event => update('provider', event.target.value)} />}</label>
          <label><span>{t('model')}</span>{useModelSelects ? <select aria-label={t('model')} disabled={modelCatalog === null || form.provider === ''} value={form.model} onChange={event => update('model', event.target.value)}>
            <option value="">{form.provider === '' ? t('selectProviderFirst') : t('harnessDefault')}</option>
            {modelIsUnknown ? <option value={form.model}>{form.model} ({t('notInCatalog')})</option> : null}
            {providerGroup?.models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
          </select> : <Input aria-label={t('model')} value={form.model} onChange={event => update('model', event.target.value)} />}</label>
          <label><span>{t('reasoningEffort')}</span><Input aria-label="reasoningEffort" value={form.reasoningEffort} onChange={event => update('reasoningEffort', event.target.value)} placeholder="low" /></label>
          <label><span>{t('maxTokens')}</span><Input aria-label="maxTokens" type="number" min="1" step="1" value={form.maxTokens} onChange={event => update('maxTokens', event.target.value)} placeholder="8192" /></label>
          <label><span>{t('typingReaction')}</span><Input aria-label="typingReaction" value={form.typingReaction} onChange={event => update('typingReaction', event.target.value)} placeholder="Typing" /></label>
          <label><span>{t('workspace')}</span><Input value={form.workspace} onChange={event => update('workspace', event.target.value)} /></label>
          <label><span>{t('agentPreset')}</span><Input value={form.agentPreset} onChange={event => update('agentPreset', event.target.value)} /></label>
        </div>
        <label><span>{t('errorMessage')}</span><textarea maxLength={500} value={form.errorMessage} onChange={event => update('errorMessage', event.target.value)} /></label>
      </div>

      <footer className="dsh-lark-actions">
        <Button variant="primary" type="submit" disabled={busy}>{busy ? t('saving') : t('save')}</Button>
        <Button variant="outline" type="button" disabled={busy || !payload.credential.configured || !payload.credential.writable} onClick={removeSecret}>{t('removeSecret')}</Button>
        <span role="status" aria-live="polite">{notice}</span>
      </footer>
      {payload.runtime.message !== undefined ? <p className="dsh-lark-detail">{payload.runtime.message}</p> : null}
    </form> : null}
  </section>
}
