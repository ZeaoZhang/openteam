import type { GroupRole, OrchestrationGraphSnapshot, OrchestrationStage } from '../group/types'

const ROLE_NODE_WIDTH = 124
const ROLE_NODE_HEIGHT = 56
const DEBATE_NODE_WIDTH = 150
const DEBATE_NODE_HEIGHT = 72
const REVIEW_NODE_WIDTH = 104
const REVIEW_NODE_HEIGHT = 78
const DEFAULT_NODE_CENTER_Y = 100
const ARRANGED_NODE_CENTER_Y = 124
const LANE_GAP = 112

interface X6GraphNode {
  id?: string
  shape?: string
  x?: number
  y?: number
  width?: number
  height?: number
  label?: string
  data?: Record<string, unknown>
  attrs?: Record<string, unknown>
  ports?: Record<string, unknown>
}

interface X6GraphNodeCell {
  getData?: () => Record<string, unknown>
  attr?: (path: string, value: unknown) => void
}

interface X6GraphEdge {
  id?: string
  shape?: string
  source: string | { cell: string; port?: string }
  target: string | { cell: string; port?: string }
  vertices?: Array<{ x: number; y: number }>
  connector?: Record<string, unknown>
  router?: Record<string, unknown>
  attrs?: Record<string, unknown>
  labels?: Array<Record<string, unknown>>
  tools?: Record<string, unknown>
}

interface X6GraphData {
  nodes: X6GraphNode[]
  edges: X6GraphEdge[]
}

interface X6GraphCell {
  id?: string
}

interface X6GraphConnectionArgs {
  sourceCell?: X6GraphCell
  targetCell?: X6GraphCell
  sourcePort?: string
  targetPort?: string
}

interface X6GraphEdgeEvent {
  getSourceCellId?: () => string | undefined
  getTargetCellId?: () => string | undefined
  getSourcePortId?: () => string | undefined
  getTargetPortId?: () => string | undefined
  getSource?: () => unknown
  getTarget?: () => unknown
  getVertices?: () => unknown
}

interface X6Graph {
  clearCells(): void
  addNode(node: X6GraphNode): unknown
  addEdge(edge: X6GraphEdge): unknown
  getNodes?(): X6GraphNodeCell[]
  fromJSON?(data: X6GraphData): unknown
  on(eventName: string, handler: (args: { node?: { getData(): Record<string, unknown> }; edge?: X6GraphEdgeEvent }) => void): void
  dispose(): void
}

interface X6Module {
  Graph: new (options: Record<string, unknown>) => X6Graph
}

export type LoadX6 = () => Promise<X6Module>

export interface OrchestrationCanvasDependencies {
  rootEl: HTMLElement
  getRoleName(roleId: string): string
  getRoleSiteLabel?(roleId: string): string
  onStageSelected(stageId: string): void
  onRoleDropped(roleId: string, targetStageId?: string): void
  onGraphChanged?(edges: OrchestrationGraphSnapshot['edges']): void
  loadX6?: LoadX6
}

export interface OrchestrationCanvas {
  mount(stages: OrchestrationStage[], selectedStageId?: string, graphEdges?: OrchestrationGraphSnapshot['edges']): Promise<void>
  render(stages: OrchestrationStage[], selectedStageId?: string, graphEdges?: OrchestrationGraphSnapshot['edges']): void
  selectStage(stageId?: string): void
  destroy(): void
}

