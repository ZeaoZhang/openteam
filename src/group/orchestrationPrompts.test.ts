import { describe, expect, it } from 'vitest'
import { buildOrchestrationDebateJudgeMessageContent, buildOrchestrationDebateMessageContent, buildOrchestrationReviewMessageContent, buildOrchestrationRoleMessageContent } from './orchestrationPrompts'
import type { OrchestrationReviewResult, OrchestrationStage } from './types'

describe('orchestration message content builders', () => {
  it('builds a role-node group message without duplicating persona or group context logic', () => {
    const content = buildOrchestrationRoleMessageContent({
      userTask: 'Create a launch plan.',
      currentStage: makeRoleStage(),
      previousReviewResult: makeReviewResult(),
      language: 'zh-CN',
    })

    expect(content).toContain('当前任务：\nCreate a launch plan.')
    expect(content).toContain('当前节点任务：\nTurn the research into a launch-ready draft.')
    expect(content).toContain('上次审核未通过要求：\nAddress launch risks.')
    expect(content).not.toContain('群聊成员')
    expect(content).not.toContain('你上次之后')
    expect(content).not.toContain('Role persona')
  })

  it('builds a review-node group message that strongly requires JSON only', () => {
    const content = buildOrchestrationReviewMessageContent({
      userTask: 'Create a launch plan.',
      currentStage: makeReviewStage(),
      reviewCriteria: 'Plan must include risks and owner.',
      language: 'zh-CN',
    })

    expect(content).toContain('审核标准：\nPlan must include risks and owner.')
    expect(content).toContain('你必须只返回合法 JSON')
    expect(content).toContain('"decision": "pass | fail"')
    expect(content).toContain('"nextRoundInstruction": "decision 为 fail 时必填，否则为空字符串"')
    expect(content).not.toContain('群聊成员')
    expect(content).not.toContain('你上次之后')
  })

  it('builds debate prompts with the side, transcript and judge feedback', () => {
    const stage = makeDebateStage()
    const content = buildOrchestrationDebateMessageContent({
      userTask: 'Decide whether to adopt multi-agent orchestration.',
      currentStage: stage,
      side: 'pro',
      roleName: '正方辩手',
      round: 2,
      maxRounds: 3,
      transcript: [{ round: 1, side: 'con', roleName: '反方辩手', content: '成本不可控。' }],
      lastVerdict: makeDebateVerdict(),
      language: 'zh-CN',
    })

    expect(content).toContain('辩论主题：\n正反辩论')
    expect(content).toContain('你的立场：正方')
    expect(content).toContain('当前轮次：第 2 / 3 轮')
    expect(content).toContain('第 1 轮 · 反方 · 反方辩手：\n成本不可控。')
    expect(content).toContain('裁判要求：\n补充成本测算。')
    expect(content).not.toContain('"decision"')
  })

  it('builds judge prompts that require the verdict JSON and final-round convergence', () => {
    const content = buildOrchestrationDebateJudgeMessageContent({
      userTask: 'Decide whether to adopt multi-agent orchestration.',
      currentStage: makeDebateStage(),
      round: 3,
      maxRounds: 3,
      transcript: [],
      language: 'zh-CN',
    })

    expect(content).toContain('评判标准：\n判断哪一方论证更充分。')
    expect(content).toContain('"decision": "continue | conclude"')
    expect(content).toContain('"finalRecommendation"')
    expect(content).toContain('这是最后一轮，decision 必须使用 conclude。')
  })

  it('builds English orchestration instructions when English mode is selected', () => {
    const content = buildOrchestrationReviewMessageContent({
      userTask: 'Create a launch plan.',
      currentStage: makeReviewStage(),
      reviewCriteria: 'Plan must include risks and owner.',
      language: 'en',
    })

    expect(content).toContain('Current task:\nCreate a launch plan.')
    expect(content).toContain('Review criteria:\nPlan must include risks and owner.')
    expect(content).toContain('Return valid JSON only')
    expect(content).toContain('"reason": "Review explanation"')
    expect(content).not.toContain('审核标准')
  })
})

function makeRoleStage(): OrchestrationStage {
  return {
    id: 'stage-draft',
    kind: 'roles',
    name: 'Draft',
    roleIds: ['role-writer'],
    description: 'Turn the research into a launch-ready draft.',
  }
}

function makeReviewStage(): OrchestrationStage {
  return {
    id: 'stage-review',
    kind: 'review',
    name: 'Review',
    roleIds: [],
    review: { reviewerRoleIds: ['role-reviewer'], instructions: 'Check completeness.' },
  }
}

function makeDebateStage(): OrchestrationStage {
  return {
    id: 'stage-debate',
    kind: 'debate',
    name: '正反辩论',
    roleIds: ['role-pro', 'role-con'],
    debate: { judgeRoleId: 'role-judge', rounds: 3, instructions: '判断哪一方论证更充分。' },
  }
}

function makeDebateVerdict(): import('./types').OrchestrationDebateVerdict {
  return {
    round: 1,
    decision: 'continue',
    winner: 'draw',
    reason: '还需要一轮。',
    nextRoundInstruction: '补充成本测算。',
    finalRecommendation: '',
    messageId: 'msg-judge',
    createdAt: 1,
  }
}

function makeReviewResult(): OrchestrationReviewResult {
  return {
    round: 1,
    stageRunId: 'stage-run-1',
    reviewerRoleId: 'role-reviewer',
    messageId: 'msg-review',
    decision: 'fail',
    reason: 'Missing launch risks.',
    failedCriteria: ['risks'],
    nextRoundInstruction: 'Address launch risks.',
    rawJson: '{"decision":"fail"}',
    createdAt: 1,
  }
}
