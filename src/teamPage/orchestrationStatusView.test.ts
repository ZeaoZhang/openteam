// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultStore } from '../group/store'
import type { GroupChat, GroupRole, OpenTeamStore, OrchestrationFlow, OrchestrationRun } from '../group/types'
import { createOrchestrationStatusView } from './orchestrationStatusView'

afterEach(() => {
  document.body.replaceChildren()
  window.localStorage.clear()
})

function baseFixture(status: OrchestrationRun['status'] = 'running') {
  const now = Date.now()
  const chat: GroupChat = {
    id: 'chat-1',
    name: '群聊',
    mode: 'independent',
    roleIds: ['role-1', 'role-2'],
    messageIds: [],
    nextMessageSeq: 1,
    status: status === 'error' ? 'error' : status === 'running' ? 'running' : 'ready',
    createdAt: now,
    updatedAt: now,
  }
  const roles: GroupRole[] = [
    { id: 'role-1', chatId: chat.id, name: '产品', chatSite: 'chatgpt', status: 'thinking', contextCursor: 0, createdAt: now, updatedAt: now },
    { id: 'role-2', chatId: chat.id, name: '产品', chatSite: 'deepseek', status: 'ready', contextCursor: 0, createdAt: now, updatedAt: now },
  ]
  const flow: OrchestrationFlow = {
    id: 'flow-1',
    chatId: chat.id,
    name: '默认编排',
    stages: [
      { id: 'stage-1', kind: 'roles', name: '分析', roleIds: ['role-1'] },
      { id: 'stage-2', kind: 'roles', name: '实现', roleIds: ['role-2'] },
      { id: 'stage-3', kind: 'review', name: '复核', roleIds: [], review: { reviewerRoleIds: ['role-1'], maxAttempts: 3, onMaxAttempts: 'continue' } },
    ],
    graph: {
      stageNodes: [
        { id: 'stage-1', kind: 'roles', name: '分析', roleIds: ['role-1'], position: { x: 40, y: 70 } },
        { id: 'stage-2', kind: 'roles', name: '实现', roleIds: ['role-2'], position: { x: 220, y: 70 } },
        { id: 'stage-3', kind: 'review', name: '复核', roleIds: [], review: { reviewerRoleIds: ['role-1'], maxAttempts: 3, onMaxAttempts: 'continue' }, position: { x: 400, y: 60 } },
      ],
      edges: [
        { sourceStageId: 'stage-1', targetStageId: 'stage-2' },
        { sourceStageId: 'stage-2', targetStageId: 'stage-3' },
        { sourceStageId: 'stage-3', targetStageId: 'stage-2', sourcePort: 'fail', vertices: [{ x: 440, y: 180 }, { x: 220, y: 180 }] },
      ],
    },
    maxRounds: 2,
    createdAt: now,
    updatedAt: now,
  }
    const run: OrchestrationRun = {
      id: 'run-1',
      chatId: chat.id,
      flowId: flow.id,
      status,
      currentRound: 1,
      maxNodeExecutions: 50,
      maxRounds: 2,
    stageRuns: [
      {
        stageId: 'stage-1',
        stageIndex: 0,
        kind: 'roles',
        round: 1,
        status: status === 'error' ? 'error' : 'running',
        roleRuns: {
          'role-1': { roleId: 'role-1', status: status === 'error' ? 'error' : 'running', error: status === 'error' ? '投递失败' : undefined },
        },
      },
    ],
    error: status === 'error' ? '投递失败' : undefined,
    createdAt: now,
    updatedAt: now,
  }
  const store: OpenTeamStore = {
    ...createDefaultStore(),
    currentChatId: chat.id,
    chatOrder: [chat.id],
    chatsById: { [chat.id]: chat },
    rolesById: Object.fromEntries(roles.map(role => [role.id, role])),
    orchestrationFlowsById: { [flow.id]: flow },
    orchestrationRunsById: { [run.id]: run },
    activeOrchestrationRunIdByChatId: { [chat.id]: run.id },
  }
  store.messagesById['msg-task'] = {
    id: 'msg-task',
    chatId: chat.id,
    seq: 1,
    type: 'user',
    content: 'Use draft',
    targetRoleIds: [],
    mentionedRoleIds: [],
    mentionsAll: false,
    orchestrationRunId: run.id,
    orchestrationKind: 'task',
    createdAt: now,
    status: 'received',
  }
  chat.messageIds.push('msg-task')
  chat.nextMessageSeq = 2
  return { chat, roles, flow, run, store }
}