export function createOrchestrationCanvas(deps: OrchestrationCanvasDependencies): OrchestrationCanvas {
  let graph: X6Graph | undefined
  let destroyed = false
  let currentEdges: OrchestrationGraphSnapshot['edges'] = []
  let currentStages: OrchestrationStage[] = []
  let currentSelectedStageId: string | undefined
  let applyingGraphData = false
  const loadX6 = deps.loadX6 ?? (async () => await import('@antv/x6') as X6Module)

  const handleDragOver = (event: DragEvent): void => {
    if (!event.dataTransfer?.types.includes('application/x-openteam-role-id')) return
    event.preventDefault()
  }

  const handleDrop = (event: DragEvent): void => {
    const roleId = event.dataTransfer?.getData('application/x-openteam-role-id')
    if (!roleId) return
    event.preventDefault()
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-stage-id]') : undefined
    deps.onRoleDropped(roleId, target?.dataset.stageId)
  }

  async function mount(stages: OrchestrationStage[], selectedStageId?: string, graphEdges?: OrchestrationGraphSnapshot['edges']): Promise<void> {
    destroyed = false
    deps.rootEl.addEventListener('dragover', handleDragOver)
    deps.rootEl.addEventListener('drop', handleDrop)
    const { Graph } = await loadX6()
    if (destroyed) return
    graph = new Graph({
      container: deps.rootEl,
      autoResize: true,
      grid: { size: 18, visible: true, type: 'dot', args: { color: 'rgba(87, 216, 221, 0.14)' } },
      panning: true,
      mousewheel: { enabled: true, modifiers: ['ctrl', 'meta'] },
      interacting: {
        edgeMovable: true,
        arrowheadMovable: true,
        vertexMovable: true,
        toolsAddable: true,
      },
      connecting: {
        allowBlank: false,
        allowLoop: false,
        allowNode: true,
        allowMulti: false,
        highlight: true,
        snap: true,
        connector: orthogonalConnector(),
        router: orthogonalRouter(),
        validateConnection({ sourceCell, targetCell, sourcePort, targetPort }: X6GraphConnectionArgs) {
          if (!sourceCell?.id || !targetCell?.id || sourceCell.id === targetCell.id || (targetPort && targetPort !== 'in')) return false
          const sourceStage = currentStages.find(stage => stage.id === sourceCell.id)
          if (sourceStage?.kind === 'review') return sourcePort === 'pass' || sourcePort === 'fail'
          return sourcePort === 'out'
        },
      },
    })
    graph.on('node:click', ({ node }) => {
      const stageId = node?.getData().stageId
      if (typeof stageId === 'string') deps.onStageSelected(stageId)
    })
    graph.on('edge:connected', ({ edge }) => {
      if (applyingGraphData) return
      const nextEdge = readEdgeEvent(edge)
      if (!nextEdge) return
      currentEdges = uniqueEdges([...currentEdges, nextEdge])
      deps.onGraphChanged?.(currentEdges)
      render(currentStages, currentSelectedStageId, currentEdges)
    })
    graph.on('edge:removed', ({ edge }) => {
      if (applyingGraphData) return
      const removed = readEdgeEvent(edge)
      if (!removed) return
      currentEdges = currentEdges.filter(edgeItem => edgeKey(edgeItem) !== edgeKey(removed))
      deps.onGraphChanged?.(currentEdges)
      render(currentStages, currentSelectedStageId, currentEdges)
    })
    graph.on('edge:change:vertices', ({ edge }) => {
      if (applyingGraphData) return
      const changed = readEdgeEvent(edge)
      if (!changed) return
      const changedKey = edgeKey(changed)
      const existingIndex = currentEdges.findIndex(edgeItem => edgeKey(edgeItem) === changedKey)
      currentEdges = existingIndex >= 0
        ? currentEdges.map((edgeItem, index) => index === existingIndex ? changed : edgeItem)
        : uniqueEdges([...currentEdges, changed])
      deps.onGraphChanged?.(currentEdges)
    })
    render(stages, selectedStageId, graphEdges)
  }

  function render(stages: OrchestrationStage[], selectedStageId?: string, graphEdges?: OrchestrationGraphSnapshot['edges']): void {
    if (!graph) return
    currentStages = stages
    currentSelectedStageId = selectedStageId
    currentEdges = uniqueEdges(graphEdges ?? [])
    const data = buildGraphData(stages, selectedStageId, currentEdges, deps.getRoleName, deps.getRoleSiteLabel)
    applyingGraphData = true
    try {
      if (graph.fromJSON) {
        graph.fromJSON(data)
        return
      }
      graph.clearCells()
      for (const node of data.nodes) graph.addNode(node)
      for (const edge of data.edges) graph.addEdge(edge)
    } finally {
      applyingGraphData = false
    }
  }

  function selectStage(stageId?: string): void {
    if (!graph?.getNodes) return
    const stagesById = new Map(currentStages.map(stage => [stage.id, stage]))
    for (const node of graph.getNodes()) {
      const nodeStageId = node.getData?.().stageId
      if (typeof nodeStageId !== 'string') continue
      const stage = stagesById.get(nodeStageId)
      if (!stage) continue
      const style = nodeStyle(stageId === nodeStageId)
      node.attr?.('body/stroke', style.stroke)
      node.attr?.('body/strokeWidth', style.strokeWidth)
      node.attr?.('body/filter', style.filter)
    }
  }

  function buildGraphData(
    stages: OrchestrationStage[],
    selectedStageId: string | undefined,
    edges: OrchestrationGraphSnapshot['edges'],
    getRoleName: (roleId: string) => string,
    getRoleSiteLabel: ((roleId: string) => string) | undefined,
  ): X6GraphData {
    return {
      nodes: stages.map((stage, index) => {
        const roleNames = stage.roleIds.map(getRoleName)
        const roleLabel = parallelRoleLabel(roleNames)
        const firstSiteLabel = stage.roleIds[0] ? getRoleSiteLabel?.(stage.roleIds[0]).trim() : ''
        const siteLabel = stage.roleIds.length > 1
          ? `${firstSiteLabel ? `${firstSiteLabel} · ` : ''}${stage.roleIds.length} 人并行`
          : firstSiteLabel
        const isReview = stage.kind === 'review'
        const isDebate = stage.kind === 'debate'
        const selected = selectedStageId === stage.id
        const style = nodeStyle(selected)
        const fallbackPosition = defaultStagePosition(index, isReview, isDebate)
        const debateLabel = isDebate
          ? `辩论 · ${roleLabel}${stage.debate?.judgeRoleId ? `\n裁判 · ${getRoleName(stage.debate.judgeRoleId)}` : ''}`
          : undefined
        return {
          id: stage.id,
          shape: isReview ? 'polygon' : 'rect',
          x: stage.position?.x ?? fallbackPosition.x,
          y: stage.position?.y ?? fallbackPosition.y,
          width: nodeWidth(isReview, isDebate),
          height: nodeHeight(isReview, isDebate),
          label: debateLabel ?? `${roleLabel}${siteLabel ? `\n${siteLabel}` : ''}`,
          data: { stageId: stage.id },
          ports: {
            groups: {
              in: portGroup('left'),
              ...(isReview ? { pass: portGroup('right'), fail: portGroup('bottom') } : { out: portGroup('right') }),
            },
            items: isReview ? [
              { id: 'in', group: 'in' },
              { id: 'pass', group: 'pass' },
              { id: 'fail', group: 'fail' },
            ] : [
              { id: 'in', group: 'in' },
              { id: 'out', group: 'out' },
            ],
          },
          attrs: {
            root: { 'data-stage-id': stage.id },
            body: {
              fill: 'var(--orchestration-node-bg)',
              stroke: style.stroke,
              strokeWidth: style.strokeWidth,
              refPoints: isReview ? '0,10 10,0 20,10 10,20' : undefined,
              rx: 12,
              ry: 12,
              filter: style.filter,
            },
            label: {
              fill: 'var(--orchestration-node-text)',
              fontSize: 11,
              fontWeight: 720,
              lineHeight: 15,
              textWrap: { width: 96, height: 34, ellipsis: true },
            },
          },
        }
      }),
      edges: edges.map(edge => buildEdge(edge, stages)),
    }
  }

  function destroy(): void {
    destroyed = true
    deps.rootEl.removeEventListener('dragover', handleDragOver)
    deps.rootEl.removeEventListener('drop', handleDrop)
    graph?.dispose()
    graph = undefined
    deps.rootEl.replaceChildren()
  }

  return { mount, render, selectStage, destroy }
}

