import * as React from 'react'
import { Button, Input, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LarkSettingsValue, RuntimeStatusInfo, SettingsChannel } from './index.ts'

type Translate = (key: string) => string
export type RuntimeState = 'unconfigured' | 'connecting' | 'connected' | 'error' | 'stopped'

export interface CredentialInfo {
  configured: boolean
  source?: string
  writable: boolean
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
  channel: SettingsChannel
}

const EMPTY_FORM: FormState = {
  appId: '', appSecret: '', domain: 'feishu', requireMention: true, dmMode: 'open',
  groupAllowlist: '', dmAllowlist: '', provider: '', model: '', workspace: '', agentPreset: '', errorMessage: '',
}

function adoptForm(next: LarkSettingsValue): FormState {
  return {
    appId: next.appId,
    appSecret: '',
    domain: next.domain,
    requireMention: next.requireMention,
    dmMode: next.dmMode,
    groupAllowlist: next.groupAllowlist.join('\n'),
    dmAllowlist: next.dmAllowlist.join('\n'),
    provider: next.provider ?? '',
    model: next.model ?? '',
    workspace: next.workspace ?? '',
    agentPreset: next.agentPreset ?? '',
    errorMessage: next.errorMessage,
  }
}

export function LarkSettingsSection({ t, loadModels, channel }: LarkSettingsSectionProps): JSX.Element {
  const [settings, setSettings] = React.useState<LarkSettingsValue | null>(null)
  const [credential, setCredential] = React.useState<CredentialInfo | undefined>()
  const [runtime, setRuntime] = React.useState<RuntimeStatusInfo>({ state: 'connecting' })
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM)
  const [modelCatalog, setModelCatalog] = React.useState<ModelCatalog | null>(null)
  const [modelCatalogFailed, setModelCatalogFailed] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [notice, setNotice] = React.useState('')
  const busyRef = React.useRef(false)

  const writable = channel.getSettings()?.writable ?? true

  // Reactive settings section: initial read + adopt on every committed change
  // (own saves land here through settings/document-updated).
  React.useEffect(() => {
    const snapshot = channel.getSettings()
    if (snapshot?.value !== undefined) {
      setSettings(snapshot.value)
      setForm(adoptForm(snapshot.value))
    }
    return channel.subscribeSettings(() => {
      const next = channel.getSettings()
      const value = next?.value
      if (value !== undefined) {
        setSettings(value)
        setForm(current => busyRef.current ? current : adoptForm(value))
      }
    })
  }, [channel])

  // Credential badge + runtime status; keep both fresh on external changes.
  React.useEffect(() => {
    let active = true
    const refresh = () => {
      channel.describeCredential().then(value => {
        if (active) setCredential(value)
      }).catch(() => undefined)
      channel.status().then(value => {
        if (active) setRuntime(value)
      }).catch(() => undefined)
    }
    refresh()
    const unsubscribe = channel.subscribeCredential(() => {
      refresh()
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [channel, settings?.appSecretRef])

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
    busyRef.current = true
    setBusy(true)
    setNotice(t('saving'))
    const body: Record<string, unknown> = {
      expectedRevision: channel.getSettings()?.revision ?? 0,
      appId: form.appId.trim(), domain: form.domain, requireMention: form.requireMention, dmMode: form.dmMode,
      groupAllowlist: lines(form.groupAllowlist), dmAllowlist: lines(form.dmAllowlist), errorMessage: form.errorMessage,
    }
    for (const key of ['provider', 'model', 'workspace', 'agentPreset'] as const) {
      body[key] = form[key].trim() === '' ? null : form[key].trim()
    }
    if (form.appSecret !== '') body.appSecret = form.appSecret
    try {
      const status = await channel.apply(body)
      busyRef.current = false
      setRuntime(status)
      setBusy(false)
      setNotice(t('saved'))
    } catch (error) {
      busyRef.current = false
      setBusy(false)
      setNotice(error instanceof Error ? error.message : String(error))
    }
  }

  const removeSecret = async () => {
    busyRef.current = true
    setBusy(true)
    setNotice(t('removing'))
    try {
      await channel.removeSecret()
      busyRef.current = false
      setBusy(false)
      setNotice(t('removed'))
    } catch (error) {
      busyRef.current = false
      setBusy(false)
      setNotice(error instanceof Error ? error.message : String(error))
    }
  }

  const runtimeState: RuntimeState = runtime.state
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

    {settings === null ? <p className="dsh-lark-loading">{t('loading')}</p> : null}
    {settings !== null ? <form onSubmit={save}>
      <div className="dsh-lark-card">
        <h3>{t('application')}</h3>
        <div className="dsh-lark-grid">
          <label><span>{t('appId')}</span><Input aria-label="appId" value={form.appId} onChange={event => update('appId', event.target.value)} autoComplete="off" /></label>
          <label><span>{t('domain')}</span><select aria-label="domain" value={form.domain} onChange={event => update('domain', event.target.value as FormState['domain'])}><option value="feishu">Feishu</option><option value="lark">Lark</option></select></label>
        </div>
        <label><span>{t('appSecret')}</span><Input aria-label="appSecret" type="password" disabled={credential?.writable !== true} value={form.appSecret} onChange={event => update('appSecret', event.target.value)} autoComplete="new-password" placeholder={t('secretPlaceholder')} /></label>
        <div
          className="dsh-lark-credential"
          aria-label={credential?.configured ? t('credentialConfigured') : t('credentialMissing')}
          data-state={credential?.configured ? 'configured' : 'missing'}
        >
          <span className="dsh-lark-credential-badge">
            <span className="dsh-lark-credential-dot" aria-hidden="true" />
            {credential?.configured ? t('credentialConfigured') : t('credentialMissing')}
          </span>
          {credential?.source !== undefined ? <code>{credential.source}</code> : null}
          {credential?.writable === false ? <span>{t('readOnly')}</span> : null}
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
          <label><span>{t('workspace')}</span><Input value={form.workspace} onChange={event => update('workspace', event.target.value)} /></label>
          <label><span>{t('agentPreset')}</span><Input value={form.agentPreset} onChange={event => update('agentPreset', event.target.value)} /></label>
        </div>
        <label><span>{t('errorMessage')}</span><textarea maxLength={500} value={form.errorMessage} onChange={event => update('errorMessage', event.target.value)} /></label>
      </div>

      <footer className="dsh-lark-actions">
        <Button variant="primary" type="submit" disabled={busy || !writable}>{busy ? t('saving') : t('save')}</Button>
        <Button variant="outline" type="button" disabled={busy || !credential?.configured || credential?.writable !== true} onClick={removeSecret}>{t('removeSecret')}</Button>
        <span role="status" aria-live="polite">{notice}</span>
      </footer>
      {runtime.message !== undefined ? <p className="dsh-lark-detail">{runtime.message}</p> : null}
    </form> : null}
  </section>
}
