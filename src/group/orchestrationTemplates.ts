import type { OrchestrationGraphSnapshot, OrchestrationStageKind, ReviewMaxAttemptsAction } from './types'

export type OrchestrationTemplateCategory = 'structure' | 'scenario'
export type OrchestrationTemplateCapability = 'sequential' | 'parallel' | 'review' | 'loop' | 'merge' | 'debate'

export interface OrchestrationTemplateRole {
  key: string
  name: string
  description: string
  systemPrompt: string
  aliases?: string[]
}

export interface OrchestrationTemplateReview {
  reviewerRoleKeys: string[]
  instructions: string
  maxAttempts: number
  onMaxAttempts: ReviewMaxAttemptsAction
}

export interface OrchestrationTemplateDebate {
  judgeRoleKey: string
  rounds: number
  instructions: string
}

export interface OrchestrationTemplateStage {
  id: string
  kind: OrchestrationStageKind
  name: string
  description: string
  roleKeys: string[]
  review?: OrchestrationTemplateReview
  debate?: OrchestrationTemplateDebate
}

export interface OrchestrationTemplateEdge {
  from: string
  to: string
  sourcePort?: NonNullable<OrchestrationGraphSnapshot['edges'][number]['sourcePort']>
}

export interface BuiltinOrchestrationTemplate {
  id: string
  category: OrchestrationTemplateCategory
  name: string
  summary: string
  structure: string
  defaultTask: string
  capabilities: OrchestrationTemplateCapability[]
  maxNodeExecutions: number
  roles: OrchestrationTemplateRole[]
  stages: OrchestrationTemplateStage[]
  edges: OrchestrationTemplateEdge[]
}

const DEFAULT_REVIEW_MAX_ATTEMPTS = 3