function buildEdge(edge: OrchestrationGraphSnapshot['edges'][number], stages: OrchestrationStage[]): X6GraphEdge {
  const branch = reviewEdgeBranch(edge, stages)
  const sourcePort = edge.sourcePort ?? (branch ? (branch === 'fail' ? 'fail' : 'pass') : 'out')
  return {
    id: edgeKey(edge),
    shape: 'edge',
    source: { cell: edge.sourceStageId, port: sourcePort },
    target: { cell: edge.targetStageId, port: edge.targetPort ?? 'in' },
    vertices: cloneEdgeVertices(edge.vertices),
    connector: orthogonalConnector(),
    router: orthogonalRouter(),
    labels: branch ? [edgeBranchLabel(branch)] : undefined,
    tools: edgeTools(),
    attrs: {
      line: {
        stroke: 'var(--orchestration-edge)',
        strokeWidth: 1.3,
        strokeLinecap: 'round',
        strokeDasharray: undefined,
        targetMarker: { name: 'classic', width: 5, height: 4 },
      },
    },
  }
}

function parallelRoleLabel(roleNames: string[]): string {
  if (roleNames.length === 0) return '未选择人员'
  if (roleNames.length === 1) return roleNames[0] ?? '未选择人员'
  if (roleNames.length === 2) return roleNames.join(' + ')
  return `${roleNames[0]} +${roleNames.length - 1}`
}

