// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import type { OrchestrationGraphSnapshot, OrchestrationStage } from '../group/types'
import { arrangeOrchestrationGraph, createOrchestrationCanvas } from './orchestrationCanvas'

interface MockEdgeEvent {
  getSourceCellId?: () => string | undefined
  getTargetCellId?: () => string | undefined
  getSourcePortId?: () => string | undefined
  getTargetPortId?: () => string | undefined
  getSource?: () => unknown
  getTarget?: () => unknown
  getVertices?: () => Array<{ x?: number; y?: number }>
}

class MockGraph {
  static instances: MockGraph[] = []
  static emitGraphEventsDuringFromJSON = false
  nodes: unknown[] = []
  edges: unknown[] = []
  fromJSONCalls = 0
  disposed = false
  handlers = new Map<string, (args: { node?: { getData(): Record<string, unknown> }; edge?: MockEdgeEvent }) => void>()

  constructor(public options: Record<string, unknown>) {
    MockGraph.instances.push(this)
  }

  clearCells(): void {
    this.nodes = []
    this.edges = []
  }

  addNode(node: unknown): unknown {
    this.nodes.push(node)
    return node
  }

  addEdge(edge: unknown): unknown {
    this.edges.push(edge)
    return edge
  }

  fromJSON(data: { nodes?: unknown[]; edges?: unknown[] }): void {
    this.fromJSONCalls += 1
    if (MockGraph.emitGraphEventsDuringFromJSON) {
      this.handlers.get('edge:removed')?.({ edge: { getSourceCellId: () => 'stage-1', getTargetCellId: () => 'review-1' } })
      this.handlers.get('edge:connected')?.({ edge: { getSourceCellId: () => 'stage-1', getTargetCellId: () => 'review-1' } })
    }
    this.nodes = data.nodes ?? []
    this.edges = data.edges ?? []
  }

  on(eventName: string, handler: (args: { node?: { getData(): Record<string, unknown> }; edge?: MockEdgeEvent }) => void): void {
    this.handlers.set(eventName, handler)
  }

  dispose(): void {
    this.disposed = true
  }
}

const stages: OrchestrationStage[] = [
  { id: 'stage-1', kind: 'roles', name: '分析', roleIds: ['role-1', 'role-2'] },
  { id: 'review-1', kind: 'review', name: '审核', roleIds: ['role-3'], review: { reviewerRoleIds: ['role-3'], instructions: '必须完整' } },
]

