import { describe, expect, it } from 'vitest'
import {
  buildWorkspaceCard,
  parseWorkspaceCommand,
  workspaceAddedText,
  workspaceHelpText,
  workspaceListText,
  workspaceSwitchedText,
} from '../src/workspace-command.ts'

describe('parseWorkspaceCommand', () => {
  it('ignores non-command messages', () => {
    expect(parseWorkspaceCommand('hi')).toBeUndefined()
    expect(parseWorkspaceCommand('/workspacex')).toBeUndefined()
    expect(parseWorkspaceCommand('please /workspace')).toBeUndefined()
  })

  it('parses the bare list command', () => {
    expect(parseWorkspaceCommand('/workspace')).toEqual({ kind: 'list' })
    expect(parseWorkspaceCommand(' /workspace ')).toEqual({ kind: 'list' })
    expect(parseWorkspaceCommand('/workspace list')).toEqual({ kind: 'list' })
  })

  it('parses add and switch with the remainder as the argument', () => {
    expect(parseWorkspaceCommand('/workspace add /projects/a')).toEqual({ kind: 'add', path: '/projects/a' })
    expect(parseWorkspaceCommand('/workspace add')).toEqual({ kind: 'help' })
    expect(parseWorkspaceCommand('/workspace 后端')).toEqual({ kind: 'switch', selector: '后端' })
    expect(parseWorkspaceCommand('/workspace /projects/a')).toEqual({ kind: 'switch', selector: '/projects/a' })
    expect(parseWorkspaceCommand('/workspace help')).toEqual({ kind: 'help' })
  })
})

describe('buildWorkspaceCard', () => {
  const workspaces = [{ path: '/projects/a', title: 'A' }, { path: '/projects/b', title: 'B' }]

  it('renders one button per workspace carrying the path as switch value', () => {
    const card = buildWorkspaceCard(workspaces, '/projects/a') as {
      header: { title: { content: string } }
      elements: Array<{ tag: string; actions?: Array<{ value: unknown; text: { content: string } }> }>
    }
    expect(card.header.title.content).toBe('切换工作目录')
    const buttons = card.elements.filter(el => el.tag === 'action')
    expect(buttons).toHaveLength(2)
    expect(buttons[0]!.actions![0]!.value).toEqual({ action: 'switch-workspace', path: '/projects/a' })
    expect(buttons[1]!.actions![0]!.value).toEqual({ action: 'switch-workspace', path: '/projects/b' })
  })

  it('shows a hint when there are no workspaces yet', () => {
    const card = buildWorkspaceCard([]) as { elements: Array<{ text?: { content?: string } }> }
    const hasHint = card.elements.some(el => el.text?.content?.includes('/workspace add'))
    expect(hasHint).toBe(true)
  })
})

describe('workspace text helpers', () => {
  const ws = { path: '/projects/a', title: 'A' }

  it('marks the current workspace in the list', () => {
    const text = workspaceListText([ws, { path: '/projects/b', title: 'B' }], '/projects/a')
    expect(text).toContain('▸ **A**')
    expect(text).not.toContain('▸ **B**')
    expect(text).toContain('← 当前')
  })

  it('produces confirmation text for switch and add', () => {
    expect(workspaceSwitchedText(ws)).toContain('已切换到 workspace **A**')
    expect(workspaceAddedText(ws)).toContain('已登记 workspace **A**')
  })

  it('documents usage from help', () => {
    expect(workspaceHelpText()).toContain('/workspace add')
    expect(workspaceHelpText()).toContain('/workspace <标题或路径>')
  })
})