function orthogonalConnector(): Record<string, unknown> {
  return { name: 'normal' }
}

function orthogonalRouter(): Record<string, unknown> {
  return { name: 'manhattan' }
}

function edgeTools(): Record<string, unknown> {
  const handleAttrs = {
    r: 3.6,
    fill: 'var(--orchestration-port-bg)',
    stroke: 'var(--orchestration-edge)',
    strokeWidth: 1.7,
  }
  return {
    name: 'edge-tools',
    items: [
      { name: 'vertices', args: { snapRadius: 12, addable: true, removable: true, removeRedundancies: true, attrs: handleAttrs } },
    ],
  }
}

function edgeBranchLabel(branch: 'pass' | 'fail'): Record<string, unknown> {
  const failBranch = branch === 'fail'
  return {
    position: 0.55,
    attrs: {
      label: {
        text: failBranch ? '不通过' : '通过',
        fill: 'var(--orchestration-edge-label-text)',
        fontSize: 9,
        fontWeight: 720,
      },
      body: {
        fill: 'var(--orchestration-edge-label-bg)',
        stroke: 'var(--orchestration-edge-label-stroke)',
        strokeWidth: 1,
        rx: 5,
        ry: 5,
      },
    },
  }
}

function reviewEdgeBranch(edge: OrchestrationGraphSnapshot['edges'][number], stages: OrchestrationStage[]): 'pass' | 'fail' | undefined {
  if (edge.sourcePort === 'pass' || edge.sourcePort === 'fail') return edge.sourcePort
  const sourceIndex = stages.findIndex(stage => stage.id === edge.sourceStageId)
  const targetIndex = stages.findIndex(stage => stage.id === edge.targetStageId)
  const source = stages[sourceIndex]
  if (!source || source.kind !== 'review' || sourceIndex < 0 || targetIndex < 0) return undefined
  return targetIndex <= sourceIndex ? 'fail' : 'pass'
}

function nodeStyle(selected: boolean): { stroke: string; strokeWidth: number; filter: string } {
  return {
    stroke: selected ? 'var(--orchestration-node-selected)' : 'var(--orchestration-node-stroke)',
    strokeWidth: selected ? 2.4 : 1.3,
    filter: selected ? 'var(--orchestration-node-selected-shadow)' : 'var(--orchestration-node-shadow)',
  }
}

function uniqueEdges(edges: OrchestrationGraphSnapshot['edges']): OrchestrationGraphSnapshot['edges'] {
  const seen = new Set<string>()
  const result: OrchestrationGraphSnapshot['edges'] = []
  for (const edge of edges) {
    if (!edge.sourceStageId || !edge.targetStageId || edge.sourceStageId === edge.targetStageId) continue
    const key = edgeKey(edge)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(edge)
  }
  return result
}

function edgeKey(edge: OrchestrationGraphSnapshot['edges'][number]): string {
  const sourcePort = edge.sourcePort === 'out' ? '' : edge.sourcePort ?? ''
  const targetPort = edge.targetPort === 'in' ? '' : edge.targetPort ?? ''
  return `${edge.sourceStageId}:${sourcePort}->${edge.targetStageId}:${targetPort}`
}

function portGroup(position: 'left' | 'right' | 'bottom'): Record<string, unknown> {
  return {
    position,
    attrs: {
      circle: {
        r: 4.5,
        magnet: true,
        stroke: 'var(--orchestration-edge)',
        strokeWidth: 2,
        fill: 'var(--orchestration-port-bg)',
        opacity: 0.98,
        cursor: position === 'left' ? 'default' : 'crosshair',
      },
    },
  }
}