describe('orchestration canvas', () => {
  it('arranges branched and review-loop graphs into readable lanes', () => {
    const branchStages: OrchestrationStage[] = [
      { id: 'stage-a', kind: 'roles', name: '需求', roleIds: ['role-1'] },
      { id: 'stage-b', kind: 'roles', name: '工程', roleIds: ['role-2'] },
      { id: 'stage-c', kind: 'roles', name: '设计', roleIds: ['role-3'] },
      { id: 'review-1', kind: 'review', name: '审核', roleIds: ['role-4'], review: { reviewerRoleIds: ['role-4'], instructions: '检查' } },
      { id: 'stage-d', kind: 'roles', name: '发布', roleIds: ['role-5'] },
    ]
    const graphEdges: OrchestrationGraphSnapshot['edges'] = [
      { sourceStageId: 'stage-a', targetStageId: 'stage-b' },
      { sourceStageId: 'stage-a', targetStageId: 'stage-c' },
      { sourceStageId: 'stage-b', targetStageId: 'review-1' },
      { sourceStageId: 'stage-c', targetStageId: 'review-1' },
      { sourceStageId: 'review-1', targetStageId: 'stage-d', sourcePort: 'pass' },
      { sourceStageId: 'review-1', targetStageId: 'stage-a', sourcePort: 'fail', vertices: [{ x: 1, y: 1 }] },
    ]

    const arranged = arrangeOrchestrationGraph(branchStages, graphEdges)
    const byId = new Map(arranged.stages.map(stage => [stage.id, stage]))

    expect(byId.get('stage-a')?.position?.x).toBeLessThan(byId.get('stage-b')?.position?.x ?? 0)
    expect(byId.get('stage-b')?.position?.x).toBe(byId.get('stage-c')?.position?.x)
    expect(byId.get('stage-b')?.position?.y).not.toBe(byId.get('stage-c')?.position?.y)
    expect(byId.get('review-1')?.position?.x).toBeGreaterThan(byId.get('stage-b')?.position?.x ?? 0)
    expect(byId.get('stage-d')?.position?.x).toBeGreaterThan(byId.get('review-1')?.position?.x ?? 0)
    expect(nodeCenterY(byId.get('stage-b')!, false)).toBe(nodeCenterY(byId.get('review-1')!, true))
    expect(nodeCenterY(byId.get('review-1')!, true)).toBe(nodeCenterY(byId.get('stage-d')!, false))
    expect(arranged.edges.find(edge => edge.sourcePort === 'pass')?.vertices).toBeUndefined()
    expect(arranged.edges.find(edge => edge.sourcePort === 'fail')?.vertices).toEqual([
      { x: 468, y: 237 },
      { x: 12, y: 237 },
    ])
  })

  it('loads X6 through the injected dynamic loader and renders one node per stage', async () => {
    MockGraph.instances = []
    const rootEl = document.createElement('div')
    const loadX6 = vi.fn(async () => ({ Graph: MockGraph }))
    const onStageSelected = vi.fn()
    const canvas = createOrchestrationCanvas({
      rootEl,
      getRoleName: roleId => ({ 'role-1': '产品', 'role-2': '工程', 'role-3': '评审' })[roleId] ?? roleId,
      getRoleSiteLabel: roleId => ({ 'role-1': 'ChatGPT', 'role-3': 'API · Claude' })[roleId] ?? 'Gemini',
      onStageSelected,
      onRoleDropped: vi.fn(),
      loadX6,
    })

    await canvas.mount(stages, 'stage-1')

    expect(loadX6).toHaveBeenCalledTimes(1)
    expect(MockGraph.instances[0].options.container).toBe(rootEl)
    expect(MockGraph.instances[0].options.interacting).toEqual(expect.objectContaining({
      edgeMovable: true,
      arrowheadMovable: true,
      vertexMovable: true,
    }))
    expect(MockGraph.instances[0].options.connecting).toEqual(expect.objectContaining({
      connector: { name: 'normal' },
      router: { name: 'manhattan' },
    }))
    expect(MockGraph.instances[0].fromJSONCalls).toBe(1)
    expect(MockGraph.instances[0].nodes).toHaveLength(2)
    expect(MockGraph.instances[0].edges).toHaveLength(0)
    expect(MockGraph.instances[0].nodes[0]).toEqual(expect.objectContaining({
      shape: 'rect',
      width: 124,
      height: 56,
      label: expect.stringContaining('ChatGPT'),
    }))
    expect((MockGraph.instances[0].nodes[0] as { attrs?: { body?: { fill?: string }; label?: { fill?: string } } }).attrs?.body?.fill).toBe('var(--orchestration-node-bg)')
    expect((MockGraph.instances[0].nodes[0] as { attrs?: { body?: { fill?: string }; label?: { fill?: string } } }).attrs?.label?.fill).toBe('var(--orchestration-node-text)')
    expect((MockGraph.instances[0].nodes[0] as { label?: string }).label).not.toContain('▸')
    expect((MockGraph.instances[0].nodes[0] as { label?: string }).label).not.toContain('执行')
    expect(MockGraph.instances[0].nodes[1]).toEqual(expect.objectContaining({
      shape: 'polygon',
      width: 104,
      height: 78,
    }))
    expect((MockGraph.instances[0].nodes[1] as { ports?: { items?: Array<{ id: string; group: string }> } }).ports?.items).toEqual([
      { id: 'in', group: 'in' },
      { id: 'pass', group: 'pass' },
      { id: 'fail', group: 'fail' },
    ])
    expect((MockGraph.instances[0].nodes[1] as { label?: string }).label).toContain('API · Claude')
    expect((MockGraph.instances[0].nodes[1] as { label?: string }).label).not.toContain('审核')
    expect((MockGraph.instances[0].nodes[1] as { attrs?: { body?: { refPoints?: string } } }).attrs?.body?.refPoints).toBe('0,10 10,0 20,10 10,20')
    MockGraph.instances[0].handlers.get('node:click')?.({ node: { getData: () => ({ stageId: 'review-1' }) } })
    expect(onStageSelected).toHaveBeenCalledWith('review-1')
  })

  it('renders a debate node with a judge and out-only port', async () => {
    MockGraph.instances = []
    const rootEl = document.createElement('div')
    const canvas = createOrchestrationCanvas({
      rootEl,
      getRoleName: roleId => ({ 'role-1': '正方', 'role-2': '反方', 'role-3': '裁判' })[roleId] ?? roleId,
      getRoleSiteLabel: () => '',
      onStageSelected: vi.fn(),
      onRoleDropped: vi.fn(),
      loadX6: async () => ({ Graph: MockGraph }),
    })

    await canvas.mount([{
      id: 'debate-1',
      kind: 'debate',
      name: '正反辩论',
      roleIds: ['role-1', 'role-2'],
      debate: { judgeRoleId: 'role-3', rounds: 2, instructions: '必须回应成本' },
    }])

    const node = MockGraph.instances[0].nodes[0] as {
      shape?: string
      width?: number
      height?: number
      label?: string
      ports?: { items?: Array<{ id: string; group: string }> }
    }
    expect(node).toEqual(expect.objectContaining({ shape: 'rect', width: 150, height: 72 }))
    expect(node.label).toContain('辩论')
    expect(node.label).toContain('正方 + 反方')
    expect(node.label).toContain('裁判 · 裁判')
    expect(node.ports?.items).toEqual([
      { id: 'in', group: 'in' },
      { id: 'out', group: 'out' },
    ])
  })

  it('renders graph edges and reports dragged connections back to the draft', async () => {
    MockGraph.instances = []
    const rootEl = document.createElement('div')
    const onGraphChanged = vi.fn()
    const canvas = createOrchestrationCanvas({
      rootEl,
      getRoleName: roleId => roleId,
      onStageSelected: vi.fn(),
      onRoleDropped: vi.fn(),
      onGraphChanged,
      loadX6: async () => ({ Graph: MockGraph }),
    })
    const graphEdges: OrchestrationGraphSnapshot['edges'] = [{ sourceStageId: 'stage-1', targetStageId: 'review-1' }]

    await canvas.mount(stages, undefined, graphEdges)

    expect(MockGraph.instances[0].edges).toEqual([
      expect.objectContaining({
        source: expect.objectContaining({ cell: 'stage-1' }),
        target: expect.objectContaining({ cell: 'review-1' }),
        labels: undefined,
        tools: expect.objectContaining({
          name: 'edge-tools',
          items: [expect.objectContaining({ name: 'vertices' })],
        }),
        attrs: expect.objectContaining({
          line: expect.objectContaining({
            targetMarker: { name: 'classic', width: 5, height: 4 },
          }),
        }),
        connector: { name: 'normal' },
        router: { name: 'manhattan' },
      }),
    ])
    MockGraph.instances[0].handlers.get('edge:connected')?.({
      edge: {
        getSource: () => ({ cell: 'review-1', port: 'fail' }),
        getTarget: () => ({ cell: 'stage-1', port: 'in' }),
      },
    })
    expect(onGraphChanged).toHaveBeenLastCalledWith([
      { sourceStageId: 'stage-1', targetStageId: 'review-1' },
      { sourceStageId: 'review-1', targetStageId: 'stage-1', sourcePort: 'fail', targetPort: 'in' },
    ])
  })

  it('reports edge vertex drags so bent lines persist with the draft', async () => {
    MockGraph.instances = []
    const rootEl = document.createElement('div')
    const onGraphChanged = vi.fn()
    const canvas = createOrchestrationCanvas({
      rootEl,
      getRoleName: roleId => roleId,
      onStageSelected: vi.fn(),
      onRoleDropped: vi.fn(),
      onGraphChanged,
      loadX6: async () => ({ Graph: MockGraph }),
    })

    await canvas.mount(stages, undefined, [{ sourceStageId: 'stage-1', targetStageId: 'review-1' }])
    MockGraph.instances[0].handlers.get('edge:change:vertices')?.({
      edge: {
        getSource: () => ({ cell: 'stage-1', port: 'out' }),
        getTarget: () => ({ cell: 'review-1', port: 'in' }),
        getVertices: () => [{ x: 148, y: 96 }, { x: 196, y: 132 }],
      },
    })

    expect(onGraphChanged).toHaveBeenLastCalledWith([
      {
        sourceStageId: 'stage-1',
        targetStageId: 'review-1',
        sourcePort: 'out',
        targetPort: 'in',
        vertices: [{ x: 148, y: 96 }, { x: 196, y: 132 }],
      },
    ])
  })

  it('renders saved bent edges with the same orthogonal X6 style', async () => {
    MockGraph.instances = []
    const rootEl = document.createElement('div')
    const canvas = createOrchestrationCanvas({
      rootEl,
      getRoleName: roleId => roleId,
      onStageSelected: vi.fn(),
      onRoleDropped: vi.fn(),
      loadX6: async () => ({ Graph: MockGraph }),
    })

    await canvas.mount(stages, undefined, [{
      sourceStageId: 'review-1',
      targetStageId: 'stage-1',
      sourcePort: 'fail',
      vertices: [{ x: 170, y: 220 }, { x: 40, y: 220 }],
    }])

    expect(MockGraph.instances[0].edges).toEqual([
      expect.objectContaining({
        connector: { name: 'normal' },
        router: { name: 'manhattan' },
        vertices: [{ x: 170, y: 220 }, { x: 40, y: 220 }],
      }),
    ])
  })

  it('labels review outgoing edges from their explicit pass and fail ports', async () => {
    MockGraph.instances = []
    const rootEl = document.createElement('div')
    const canvas = createOrchestrationCanvas({
      rootEl,
      getRoleName: roleId => roleId,
      onStageSelected: vi.fn(),
      onRoleDropped: vi.fn(),
      loadX6: async () => ({ Graph: MockGraph }),
    })
    const branchStages: OrchestrationStage[] = [
      { id: 'stage-1', kind: 'roles', name: 'Build', roleIds: ['role-1'] },
      { id: 'review-1', kind: 'review', name: 'Review', roleIds: ['role-2'], review: { reviewerRoleIds: ['role-2'], instructions: 'Check' } },
      { id: 'stage-2', kind: 'roles', name: 'Ship', roleIds: ['role-3'] },
    ]

    await canvas.mount(branchStages, undefined, [
      { sourceStageId: 'review-1', targetStageId: 'stage-1', sourcePort: 'pass' },
      { sourceStageId: 'review-1', targetStageId: 'stage-2', sourcePort: 'fail' },
    ])

    expect(MockGraph.instances[0].edges).toEqual([
      expect.objectContaining({
        source: expect.objectContaining({ cell: 'review-1', port: 'pass' }),
        attrs: expect.objectContaining({ line: expect.objectContaining({ stroke: 'var(--orchestration-edge)', strokeWidth: 1.3, strokeDasharray: undefined }) }),
        labels: [expect.objectContaining({ attrs: expect.objectContaining({ label: expect.objectContaining({ text: '通过', fontSize: 9 }) }) })],
      }),
      expect.objectContaining({
        source: expect.objectContaining({ cell: 'review-1', port: 'fail' }),
        attrs: expect.objectContaining({ line: expect.objectContaining({ stroke: 'var(--orchestration-edge)', strokeWidth: 1.3, strokeDasharray: undefined }) }),
        labels: [expect.objectContaining({ attrs: expect.objectContaining({ label: expect.objectContaining({ text: '不通过', fontSize: 9 }) }) })],
      }),
    ])
  })

  it('replaces graph content on repeated renders instead of duplicating cells', async () => {
    MockGraph.instances = []
    const rootEl = document.createElement('div')
    const canvas = createOrchestrationCanvas({
      rootEl,
      getRoleName: roleId => roleId,
      onStageSelected: vi.fn(),
      onRoleDropped: vi.fn(),
      loadX6: async () => ({ Graph: MockGraph }),
    })

    await canvas.mount(stages, 'stage-1')
    canvas.render(stages, 'review-1')
    canvas.render(stages, 'stage-1')

    expect(MockGraph.instances[0].fromJSONCalls).toBe(3)
    expect(MockGraph.instances[0].nodes).toHaveLength(2)
    expect(MockGraph.instances[0].edges).toHaveLength(0)
  })

  it('does not report graph change events caused by programmatic rerenders', async () => {
    MockGraph.instances = []
    MockGraph.emitGraphEventsDuringFromJSON = true
    const rootEl = document.createElement('div')
    const onGraphChanged = vi.fn()
    const canvas = createOrchestrationCanvas({
      rootEl,
      getRoleName: roleId => roleId,
      onStageSelected: vi.fn(),
      onRoleDropped: vi.fn(),
      onGraphChanged,
      loadX6: async () => ({ Graph: MockGraph }),
    })

    await canvas.mount(stages, undefined, [{ sourceStageId: 'stage-1', targetStageId: 'review-1' }])
    canvas.render(stages, 'stage-1', [{ sourceStageId: 'stage-1', targetStageId: 'review-1' }])

    expect(onGraphChanged).not.toHaveBeenCalled()
    MockGraph.emitGraphEventsDuringFromJSON = false
  })

  it('handles role drops and disposes X6 graph on destroy', async () => {
    MockGraph.instances = []
    const rootEl = document.createElement('div')
    const onRoleDropped = vi.fn()
    const canvas = createOrchestrationCanvas({
      rootEl,
      getRoleName: roleId => roleId,
      onStageSelected: vi.fn(),
      onRoleDropped,
      loadX6: async () => ({ Graph: MockGraph }),
    })
    await canvas.mount(stages)

    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', { value: { getData: () => 'role-4' } })
    rootEl.dispatchEvent(drop)

    expect(onRoleDropped).toHaveBeenCalledWith('role-4', undefined)
    canvas.destroy()
    expect(MockGraph.instances[0].disposed).toBe(true)
  })
})

function nodeCenterY(stage: OrchestrationStage, isReview: boolean): number | undefined {
  if (!stage.position) return undefined
  return stage.position.y + (isReview ? 78 : 56) / 2
}