export const BUILTIN_ORCHESTRATION_TEMPLATES: BuiltinOrchestrationTemplate[] = [
  {
    id: 'sequential-handoff',
    category: 'structure',
    name: '顺序接力',
    summary: '一个人员完成后交给下一个人员，适合线性推进。',
    structure: '规划 -> 执行 -> 总结',
    defaultTask: '请帮我把“上线一个团队知识库功能”的目标拆解成执行计划、完成主要方案，并最终总结成可落地的行动清单。',
    capabilities: ['sequential'],
    maxNodeExecutions: 20,
    roles: [
      role('planner', '规划者', '拆解目标和产出执行路径', '你负责先拆解用户任务，明确目标、约束、优先级和下一步执行清单。'),
      role('executor', '执行者', '根据规划完成主体产出', '你负责基于前序规划完成主体任务，输出具体、可执行、避免空泛。'),
      role('summarizer', '总结者', '整合前序结果形成结论', '你负责整理所有前序产出，给出清晰结论、关键依据和下一步建议。'),
    ],
    stages: [
      stage('plan', 'roles', '任务拆解', '澄清目标，拆出执行步骤。', ['planner']),
      stage('execute', 'roles', '主体执行', '根据拆解结果完成主要产出。', ['executor']),
      stage('summarize', 'roles', '总结交付', '整合结果并输出最终版本。', ['summarizer']),
    ],
    edges: [
      edge('plan', 'execute'),
      edge('execute', 'summarize'),
    ],
  },
  {
    id: 'parallel-merge',
    category: 'structure',
    name: '并行汇总',
    summary: '多个人员同时发散，再由一个人员汇总成单一结论。',
    structure: '并行发散 -> 汇总',
    defaultTask: '请从用户价值、成本风险、增长传播三个视角评估“是否要上线团队共享知识库”，并汇总成优先级明确的建议。',
    capabilities: ['parallel', 'merge'],
    maxNodeExecutions: 20,
    roles: [
      role('angle_a', '视角A', '从用户价值角度分析', '你负责从用户价值、真实痛点和使用场景角度分析任务。'),
      role('angle_b', '视角B', '从成本风险角度分析', '你负责从实现成本、资源投入、风险和边界条件角度分析任务。'),
      role('angle_c', '视角C', '从增长传播角度分析', '你负责从增长、传播、差异化和可感知价值角度分析任务。'),
      role('merger', '汇总者', '把多个视角收敛成结论', '你负责合并多个视角，去重、排序，并给出一份清晰的最终建议。'),
    ],
    stages: [
      stage('parallel', 'roles', '并行发散', '多个视角同时分析同一个任务。', ['angle_a', 'angle_b', 'angle_c']),
      stage('merge', 'roles', '汇总收敛', '整合并行结果，形成一份结论。', ['merger']),
    ],
    edges: [edge('parallel', 'merge')],
  },
  {
    id: 'review-gate',
    category: 'structure',
    name: '审核把关',
    summary: '先执行，再审核；不通过时停止，避免低质量结果继续流转。',
    structure: '执行 -> 审核',
    defaultTask: '请完成一份“新用户引导流程优化建议”，并让审核员检查是否结构清晰、细节充分、可以执行。',
    capabilities: ['sequential', 'review'],
    maxNodeExecutions: 20,
    roles: [
      role('worker', '执行者', '完成主体产出', '你负责完成用户任务的主体产出，注意结构清楚、细节充分、可以被审核。'),
      role('reviewer', '审核员', '按标准判断是否通过', '你负责严格审核前序产出，只基于标准判断是否通过，并指出具体问题。'),
    ],
    stages: [
      stage('work', 'roles', '完成产出', '完成第一版可审核结果。', ['worker']),
      reviewStage('review', '审核把关', '判断产出是否达到可交付标准。', ['reviewer'], '必须满足用户任务、结构清晰、关键细节充分、结论可执行。满足则通过；否则不通过并说明缺口。'),
    ],
    edges: [edge('work', 'review')],
  },
  {
    id: 'review-loop',
    category: 'structure',
    name: '循环审核',
    summary: '审核不通过就回到修改节点，直到通过或达到上限。',
    structure: '产出 -> 修改 -> 审核，不通过回修改',
    defaultTask: '请产出一篇面向新用户介绍 OpenTeam 编排功能的发布文案，审核不通过时根据反馈修改到可以发布。',
    capabilities: ['sequential', 'review', 'loop'],
    maxNodeExecutions: 30,
    roles: [
      role('writer', '执行者', '产出并根据反馈修改', '你负责产出初稿，并在收到审核反馈后针对问题修改，不要重复已经通过的内容。'),
      role('reviewer', '审核员', '判断是否需要继续修改', '你负责检查产出是否达到标准。请严格输出审核结论和可执行修改意见。'),
    ],
    stages: [
      stage('draft', 'roles', '产出初稿', '先给出第一版可审核结果。', ['writer']),
      stage('revise', 'roles', '修改完善', '根据审核反馈修正问题，输出改进版本。', ['writer']),
      reviewStage('review', '审核把关', '判断当前版本是否可以交付。', ['reviewer'], '必须完整回应用户任务，结构清楚，有足够细节，并给出可执行结论。满足则通过；否则不通过，并写明下一轮必须修改什么。'),
    ],
    edges: [
      edge('draft', 'revise'),
      edge('revise', 'review'),
      edge('review', 'revise', 'fail'),
    ],
  },
  {
    id: 'debate',
    category: 'structure',
    name: '正反辩论',
    summary: '正方与反方多轮对抗，裁判在每轮后判断继续还是收敛，并给出最终结论。',
    structure: '正方立论 -> 反方回应 -> 裁判裁定（多轮）',
    defaultTask: '请围绕“团队是否应该引入多 Agent 自动编排”展开正反辩论。双方必须直接回应对方论点，裁判在每轮后判断是否需要继续，最终给出结论和可执行建议。',
    capabilities: ['debate', 'loop'],
    maxNodeExecutions: 30,
    roles: [
      role('pro', '正方辩手', '支持方案并主动论证', '你是正方辩手，负责为用户任务中的方案建立清晰、可验证的论证，并逐条回应反方质疑。'),
      role('con', '反方辩手', '质疑方案并指出风险', '你是反方辩手，负责严格质疑方案的假设、成本、风险和适用边界，并逐条回应正方论证。'),
      role('judge', '辩论裁判', '按标准裁定是否收敛', '你是辩论裁判，负责根据评判标准判断双方论证质量，决定是否还需要一轮辩论，并在收敛时给出最终结论。'),
    ],
    stages: [
      debateStage('debate', '正反辩论', '双方多轮对抗，裁判逐轮裁定。', ['pro', 'con'], 'judge', 3, '论点必须直接回应用户任务；论证有依据；双方都要回应对方的核心质疑；结论可作为行动依据。'),
    ],
    edges: [],
  },
  {
    id: 'product-review',
    category: 'scenario',
    name: '产品方案评审',
    summary: '产品先拆方案，工程评估成本，审核员决定是否回炉。',
    structure: '产品拆解 -> 工程评估 -> 审核，不通过回产品',
    defaultTask: '请评审“为 OpenTeam 增加内置编排模板”的产品方案，输出用户价值、实现成本、风险和上线建议。',
    capabilities: ['sequential', 'review', 'loop'],
    maxNodeExecutions: 30,
    roles: [
      role('pm', '产品经理', '拆解用户价值和方案边界', '你是产品经理，负责把任务拆成用户目标、核心价值、功能范围、优先级和验收标准。', ['产品']),
      role('engineer', '工程师', '评估实现路径和成本风险', '你是工程师，负责评估技术路径、实现成本、依赖、边界情况和测试方案。', ['技术', '开发']),
      role('reviewer', '方案审核员', '判断方案是否可推进', '你是方案审核员，负责检查产品价值、工程成本、风险和上线建议是否完整。', ['审核']),
    ],
    stages: [
      stage('product', 'roles', '产品拆解', '定义用户价值、范围和成功标准。', ['pm']),
      stage('engineering', 'roles', '工程评估', '评估实现方案、成本、风险和测试。', ['engineer']),
      reviewStage('review', '方案审核', '判断方案是否可以进入执行。', ['reviewer'], '必须包含用户价值、实现成本、主要风险、测试方案和上线建议。缺少任何一项则不通过。'),
    ],
    edges: [
      edge('product', 'engineering'),
      edge('engineering', 'review'),
      edge('review', 'product', 'fail'),
    ],
  },
  {
    id: 'content-production',
    category: 'scenario',
    name: '内容创作审核',
    summary: '先定选题，再写正文，编辑审核不通过则回到写作。',
    structure: '选题 -> 写作 -> 编辑审核，不通过回写作',
    defaultTask: '请为 OpenTeam 的编排模板功能创作一篇公众号短文，从选题到正文再到编辑审核，直到可以发布。',
    capabilities: ['sequential', 'review', 'loop'],
    maxNodeExecutions: 30,
    roles: [
      role('planner', '选题策划', '确定角度、读者和结构', '你是选题策划，负责明确目标读者、内容角度、标题方向、结构和关键信息。'),
      role('writer', '写手', '完成正文初稿和修改', '你是写手，负责写出自然、具体、能直接发布的正文，并根据编辑意见修改。'),
      role('editor', '编辑', '审核内容质量和发布条件', '你是编辑，负责检查内容是否贴合读者、结构是否清晰、细节是否充分、是否能发布。'),
    ],
    stages: [
      stage('plan', 'roles', '选题策划', '确定读者、角度、标题和结构。', ['planner']),
      stage('write', 'roles', '正文写作', '完成可以被编辑审核的正文。', ['writer']),
      reviewStage('edit', '编辑审核', '判断内容是否可以发布。', ['editor'], '必须符合目标读者、结构清晰、有足够细节、语气自然、可以直接发布。不满足则不通过并给出修改建议。'),
    ],
    edges: [
      edge('plan', 'write'),
      edge('write', 'edit'),
      edge('edit', 'write', 'fail'),
    ],
  },
  {
    id: 'competitor-analysis',
    category: 'scenario',
    name: '竞品分析报告',
    summary: '多个视角并行分析竞品，再汇总成策略建议。',
    structure: '并行分析 -> 报告汇总 -> 质量审核',
    defaultTask: '请分析三款团队协作或 AI Agent 产品的编排能力，形成包含差异、机会和行动建议的竞品分析报告。',
    capabilities: ['parallel', 'merge', 'review'],
    maxNodeExecutions: 25,
    roles: [
      role('product', '产品分析师', '分析功能和定位差异', '你负责从产品定位、核心功能、用户路径和差异化角度分析竞品。'),
      role('market', '市场分析师', '分析渠道、定价和传播', '你负责从定价、渠道、传播、增长和目标客群角度分析竞品。'),
      role('strategy', '策略顾问', '提炼机会点和行动建议', '你负责从机会点、威胁、防守和进攻策略角度分析竞品。'),
      role('reporter', '报告撰写者', '汇总并形成报告', '你负责整合并行分析结果，输出结构清晰、结论明确的竞品分析报告。'),
      role('reviewer', '报告审核员', '审核报告是否完整可信', '你负责检查报告是否覆盖竞品、差异、机会、风险和行动建议。'),
    ],
    stages: [
      stage('parallel', 'roles', '并行分析', '产品、市场、策略三个视角同时分析。', ['product', 'market', 'strategy']),
      stage('report', 'roles', '报告汇总', '整合并行结果，形成报告。', ['reporter']),
      reviewStage('review', '报告审核', '判断报告是否完整可信。', ['reviewer'], '必须覆盖竞品定位、核心差异、机会点、主要风险和行动建议；结论需要有依据。缺少则不通过。'),
    ],
    edges: [
      edge('parallel', 'report'),
      edge('report', 'review'),
    ],
  },
]