function readEdgeEvent(edge: X6GraphEdgeEvent | undefined): OrchestrationGraphSnapshot['edges'][number] | undefined {
  const sourceStageId = edge?.getSourceCellId?.() ?? readCellId(edge?.getSource?.())
  const targetStageId = edge?.getTargetCellId?.() ?? readCellId(edge?.getTarget?.())
  if (!sourceStageId || !targetStageId || sourceStageId === targetStageId) return undefined
  const sourcePort = normalizeSourcePort(edge?.getSourcePortId?.() ?? readPortId(edge?.getSource?.()))
  const targetPort = normalizeTargetPort(edge?.getTargetPortId?.() ?? readPortId(edge?.getTarget?.()))
  const vertices = readEdgeVertices(edge?.getVertices?.())
  return {
    sourceStageId,
    targetStageId,
    ...(sourcePort ? { sourcePort } : {}),
    ...(targetPort ? { targetPort } : {}),
    ...(vertices ? { vertices } : {}),
  }
}

function cloneEdgeVertices(vertices: OrchestrationGraphSnapshot['edges'][number]['vertices']): Array<{ x: number; y: number }> | undefined {
  return vertices && vertices.length > 0 ? vertices.map(vertex => ({ x: vertex.x, y: vertex.y })) : undefined
}

function readEdgeVertices(value: unknown): Array<{ x: number; y: number }> | undefined {
  if (!Array.isArray(value)) return undefined
  const vertices = value.flatMap(vertex => {
    if (!isRecord(vertex) || typeof vertex.x !== 'number' || typeof vertex.y !== 'number' || !Number.isFinite(vertex.x) || !Number.isFinite(vertex.y)) return []
    return [{ x: vertex.x, y: vertex.y }]
  })
  return vertices.length > 0 ? vertices : undefined
}

function readCellId(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (!isRecord(value)) return undefined
  const cell = value.cell
  return typeof cell === 'string' ? cell : undefined
}

function readPortId(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  const port = value.port
  return typeof port === 'string' ? port : undefined
}

function normalizeSourcePort(port: string | undefined): OrchestrationGraphSnapshot['edges'][number]['sourcePort'] | undefined {
  if (port === 'continue') return 'fail'
  return port === 'out' || port === 'pass' || port === 'fail' ? port : undefined
}

