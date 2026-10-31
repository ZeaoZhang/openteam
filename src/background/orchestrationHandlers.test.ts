import { describe, expect, it, vi } from 'vitest'
import type { GroupChat, GroupRole, OpenTeamStore, OrchestrationFlow } from '../group/types'

type RuntimeMessage = { type: string; [key: string]: unknown }
type MessageSender = chrome.runtime.MessageSender

async function setupBackground(initialStore?: OpenTeamStore, externalModelContent?: string, externalStreamChunks?: string[]) {
  vi.resetModules()
  const externalComplete = vi.fn(async () => ({ content: externalModelContent ?? '{"flowName":"Empty","roles":[],"nodes":[],"edges":[]}' }))
  const externalStream = externalStreamChunks
    ? vi.fn(async function* () {
      for (const chunk of externalStreamChunks) yield chunk
    })
    : undefined
  vi.doMock('./externalModelClient', () => ({
    createExternalModelClient: () => ({ complete: externalComplete, ...(externalStream ? { stream: externalStream } : {}) }),
  }))
  const { STORE_KEY, createDefaultStore, loadStore } = await import('../group/store')
  const stored: Record<string, unknown> = { [STORE_KEY]: structuredClone(initialStore ?? createDefaultStore()) }
  const listeners: Array<(message: RuntimeMessage, sender: MessageSender, sendResponse: (response: unknown) => void) => boolean> = []
  const runtimeSendMessage = vi.fn().mockResolvedValue({ ok: true })
  const tabsSendMessage = vi.fn().mockResolvedValue({ ok: true })
  vi.stubGlobal('chrome', {
    runtime: {
      onInstalled: { addListener: vi.fn() },
      onMessage: { addListener: vi.fn(listener => listeners.push(listener)) },
      onMessageExternal: { addListener: vi.fn() },
      sendMessage: runtimeSendMessage,
      getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
    },
    storage: {
      local: {
        get: vi.fn(async (key?: string | string[] | null) => {
          if (key === null || typeof key === 'undefined') return structuredClone(stored)
          if (Array.isArray(key)) return Object.fromEntries(key.map(item => [item, structuredClone(stored[item])]))
          return { [key]: structuredClone(stored[key]) }
        }),
        set: vi.fn(async (items: Record<string, unknown>) => Object.assign(stored, structuredClone(items))),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key]
        }),
      },
    },
    tabs: { sendMessage: tabsSendMessage, create: vi.fn().mockResolvedValue({}), onRemoved: { addListener: vi.fn() } },
    action: { onClicked: { addListener: vi.fn() } },
  })
  await import('./index')
  expect(listeners).toHaveLength(1)
  return {
    externalComplete,
    externalStream,
    runtimeSendMessage,
    tabsSendMessage,
    getStore: loadStore,
    invoke: (message: RuntimeMessage, sender = { tab: { id: 900 } as chrome.tabs.Tab, frameId: 0, url: 'https://gemini.google.com/app/test' }) => new Promise(resolve => listeners[0](message, sender, resolve)),
  }
}