export function getBuiltinOrchestrationTemplate(templateId: string): BuiltinOrchestrationTemplate | undefined {
  return BUILTIN_ORCHESTRATION_TEMPLATES.find(template => template.id === templateId)
}

function role(key: string, name: string, description: string, systemPrompt: string, aliases: string[] = []): OrchestrationTemplateRole {
  return { key, name, description, systemPrompt, ...(aliases.length > 0 ? { aliases } : {}) }
}

function stage(id: string, kind: OrchestrationStageKind, name: string, description: string, roleKeys: string[]): OrchestrationTemplateStage {
  return { id, kind, name, description, roleKeys }
}

function debateStage(id: string, name: string, description: string, debaterRoleKeys: string[], judgeRoleKey: string, rounds: number, instructions: string): OrchestrationTemplateStage {
  return {
    id,
    kind: 'debate',
    name,
    description,
    roleKeys: debaterRoleKeys,
    debate: {
      judgeRoleKey,
      rounds,
      instructions,
    },
  }
}

function reviewStage(id: string, name: string, description: string, reviewerRoleKeys: string[], instructions: string): OrchestrationTemplateStage {
  return {
    id,
    kind: 'review',
    name,
    description,
    roleKeys: reviewerRoleKeys,
    review: {
      reviewerRoleKeys,
      instructions,
      maxAttempts: DEFAULT_REVIEW_MAX_ATTEMPTS,
      onMaxAttempts: 'stop',
    },
  }
}

function edge(from: string, to: string, sourcePort?: OrchestrationTemplateEdge['sourcePort']): OrchestrationTemplateEdge {
  return { from, to, ...(sourcePort ? { sourcePort } : {}) }
}