function normalizeTargetPort(port: string | undefined): OrchestrationGraphSnapshot['edges'][number]['targetPort'] | undefined {
  return port === 'in' ? port : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function stageRoleLabel(stage: OrchestrationStage, rolesById: Record<string, GroupRole>): string {
  return stage.roleIds.map(roleId => rolesById[roleId]?.name ?? '未知人员').join(' + ')
}

export function arrangeOrchestrationGraph(stages: OrchestrationStage[], edges: OrchestrationGraphSnapshot['edges']): { stages: OrchestrationStage[]; edges: OrchestrationGraphSnapshot['edges'] } {
  if (stages.length === 0) return { stages: [], edges: [] }
  const stageIds = new Set(stages.map(stage => stage.id))
  const validEdges = uniqueEdges(edges.filter(edge => stageIds.has(edge.sourceStageId) && stageIds.has(edge.targetStageId)))
  const forwardEdges = validEdges.filter(edge => edge.sourcePort !== 'fail')
  const indexById = new Map(stages.map((stage, index) => [stage.id, index]))
  const levelById = graphLevels(stages, forwardEdges)
  const lanesByLevel = new Map<number, OrchestrationStage[]>()
  for (const stage of stages) {
    const level = levelById.get(stage.id) ?? indexById.get(stage.id) ?? 0
    lanesByLevel.set(level, [...lanesByLevel.get(level) ?? [], stage])
  }

  const positioned = stages.map(stage => {
    const level = levelById.get(stage.id) ?? indexById.get(stage.id) ?? 0
    const lane = lanesByLevel.get(level) ?? [stage]
    const laneIndex = lane.findIndex(item => item.id === stage.id)
    const centerY = laneCenterY(Math.max(0, laneIndex), lane.length)
    const isReview = stage.kind === 'review'
    const isDebate = stage.kind === 'debate'
    return {
      ...stage,
      roleIds: [...stage.roleIds],
      review: stage.review ? { ...stage.review, reviewerRoleIds: [...stage.review.reviewerRoleIds] } : undefined,
      debate: stage.debate ? { ...stage.debate } : undefined,
      position: { x: 56 + level * 180, y: centerY - nodeHeight(isReview, isDebate) / 2 },
    }
  })
  const positionById = new Map(positioned.map(stage => [stage.id, stage.position]))
  return {
    stages: positioned,
    edges: validEdges.map(edge => arrangeEdge(edge, positionById)),
  }
}

function graphLevels(stages: OrchestrationStage[], edges: OrchestrationGraphSnapshot['edges']): Map<string, number> {
  if (edges.length === 0) return new Map(stages.map((stage, index) => [stage.id, index]))
  const levelById = new Map(stages.map(stage => [stage.id, 0]))
  const outgoing = new Map<string, OrchestrationGraphSnapshot['edges']>()
  const indegree = new Map(stages.map(stage => [stage.id, 0]))
  for (const edge of edges) {
    outgoing.set(edge.sourceStageId, [...outgoing.get(edge.sourceStageId) ?? [], edge])
    indegree.set(edge.targetStageId, (indegree.get(edge.targetStageId) ?? 0) + 1)
  }
  const queue = stages.filter(stage => (indegree.get(stage.id) ?? 0) === 0).map(stage => stage.id)
  if (queue.length === 0) queue.push(stages[0]?.id ?? '')
  const visited = new Set<string>()
  for (let index = 0; index < queue.length; index += 1) {
    const stageId = queue[index]
    if (!stageId) continue
    visited.add(stageId)
    const sourceLevel = levelById.get(stageId) ?? 0
    for (const edge of outgoing.get(stageId) ?? []) {
      levelById.set(edge.targetStageId, Math.max(levelById.get(edge.targetStageId) ?? 0, sourceLevel + 1))
      const nextIndegree = (indegree.get(edge.targetStageId) ?? 1) - 1
      indegree.set(edge.targetStageId, nextIndegree)
      if (nextIndegree <= 0) queue.push(edge.targetStageId)
    }
  }
  for (const stage of stages) {
    if (visited.has(stage.id)) continue
    const incoming = edges.filter(edge => edge.targetStageId === stage.id)
    const fallbackLevel = incoming.reduce((max, edge) => Math.max(max, (levelById.get(edge.sourceStageId) ?? 0) + 1), 0)
    levelById.set(stage.id, fallbackLevel)
  }
  return levelById
}

function arrangeEdge(edge: OrchestrationGraphSnapshot['edges'][number], positionById: Map<string, { x: number; y: number } | undefined>): OrchestrationGraphSnapshot['edges'][number] {
  const source = positionById.get(edge.sourceStageId)
  const target = positionById.get(edge.targetStageId)
  const arranged = {
    sourceStageId: edge.sourceStageId,
    targetStageId: edge.targetStageId,
    ...(edge.sourcePort ? { sourcePort: edge.sourcePort } : {}),
    ...(edge.targetPort ? { targetPort: edge.targetPort } : {}),
  }
  if (!source || !target || edge.sourcePort !== 'fail') return arranged
  const sourceWidth = REVIEW_NODE_WIDTH
  const sourceHeight = REVIEW_NODE_HEIGHT
  const targetHeight = ROLE_NODE_HEIGHT
  const bottomY = Math.max(source.y + sourceHeight + 74, target.y + targetHeight + 74)
  return {
    ...arranged,
    vertices: [
      { x: source.x + sourceWidth / 2, y: bottomY },
      { x: target.x - 44, y: bottomY },
    ],
  }
}

function laneCenterY(index: number, count: number): number {
  if (count <= 1) return ARRANGED_NODE_CENTER_Y
  return ARRANGED_NODE_CENTER_Y + index * LANE_GAP
}

function defaultStagePosition(index: number, isReview: boolean, isDebate = false): { x: number; y: number } {
  return { x: 48 + index * 154, y: DEFAULT_NODE_CENTER_Y - nodeHeight(isReview, isDebate) / 2 }
}

function nodeWidth(isReview: boolean, isDebate = false): number {
  if (isReview) return REVIEW_NODE_WIDTH
  return isDebate ? DEBATE_NODE_WIDTH : ROLE_NODE_WIDTH
}

function nodeHeight(isReview: boolean, isDebate = false): number {
  if (isReview) return REVIEW_NODE_HEIGHT
  return isDebate ? DEBATE_NODE_HEIGHT : ROLE_NODE_HEIGHT
}