describe('orchestration background handlers', () => {
  it('saves and deletes flows by chat order', async () => {
    const store = makeStore()
    const harness = await setupBackground(store)
    const flow = makeFlow('chat-1')

    const saved = await harness.invoke({ type: 'GROUP_ORCHESTRATION_FLOW_SAVE', flow }) as { ok: boolean; store: OpenTeamStore }

    expect(saved.ok).toBe(true)
    expect(saved.store.orchestrationFlowsById['flow-1']).toMatchObject({ id: 'flow-1', chatId: 'chat-1', maxRounds: 1 })
    expect(saved.store.orchestrationFlowOrderByChatId['chat-1']).toEqual(['flow-1'])

    const deleted = await harness.invoke({ type: 'GROUP_ORCHESTRATION_FLOW_DELETE', chatId: 'chat-1', flowId: 'flow-1' }) as { ok: boolean; store: OpenTeamStore }

    expect(deleted.ok).toBe(true)
    expect(deleted.store.orchestrationFlowsById['flow-1']).toBeUndefined()
    expect(deleted.store.orchestrationFlowOrderByChatId['chat-1']).toEqual([])
  })

  it('runs with submitted flow draft stages instead of requiring a flowId', async () => {
    const store = makeStore(['role-1', 'role-2'])
    store.orchestrationFlowsById['flow-1'] = makeFlow('chat-1', ['role-1'])
    store.orchestrationFlowOrderByChatId['chat-1'] = ['flow-1']
    const harness = await setupBackground(store)
    await harness.invoke({ type: 'TEAM_FRAME_ROLE_READY', chatId: 'chat-1', roleId: 'role-1' }, { tab: { id: 101 } as chrome.tabs.Tab, frameId: 1, url: 'https://gemini.google.com/app/one' })
    await harness.invoke({ type: 'TEAM_FRAME_ROLE_READY', chatId: 'chat-1', roleId: 'role-2' }, { tab: { id: 102 } as chrome.tabs.Tab, frameId: 2, url: 'https://gemini.google.com/app/two' })
    const draft = makeFlow('chat-1', ['role-2'])
    draft.stages[0].id = 'draft-stage'
    draft.stages[0].name = 'Draft stage'

    const started = await harness.invoke({ type: 'GROUP_ORCHESTRATION_RUN', chatId: 'chat-1', task: 'Use draft', flow: draft }) as { ok: boolean; run: { id: string }; store: OpenTeamStore }

    expect(started.ok).toBe(true)
    expect(promptCalls(harness.tabsSendMessage)).toHaveLength(1)
    expect(promptCalls(harness.tabsSendMessage)[0][1]).toMatchObject({ roleId: 'role-2' })
    const latestStore = await harness.getStore()
    expect(latestStore.orchestrationFlowsById['flow-1'].stages).toEqual(draft.stages)
    expect(latestStore.orchestrationRunsById[started.run.id].stageRuns[0]).toMatchObject({ stageId: 'draft-stage' })
  })

  it('auto-generates a flow draft using existing roles and requested temporary role sites', async () => {
    const store = makeStore(['role-existing'])
    store.settings.externalModelOrder = ['planner']
    store.settings.externalModelsById.planner = { id: 'planner', name: 'Planner', format: 'openai', baseUrl: 'https://api.example.test/v1', apiKey: 'key', modelName: 'planner-model', createdAt: 1, updatedAt: 1 }
    store.rolesById['role-existing'].name = '产品经理'
    store.rolesById['role-existing'].chatSite = 'chatgpt'
    const modelOutput = JSON.stringify({
      flowName: '自动文章流程',
      maxNodeExecutions: 30,
      roles: [
        { key: 'pm', reuseRoleId: 'role-existing', name: '产品经理', preferredSite: 'ChatGPT' },
        { key: 'writer', name: '写手', description: '负责正文写作', systemPrompt: '你负责写清楚正文。', site: 'ChatGPT' },
        { key: 'reviewer', name: '审核员', description: '负责质量审核', systemPrompt: '你负责判断是否通过。', chatSite: 'Claude' },
      ],
      nodes: [
        { id: 'plan', kind: 'execute', roleKeys: ['pm'], title: '规划', instruction: '拆解目标' },
        { id: 'write', kind: 'execute', roleKeys: ['writer'], title: '写作', instruction: '完成初稿' },
        { id: 'review', kind: 'review', roleKeys: ['reviewer'], title: '审核', instruction: '判断质量', review: { criteria: '必须可交付', maxAttempts: 3, onMaxAttempts: 'stop' } },
      ],
      edges: [
        { from: 'plan', to: 'write' },
        { from: 'write', to: 'review' },
        { from: 'review', to: 'write', branch: 'fail' },
      ],
    })
    const harness = await setupBackground(store, modelOutput)

    const generated = await harness.invoke({ type: 'GROUP_ORCHESTRATION_AUTO_GENERATE', chatId: 'chat-1', task: '写一篇文章', flowId: 'flow-existing' }) as { ok: boolean; flow: OrchestrationFlow; store: OpenTeamStore; createdRoleIds: string[]; reusedRoleIds: string[] }

    expect(generated.ok).toBe(true)
    expect(harness.externalComplete).toHaveBeenCalledTimes(1)
    expect(generated.createdRoleIds).toHaveLength(2)
    expect(generated.reusedRoleIds).toEqual(['role-existing'])
    expect(generated.createdRoleIds.map(roleId => generated.store.rolesById[roleId].chatSite)).toEqual(['chatgpt', 'claude'])
    expect(generated.createdRoleIds.map(roleId => generated.store.rolesById[roleId].createdBy)).toEqual(['orchestration-auto', 'orchestration-auto'])
    expect(generated.flow.id).toBe('flow-existing')
    expect(generated.flow.stages.map(stage => stage.id)).toEqual(['stage-plan', 'stage-write', 'stage-review'])
    expect(generated.flow.stages[0]).toMatchObject({ kind: 'roles', roleIds: ['role-existing'], description: '拆解目标' })
    expect(generated.flow.stages[2].review).toMatchObject({ instructions: '必须可交付', maxAttempts: 3, onMaxAttempts: 'stop' })
    expect(generated.flow.graph?.edges).toEqual([
      { sourceStageId: 'stage-plan', targetStageId: 'stage-write' },
      { sourceStageId: 'stage-write', targetStageId: 'stage-review' },
      { sourceStageId: 'stage-review', targetStageId: 'stage-write', sourcePort: 'fail' },
    ])
    expect(generated.store.orchestrationFlowsById['flow-existing']).toEqual(generated.flow)
    expect(generated.store.orchestrationFlowOrderByChatId['chat-1']).toContain('flow-existing')
  })

  it('honors explicit site changes for reused site roles and persists auto chat history', async () => {
    const store = makeStore(['role-existing'])
    store.settings.externalModelOrder = ['planner']
    store.settings.externalModelsById.planner = { id: 'planner', name: 'Planner', format: 'openai', baseUrl: 'https://api.example.test/v1', apiKey: 'key', modelName: 'planner-model', createdAt: 1, updatedAt: 1 }
    store.rolesById['role-existing'].name = '写手'
    store.rolesById['role-existing'].chatSite = 'deepseek'
    const modelOutput = JSON.stringify({
      flowName: '切换站点流程',
      maxNodeExecutions: 10,
      roles: [
        { key: 'writer', reuseRoleId: 'role-existing', name: '写手', site: 'ChatGPT' },
      ],
      nodes: [
        { id: 'write', kind: 'execute', roleKeys: ['writer'], title: '写作', instruction: '用 ChatGPT 写作' },
      ],
      edges: [],
    })
    const harness = await setupBackground(store, modelOutput)

    const generated = await harness.invoke({ type: 'GROUP_ORCHESTRATION_AUTO_GENERATE', chatId: 'chat-1', task: '写一篇文章', instruction: '把写手切到 ChatGPT' }) as { ok: boolean; flow: OrchestrationFlow; store: OpenTeamStore; createdRoleIds: string[]; reusedRoleIds: string[] }

    expect(generated.ok).toBe(true)
    expect(generated.createdRoleIds).toEqual([])
    expect(generated.reusedRoleIds).toEqual(['role-existing'])
    expect(generated.store.rolesById['role-existing'].chatSite).toBe('chatgpt')
    expect(generated.store.orchestrationFlowsById[generated.flow.id]).toEqual(generated.flow)
    expect(generated.store.orchestrationFlowOrderByChatId['chat-1']).toContain(generated.flow.id)
    expect(generated.flow.autoPlanHistory?.map(entry => entry.role)).toEqual(['user', 'assistant'])
    expect(generated.flow.autoPlanHistory?.[0]?.content).toBe('把写手切到 ChatGPT')
  })

  it('streams automatic orchestration model output to the team page', async () => {
    const store = makeStore([])
    store.settings.externalModelOrder = ['planner']
    store.settings.externalModelsById.planner = { id: 'planner', name: 'Planner', format: 'openai', baseUrl: 'https://api.example.test/v1', apiKey: 'key', modelName: 'planner-model', createdAt: 1, updatedAt: 1 }
    const modelOutput = JSON.stringify({
      flowName: '流式编排流程',
      maxNodeExecutions: 20,
      roles: [
        { key: 'pm', name: '产品经理', description: '负责拆解需求', systemPrompt: '你负责产品规划。', preferredSite: 'gemini' },
        { key: 'writer', name: '写手', description: '负责写作', systemPrompt: '你负责写作。', preferredSite: 'chatgpt' },
      ],
      nodes: [
        { id: 'plan', kind: 'execute', roleKeys: ['pm'], title: '需求拆解', instruction: '拆解需求' },
        { id: 'write', kind: 'execute', roleKeys: ['writer'], title: '写作', instruction: '完成初稿' },
      ],
      edges: [{ from: 'plan', to: 'write' }],
    })
    const streamChunks = [modelOutput.slice(0, 32), modelOutput.slice(32)]
    const harness = await setupBackground(store, modelOutput, streamChunks)

    const generated = await harness.invoke({ type: 'GROUP_ORCHESTRATION_AUTO_GENERATE', chatId: 'chat-1', task: '写一篇文章', streamId: 'auto-stream-1' }) as { ok: boolean; flow: OrchestrationFlow }

    expect(generated.ok).toBe(true)
    expect(harness.externalStream).toHaveBeenCalledTimes(1)
    expect(harness.externalComplete).not.toHaveBeenCalled()
    const streamMessages = harness.runtimeSendMessage.mock.calls
      .map(call => call[0])
      .filter((message): message is { type: string; streamId: string; chunk: string; content: string } => message?.type === 'GROUP_ORCHESTRATION_AUTO_STREAM_CHUNK')
    expect(streamMessages.map(message => message.chunk)).toEqual(streamChunks)
    expect(streamMessages.map(message => message.content)).toEqual([streamChunks[0], modelOutput])
    expect(generated.flow.autoPlanHistory?.map(entry => entry.role)).toEqual(['user', 'assistant'])
    expect(generated.flow.autoPlanHistory?.[1]?.content).toBe(modelOutput)
  })

  it('auto-generates roles with mixed supported sites for an empty chat', async () => {
    const store = makeStore([])
    store.chatsById['chat-1'].status = 'draft'
    store.settings.externalModelOrder = ['planner']
    store.settings.externalModelsById.planner = { id: 'planner', name: 'Planner', format: 'openai', baseUrl: 'https://api.example.test/v1', apiKey: 'key', modelName: 'planner-model', createdAt: 1, updatedAt: 1 }
    const modelOutput = JSON.stringify({
      flowName: '空群聊自动流程',
      maxNodeExecutions: 20,
      roles: [
        { key: 'pm', name: '产品经理', description: '负责拆解需求', systemPrompt: '你负责产品规划。', preferredSite: 'gemini' },
        { key: 'engineer', name: '工程师', description: '负责技术判断', systemPrompt: '你负责技术可行性。', preferredSite: 'claude' },
      ],
      nodes: [
        { id: 'plan', kind: 'execute', roleKeys: ['pm'], title: '需求拆解', instruction: '拆解需求' },
        { id: 'tech', kind: 'execute', roleKeys: ['engineer'], title: '技术判断', instruction: '判断技术方案' },
      ],
      edges: [{ from: 'plan', to: 'tech' }],
    })
    const harness = await setupBackground(store, modelOutput)

    const generated = await harness.invoke({ type: 'GROUP_ORCHESTRATION_AUTO_GENERATE', chatId: 'chat-1', task: '做一个方案' }) as { ok: boolean; flow: OrchestrationFlow; store: OpenTeamStore; createdRoleIds: string[]; reusedRoleIds: string[] }

    expect(generated.ok).toBe(true)
    expect(generated.reusedRoleIds).toEqual([])
    expect(generated.createdRoleIds).toHaveLength(2)
    expect(generated.createdRoleIds.map(roleId => generated.store.rolesById[roleId].chatSite)).toEqual(['gemini', 'claude'])
    expect(generated.createdRoleIds.map(roleId => generated.store.rolesById[roleId].createdBy)).toEqual(['orchestration-auto', 'orchestration-auto'])
    expect(generated.store.chatsById['chat-1'].roleIds).toEqual(generated.createdRoleIds)
    expect(generated.flow.stages.map(stage => stage.roleIds[0])).toEqual(generated.createdRoleIds)
  })

  it('auto-modifies from current flow and history while updating generated role prompts', async () => {
    const store = makeStore(['role-auto'])
    store.settings.externalModelOrder = ['planner']
    store.settings.externalModelsById.planner = { id: 'planner', name: 'Planner', format: 'openai', baseUrl: 'https://api.example.test/v1', apiKey: 'key', modelName: 'planner-model', createdAt: 1, updatedAt: 1 }
    store.rolesById['role-auto'].name = '写手'
    store.rolesById['role-auto'].createdBy = 'orchestration-auto'
    store.rolesById['role-auto'].chatSite = 'deepseek'
    store.rolesById['role-auto'].systemPrompt = '旧写作人设'
    const currentFlow = makeFlow('chat-1', ['role-auto'])
    currentFlow.autoPlanHistory = [
      { id: 'auto-history-1', role: 'user', content: '先写草稿', createdAt: 1 },
      { id: 'auto-history-2', role: 'assistant', content: '已生成写作节点', createdAt: 2 },
    ]
    const modelOutput = JSON.stringify({
      flowName: '修改后的文章流程',
      maxNodeExecutions: 20,
      roles: [
        { key: 'writer', reuseRoleId: 'role-auto', name: '写手', description: '负责初稿和修改', systemPrompt: '新的写作人设', preferredSite: 'deepseek' },
      ],
      nodes: [
        { id: 'write', kind: 'execute', roleKeys: ['writer'], title: '写作', instruction: '按反馈修改' },
      ],
      edges: [],
    })
    const harness = await setupBackground(store, modelOutput)

    const generated = await harness.invoke({
      type: 'GROUP_ORCHESTRATION_AUTO_GENERATE',
      chatId: 'chat-1',
      task: '写文章',
      instruction: '把写手人设改得更像财经编辑',
      flowId: 'flow-1',
      flow: currentFlow,
      history: currentFlow.autoPlanHistory,
    }) as { ok: boolean; flow: OrchestrationFlow; store: OpenTeamStore; createdRoleIds: string[]; reusedRoleIds: string[] }

    expect(generated.ok).toBe(true)
    const externalCalls = harness.externalComplete.mock.calls as unknown as Array<[{ prompt: string }]>
    const prompt = externalCalls[0]?.[0].prompt ?? ''
    expect(prompt).toContain('把写手人设改得更像财经编辑')
    expect(prompt).toContain('currentFlow')
    expect(prompt).toContain('已生成写作节点')
    expect(generated.createdRoleIds).toEqual([])
    expect(generated.reusedRoleIds).toEqual(['role-auto'])
    expect(generated.store.rolesById['role-auto']).toMatchObject({ description: '负责初稿和修改', systemPrompt: '新的写作人设' })
    expect(generated.flow.autoPlanHistory?.map(entry => entry.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    const generatedHistory = generated.flow.autoPlanHistory ?? []
    expect(generatedHistory[generatedHistory.length - 2]?.content).toBe('把写手人设改得更像财经编辑')
    expect(generatedHistory[generatedHistory.length - 1]?.content).toContain('修改后的文章流程')
  })
})

function makeStore(roleIds: string[] = ['role-1']): OpenTeamStore {
  return {
    version: 5,
    chatOrder: ['chat-1'],
    chatsById: { 'chat-1': makeChat('chat-1', roleIds) },
    rolesById: Object.fromEntries(roleIds.map(roleId => [roleId, makeRole('chat-1', roleId)])),
    messagesById: {},
    roleTemplateOrder: [],
    roleTemplatesById: {},
    orchestrationFlowsById: {},
    orchestrationFlowOrderByChatId: {},
    orchestrationRunsById: {},
    activeOrchestrationRunIdByChatId: {},
    settings: { defaultMode: 'independent', maxContextChars: 6000, defaultChatSite: 'gemini', externalModelOrder: [], externalModelsById: {}, agentControlEnabled: false, agentControlPort: 19305, language: 'en' },
  }
}

function makeChat(id: string, roleIds: string[] = []): GroupChat {
  return { id, name: id, mode: 'independent', roleIds, messageIds: [], nextMessageSeq: 1, status: 'ready', createdAt: 1, updatedAt: 1 }
}

function makeRole(chatId: string, id: string): GroupRole {
  return { id, chatId, name: id, status: 'ready', contextCursor: 0, createdAt: 1, updatedAt: 1 }
}

function promptCalls(mock: ReturnType<typeof vi.fn>): Array<[number, { type?: string; roleId: string; messageId: string }, { frameId: number }]> {
  return mock.mock.calls.filter(call => call[1]?.type === 'TEAM_SEND_PROMPT') as Array<[number, { type?: string; roleId: string; messageId: string }, { frameId: number }]>
}

function makeFlow(chatId: string, roleIds: string[] = ['role-1']): OrchestrationFlow {
  return { id: 'flow-1', chatId, name: 'Flow', stages: [{ id: 'stage-1', kind: 'roles', name: 'Build', roleIds }], maxRounds: 1, createdAt: 1, updatedAt: 1 }
}