describe('orchestration status view', () => {
  it('renders active run as a floating card with progress, site labels, and a mini graph', () => {
    const fixture = baseFixture('running')
    const view = createOrchestrationStatusView({
      getStore: () => fixture.store,
      getCurrentChat: () => fixture.chat,
      getCurrentRoles: () => fixture.roles,
      reconnectRolesForSend: vi.fn(async () => undefined),
      runCommand: vi.fn(async () => undefined),
      showError: vi.fn(),
    })

    const node = view.renderOrchestrationStatus()

    expect(node?.classList.contains('orchestration-status-floating')).toBe(true)
    expect(node?.textContent).toContain('编排运行中')
    expect(node?.textContent).toContain('1 / 50')
    expect(node?.textContent).toContain('节点 1 / 3')
    expect(node?.textContent).toContain('产品（ChatGPT）')
    expect(node?.textContent).toContain('等待')
    expect(node?.textContent).toContain('产品（DeepSeek）')
    expect(node?.querySelector('svg.orchestration-mini-flow')).toBeTruthy()
    expect(node?.querySelector('[data-node-id="stage-1"]')?.classList.contains('current')).toBe(true)
    expect(node?.textContent).not.toContain('阶段')
  })

  it('renders review attempts and max-attempt behavior for the current review node', () => {
    const fixture = baseFixture('running')
    fixture.run.stageRuns = [
      { stageId: 'stage-1', stageIndex: 0, kind: 'roles', round: 1, status: 'completed', roleRuns: {} },
      { stageId: 'stage-2', stageIndex: 1, kind: 'roles', round: 1, status: 'completed', roleRuns: {} },
      {
        stageId: 'stage-3',
        stageIndex: 2,
        kind: 'review',
        round: 1,
        status: 'running',
        roleRuns: { 'role-1': { roleId: 'role-1', status: 'running', messageId: 'msg-review' } },
      },
    ]
    const node = createOrchestrationStatusView({
      getStore: () => fixture.store,
      getCurrentChat: () => fixture.chat,
      getCurrentRoles: () => fixture.roles,
      reconnectRolesForSend: vi.fn(async () => undefined),
      runCommand: vi.fn(async () => undefined),
      showError: vi.fn(),
    }).renderOrchestrationStatus()

    expect(node?.textContent).toContain('审核次数 1 / 3')
    expect(node?.textContent).toContain('上限后：继续往下走')
    expect(node?.querySelector('polygon[data-node-id="stage-3"]')).toBeTruthy()
    expect(node?.querySelector('[data-node-id="stage-3"]')?.classList.contains('current')).toBe(true)
  })

  it('renders debate progress and the judge meta for the current debate turn', () => {
    const fixture = baseFixture('running')
    const judge: GroupRole = { id: 'role-3', chatId: fixture.chat.id, name: '裁判', chatSite: 'chatgpt', status: 'ready', contextCursor: 0, createdAt: 1, updatedAt: 1 }
    fixture.store.rolesById[judge.id] = judge
    fixture.chat.roleIds.push(judge.id)
    fixture.flow.stages = [{
      id: 'debate-1',
      kind: 'debate',
      name: '正反辩论',
      roleIds: ['role-1', 'role-2'],
      debate: { judgeRoleId: 'role-3', rounds: 3, instructions: '必须回应成本' },
    }]
    fixture.flow.graph = {
      stageNodes: [{ ...fixture.flow.stages[0], position: { x: 40, y: 60 } }],
      edges: [],
    }
    fixture.run.stageRuns = [{
      stageId: 'debate-1',
      stageIndex: 0,
      kind: 'debate',
      round: 2,
      status: 'running',
      roleRuns: { 'role-1': { roleId: 'role-1', status: 'running' } },
      debate: { side: 'pro', round: 2, roleId: 'role-1' },
    }]

    const node = createOrchestrationStatusView({
      getStore: () => fixture.store,
      getCurrentChat: () => fixture.chat,
      getCurrentRoles: () => Object.values(fixture.store.rolesById),
      reconnectRolesForSend: vi.fn(async () => undefined),
      runCommand: vi.fn(async () => undefined),
      showError: vi.fn(),
    }).renderOrchestrationStatus()

    expect(node?.textContent).toContain('辩论 · 第 2 轮 · 正方发言')
    expect(node?.textContent).toContain('轮次 2 / 3')
    expect(node?.textContent).toContain('裁判裁定 0 次')
    expect(node?.querySelector('[data-node-id="debate-1"]')?.classList.contains('current')).toBe(true)
  })

  it('renders saved mini graph vertices as orthogonal SVG line segments', () => {
    const fixture = baseFixture('running')
    fixture.flow.graph!.edges = [
      { sourceStageId: 'stage-3', targetStageId: 'stage-1', sourcePort: 'fail', vertices: [{ x: 300, y: 130 }] },
    ]
    const node = createOrchestrationStatusView({
      getStore: () => fixture.store,
      getCurrentChat: () => fixture.chat,
      getCurrentRoles: () => fixture.roles,
      reconnectRolesForSend: vi.fn(async () => undefined),
      runCommand: vi.fn(async () => undefined),
      showError: vi.fn(),
    }).renderOrchestrationStatus()

    const path = node?.querySelector<SVGPathElement>('.orchestration-mini-edge.branch-fail')?.getAttribute('d')
    expect(path).toBe('M 458 150 L 300 150 L 300 130 L 40 130 L 40 102')
  })

  it('renders terminal states with distinct classes', () => {
    const completed = baseFixture('completed')
    completed.run.stageRuns[0].status = 'completed'
    const stopped = baseFixture('stopped')

    const completedNode = createOrchestrationStatusView({
      getStore: () => completed.store,
      getCurrentChat: () => completed.chat,
      getCurrentRoles: () => completed.roles,
      reconnectRolesForSend: vi.fn(async () => undefined),
      runCommand: vi.fn(async () => undefined),
      showError: vi.fn(),
    }).renderOrchestrationStatus()
    const stoppedNode = createOrchestrationStatusView({
      getStore: () => stopped.store,
      getCurrentChat: () => stopped.chat,
      getCurrentRoles: () => stopped.roles,
      reconnectRolesForSend: vi.fn(async () => undefined),
      runCommand: vi.fn(async () => undefined),
      showError: vi.fn(),
    }).renderOrchestrationStatus()

    expect(completedNode?.classList.contains('orchestration-status-completed')).toBe(true)
    expect(completedNode?.textContent).toContain('编排已完成')
    expect(stoppedNode?.classList.contains('orchestration-status-stopped')).toBe(true)
    expect(stoppedNode?.textContent).toContain('编排已停止')
  })

  it('renders terminal run progress from the current node instead of cumulative stage runs', () => {
    const fixture = baseFixture('error')
    fixture.run.currentRound = 2
    fixture.run.stageRuns = [
      { stageId: 'stage-1', stageIndex: 0, kind: 'roles', round: 1, status: 'completed', roleRuns: {} },
      { stageId: 'stage-2', stageIndex: 1, kind: 'roles', round: 1, status: 'completed', roleRuns: {} },
      { stageId: 'stage-3', stageIndex: 2, kind: 'review', round: 1, status: 'completed', roleRuns: {} },
      { stageId: 'stage-1', stageIndex: 0, kind: 'roles', round: 2, status: 'completed', roleRuns: {} },
      { stageId: 'stage-2', stageIndex: 1, kind: 'roles', round: 2, status: 'completed', roleRuns: {} },
      {
        stageId: 'stage-3',
        stageIndex: 2,
        kind: 'review',
        round: 2,
        status: 'error',
        roleRuns: { 'role-1': { roleId: 'role-1', status: 'error', error: '投递失败' } },
      },
    ]
    const node = createOrchestrationStatusView({
      getStore: () => fixture.store,
      getCurrentChat: () => fixture.chat,
      getCurrentRoles: () => fixture.roles,
      reconnectRolesForSend: vi.fn(async () => undefined),
      runCommand: vi.fn(async () => undefined),
      showError: vi.fn(),
    }).renderOrchestrationStatus()

    expect(node?.textContent).toContain('编排出错')
    expect(node?.textContent).toContain('6 / 50')
    expect(node?.textContent).toContain('节点 3 / 3')
    expect(node?.textContent).not.toContain('6 / 3 步')
    expect(node?.textContent).not.toContain('第 2 轮')
  })

  it('dispatches stop, retry node, skip node, retry review, resume, and rerun actions when applicable', async () => {
    const running = baseFixture('running')
    const runCommand = vi.fn(async () => undefined)
    const runningNode = createOrchestrationStatusView({
      getStore: () => running.store,
      getCurrentChat: () => running.chat,
      getCurrentRoles: () => running.roles,
      reconnectRolesForSend: vi.fn(async () => undefined),
      runCommand,
      showError: vi.fn(),
    }).renderOrchestrationStatus()

    findButton(runningNode, '停止')?.click()
    expect(runCommand).toHaveBeenCalledWith('GROUP_ORCHESTRATION_STOP', { chatId: running.chat.id })

    const failed = baseFixture('error')
    const failedRunCommand = vi.fn(async () => undefined)
    const failedReconnectRolesForSend = vi.fn(async () => undefined)
    const failedNode = createOrchestrationStatusView({
      getStore: () => failed.store,
      getCurrentChat: () => failed.chat,
      getCurrentRoles: () => failed.roles,
      reconnectRolesForSend: failedReconnectRolesForSend,
      runCommand: failedRunCommand,
      showError: vi.fn(),
    }).renderOrchestrationStatus()
    findButton(failedNode, '重发')?.click()
    findButton(failedNode, '跳过节点')?.click()
    await flushAsync()
    expect(failedReconnectRolesForSend).toHaveBeenCalledWith(failed.chat, [failed.roles[0]])
    expect(failedNode?.textContent).toContain('失败节点')
    expect(failedNode?.textContent).toContain('产品（ChatGPT）')
    expect(failedNode?.textContent).toContain('重发')
    expect(failedNode?.textContent).toContain('跳过节点')
    expect(failedNode?.textContent).not.toContain('阶段')
    expect(failedNode?.querySelector('.orchestration-status-actions')?.closest('.orchestration-status-header')).toBeTruthy()
    expect(failedRunCommand).toHaveBeenCalledWith('GROUP_ORCHESTRATION_RETRY_STAGE', { chatId: failed.chat.id, stageId: 'stage-1' })
    expect(failedRunCommand).toHaveBeenCalledWith('GROUP_ORCHESTRATION_SKIP_STAGE', { chatId: failed.chat.id, stageId: 'stage-1' })

    failed.run.stageRuns[0].kind = 'review'
    const reviewRunCommand = vi.fn(async () => undefined)
    const reviewNode = createOrchestrationStatusView({
      getStore: () => failed.store,
      getCurrentChat: () => failed.chat,
      getCurrentRoles: () => failed.roles,
      reconnectRolesForSend: vi.fn(async () => undefined),
      runCommand: reviewRunCommand,
      showError: vi.fn(),
    }).renderOrchestrationStatus()
    findButton(reviewNode, '重发')?.click()
    await flushAsync()
    expect(reviewNode?.textContent).toContain('重发')
    expect(reviewRunCommand).toHaveBeenCalledWith('GROUP_ORCHESTRATION_RETRY_REVIEW', { chatId: failed.chat.id })

    const stopped = baseFixture('stopped')
    stopped.run.stageRuns[0].status = 'skipped'
    const stoppedRunCommand = vi.fn(async () => undefined)
    const stoppedNode = createOrchestrationStatusView({
      getStore: () => stopped.store,
      getCurrentChat: () => stopped.chat,
      getCurrentRoles: () => stopped.roles,
      reconnectRolesForSend: vi.fn(async () => undefined),
      runCommand: stoppedRunCommand,
      showError: vi.fn(),
    }).renderOrchestrationStatus()
    findButton(stoppedNode, '继续')?.click()
    findButton(stoppedNode, '重新运行')?.click()
    await flushAsync()
    expect(stoppedNode?.textContent).toContain('继续')
    expect(stoppedNode?.textContent).toContain('重新运行')
    expect(stoppedRunCommand).toHaveBeenCalledWith('GROUP_ORCHESTRATION_RESUME', { chatId: stopped.chat.id, runId: stopped.run.id })
    expect(stoppedRunCommand).toHaveBeenCalledWith('GROUP_ORCHESTRATION_RUN', { chatId: stopped.chat.id, flowId: stopped.flow.id, task: 'Use draft' })
  })

  it('recovers the stopped node role before resuming a stopped run', async () => {
    const fixture = baseFixture('stopped')
    fixture.run.stageRuns[0].status = 'skipped'
    fixture.run.stageRuns[0].roleRuns['role-1'].status = 'skipped'
    const calls: string[] = []
    const reconnectRolesForSend = vi.fn(async () => {
      calls.push('reconnect')
    })
    const runCommand = vi.fn(async () => {
      calls.push('resume')
    })
    const node = createOrchestrationStatusView({
      getStore: () => fixture.store,
      getCurrentChat: () => fixture.chat,
      getCurrentRoles: () => fixture.roles,
      reconnectRolesForSend,
      runCommand,
      showError: vi.fn(),
    }).renderOrchestrationStatus()

    findButton(node, '继续')?.click()
    await flushAsync()

    expect(calls).toEqual(['reconnect', 'resume'])
    expect(reconnectRolesForSend).toHaveBeenCalledWith(fixture.chat, [fixture.roles[0]])
    expect(runCommand).toHaveBeenCalledWith('GROUP_ORCHESTRATION_RESUME', { chatId: fixture.chat.id, runId: fixture.run.id })
  })

  it('does not dispatch duplicate retry commands while a retry is pending', async () => {
    const fixture = baseFixture('error')
    const reconnectRolesForSend = vi.fn(async () => undefined)
    let resolveRetry: (() => void) | undefined
    const runCommand = vi.fn(() => new Promise<void>(resolve => {
      resolveRetry = resolve
    }))
    const node = createOrchestrationStatusView({
      getStore: () => fixture.store,
      getCurrentChat: () => fixture.chat,
      getCurrentRoles: () => fixture.roles,
      reconnectRolesForSend,
      runCommand,
      showError: vi.fn(),
    }).renderOrchestrationStatus()
    const retryButton = findButton(node, '重发')

    retryButton?.click()
    retryButton?.click()
    await flushAsync()

    expect(reconnectRolesForSend).toHaveBeenCalledTimes(1)
    expect(runCommand).toHaveBeenCalledTimes(1)
    expect(runCommand).toHaveBeenCalledWith('GROUP_ORCHESTRATION_RETRY_STAGE', { chatId: fixture.chat.id, stageId: 'stage-1' })

    resolveRetry?.()
    await flushAsync()
    retryButton?.click()
    await flushAsync()

    expect(runCommand).toHaveBeenCalledTimes(2)
  })

  it('collapses into a compact floating launcher and persists the local preference', () => {
    const fixture = baseFixture('running')
    const view = createOrchestrationStatusView({
      getStore: () => fixture.store,
      getCurrentChat: () => fixture.chat,
      getCurrentRoles: () => fixture.roles,
      reconnectRolesForSend: vi.fn(async () => undefined),
      runCommand: vi.fn(async () => undefined),
      showError: vi.fn(),
    })

    const expanded = view.renderOrchestrationStatus()
    expanded?.querySelector<HTMLButtonElement>('.orchestration-status-collapse')?.click()
    const collapsed = view.renderOrchestrationStatus()

    expect(collapsed?.classList.contains('orchestration-status-collapsed')).toBe(true)
    expect(collapsed?.textContent).toBe('编')
    expect(collapsed?.getAttribute('aria-label')).toContain('编排运行中')
    expect(collapsed?.getAttribute('aria-label')).toContain('1 / 50')
    expect(window.localStorage.getItem('openteam.orchestrationFloatingStatus.chat-1')).toContain('"collapsed":true')
  })

  it('expands again when the collapsed launcher is clicked without dragging', () => {
    const fixture = baseFixture('running')
    const view = createOrchestrationStatusView({
      getStore: () => fixture.store,
      getCurrentChat: () => fixture.chat,
      getCurrentRoles: () => fixture.roles,
      reconnectRolesForSend: vi.fn(async () => undefined),
      runCommand: vi.fn(async () => undefined),
      showError: vi.fn(),
    })

    const expanded = view.renderOrchestrationStatus()
    document.body.append(expanded!)
    expanded?.querySelector<HTMLButtonElement>('.orchestration-status-collapse')?.click()
    const collapsed = document.querySelector<HTMLButtonElement>('.orchestration-status-collapsed')
    collapsed?.click()

    expect(document.querySelector('.orchestration-status-collapsed')).toBeNull()
    expect(document.querySelector('.orchestration-status:not(.orchestration-status-collapsed)')?.textContent).toContain('编排运行中')
  })

  it('keeps the collapsed launcher fixed even when stale launcher positions exist', () => {
    const fixture = baseFixture('running')
    window.localStorage.setItem('openteam.orchestrationFloatingStatus.chat-1', JSON.stringify({
      collapsed: true,
      collapsedX: 500,
      collapsedY: 500,
      width: 390,
      height: 376,
    }))
    const view = createOrchestrationStatusView({
      getStore: () => fixture.store,
      getCurrentChat: () => fixture.chat,
      getCurrentRoles: () => fixture.roles,
      reconnectRolesForSend: vi.fn(async () => undefined),
      runCommand: vi.fn(async () => undefined),
      showError: vi.fn(),
    })

    const collapsed = view.renderOrchestrationStatus() as HTMLElement

    expect(collapsed.style.left).toBe('')
    expect(collapsed.style.top).toBe('')
  })

  it('keeps the collapsed launcher aligned above the composer right edge', () => {
    const source = readFileSync(resolve(process.cwd(), 'public/team.css'), 'utf8')

    expect(source).toMatch(/\.orchestration-status-collapsed\s*{[^}]*right:\s*22px;/s)
    expect(source).toMatch(/\.orchestration-status-collapsed\s*{[^}]*bottom:\s*206px;/s)
  })

  it('clamps saved expanded floating positions back into the viewport', () => {
    const fixture = baseFixture('running')
    window.localStorage.setItem('openteam.orchestrationFloatingStatus.chat-1', JSON.stringify({
      collapsed: false,
      x: 99999,
      y: 99999,
      width: 390,
      height: 376,
    }))
    const view = createOrchestrationStatusView({
      getStore: () => fixture.store,
      getCurrentChat: () => fixture.chat,
      getCurrentRoles: () => fixture.roles,
      reconnectRolesForSend: vi.fn(async () => undefined),
      runCommand: vi.fn(async () => undefined),
      showError: vi.fn(),
    })

    const expanded = view.renderOrchestrationStatus() as HTMLElement

    expect(expanded.style.left).toBe(`${window.innerWidth - 390 - 8}px`)
    expect(expanded.style.top).toBe(`${window.innerHeight - 376 - 8}px`)
  })
})

function flushAsync(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

function findButton(root: HTMLElement | undefined, text: string): HTMLButtonElement | undefined {
  return [...root?.querySelectorAll<HTMLButtonElement>('button') ?? []].find(button => button.textContent === text)
}
