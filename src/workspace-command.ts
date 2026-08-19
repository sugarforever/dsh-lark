import type { ConversationMessage } from './conversation.ts'

export interface WorkspaceSummary {
  path: string
  title: string
}

export type WorkspaceCommand =
  | { kind: 'list' }
  | { kind: 'add'; path: string }
  | { kind: 'switch'; selector: string }
  | { kind: 'help' }

const PREFIX = '/workspace'

/**
 * Parse an inbound message as a `/workspace` command. Returns `undefined` when
 * the text is not a workspace command so the regular agent turn proceeds.
 */
export function parseWorkspaceCommand(content: string): WorkspaceCommand | undefined {
  const trimmed = content.trim()
  if (!trimmed.toLowerCase().startsWith(PREFIX)) return undefined
  const rest = trimmed.slice(PREFIX.length)
  // `/workspacex` is not the command — require a boundary after the prefix.
  if (rest !== '' && !rest.startsWith(' ')) return undefined
  const argument = rest.trim()
  if (argument === '' || argument === 'list') return { kind: 'list' }
  if (argument === 'help' || argument === 'add') return { kind: 'help' }
  if (argument.toLowerCase().startsWith('add ')) {
    const path = argument.slice(4).trim()
    return path === '' ? { kind: 'help' } : { kind: 'add', path }
  }
  return { kind: 'switch', selector: argument }
}

/**
 * Feishu interactive-card payload with one button per registered workspace.
 * Each button carries the workspace path so the `card.action.trigger`
 * callback can switch to it directly (mirrors the web UI's workspace picker).
 */
export function buildWorkspaceCard(workspaces: WorkspaceSummary[], currentPath?: string): Record<string, unknown> {
  const current = currentPath ?? '未设置'
  const rows: unknown[] = [
    { tag: 'div', text: { tag: 'lark_md', content: `当前目录：\`${current}\`` } },
    { tag: 'hr' },
  ]
  if (workspaces.length === 0) {
    rows.push({ tag: 'div', text: { tag: 'lark_md', content: '还没有已登记的 workspace。用 `/workspace add <路径>` 添加一个。' } })
  } else {
    for (const workspace of workspaces) {
      rows.push({
        tag: 'action',
        actions: [{
          tag: 'button',
          text: { tag: 'plain_text', content: workspace.title },
          type: workspace.path === currentPath ? 'primary' : 'default',
          value: { action: 'switch-workspace', path: workspace.path },
        }],
      })
    }
  }
  rows.push({ tag: 'note', elements: [{ tag: 'plain_text', content: '点按钮切换；或输入 /workspace <标题或路径> 直接切换' }] })
  return {
    config: { wide_screen_mode: true },
    header: { template: 'blue', title: { tag: 'plain_text', content: '切换工作目录' } },
    elements: rows,
  }
}

export function workspaceListText(workspaces: WorkspaceSummary[], currentPath?: string): string {
  if (workspaces.length === 0) return '还没有已登记的 workspace。用 `/workspace add <路径>` 添加一个。'
  const lines = workspaces.map(w =>
    `${w.path === currentPath ? '▸' : ' '} **${w.title}** \`${w.path}\`${w.path === currentPath ? '  ← 当前' : ''}`)
  return ['已登记的 workspace：', ...lines, '', '用法：`/workspace` 查看 ｜ `/workspace <标题|路径>` 切换 ｜ `/workspace add <路径>` 添加'].join('\n')
}

export function workspaceSwitchedText(workspace: WorkspaceSummary): string {
  return `已切换到 workspace **${workspace.title}**（\`${workspace.path}\`）。此后的消息将在这个目录下工作。`
}

export function workspaceAddedText(workspace: WorkspaceSummary): string {
  return `已登记 workspace **${workspace.title}**（\`${workspace.path}\`）。`
}

export function workspaceHelpText(): string {
  return [
    '**/workspace 命令用法**',
    '- `/workspace` — 列出已登记的 workspace（弹卡片可选）',
    '- `/workspace <标题或路径>` — 切换到已有 workspace',
    '- `/workspace add <路径>` — 登记一个新 workspace 并切换',
    '',
    '当前会话每次只在一个工作目录下工作；切换 = 在该目录下开一个新会话（原会话保留）。',
  ].join('\n')
}

export type WorkspaceCommandBridge = {
  workspaceList(): Promise<WorkspaceSummary[]>
  workspaceCurrent(conversation: ConversationMessage): Promise<WorkspaceSummary | undefined>
  workspaceAdd(path: string): Promise<WorkspaceSummary>
  workspaceSwitch(conversation: ConversationMessage, selector: string): Promise<WorkspaceSummary>
}
