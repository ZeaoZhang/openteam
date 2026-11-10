import { PROMPT_I18N, normalizeLanguage } from '../shared/i18n'
import type { OpenTeamLanguage, OrchestrationDebateVerdict, OrchestrationReviewResult, OrchestrationStage } from './types'

export interface OrchestrationDebateTranscriptEntry {
  round: number
  side: 'pro' | 'con'
  roleName: string
  content: string
}

export interface BuildOrchestrationDebateMessageContentInput {
  userTask: string
  currentStage: OrchestrationStage
  side: 'pro' | 'con'
  roleName: string
  round: number
  maxRounds: number
  transcript: OrchestrationDebateTranscriptEntry[]
  lastVerdict?: OrchestrationDebateVerdict
  language?: OpenTeamLanguage
}

export interface BuildOrchestrationDebateJudgeMessageContentInput {
  userTask: string
  currentStage: OrchestrationStage
  round: number
  maxRounds: number
  transcript: OrchestrationDebateTranscriptEntry[]
  lastVerdict?: OrchestrationDebateVerdict
  language?: OpenTeamLanguage
}

export interface BuildOrchestrationRoleMessageContentInput {
  userTask: string
  currentStage: OrchestrationStage
  previousReviewResult?: OrchestrationReviewResult
  language?: OpenTeamLanguage
}

export interface BuildOrchestrationReviewMessageContentInput {
  userTask: string
  currentStage: OrchestrationStage
  reviewCriteria?: string
  language?: OpenTeamLanguage
}

export function buildOrchestrationRoleMessageContent(input: BuildOrchestrationRoleMessageContentInput): string {
  const language = normalizeLanguage(input.language)
  const previousInstruction = input.previousReviewResult?.nextRoundInstruction?.trim()
  return joinSections([
    `${language === 'en' ? 'Current task:' : '当前任务：'}\n${input.userTask}`,
    input.currentStage.description ? `${language === 'en' ? 'Current node task:' : '当前节点任务：'}\n${input.currentStage.description}` : undefined,
    previousInstruction ? `${language === 'en' ? 'Previous review failed with this requirement:' : '上次审核未通过要求：'}\n${previousInstruction}` : undefined,
  ])
}

export function buildOrchestrationReviewMessageContent(input: BuildOrchestrationReviewMessageContentInput): string {
  const language = normalizeLanguage(input.language)
  return joinSections([
    `${language === 'en' ? 'Current task:' : '当前任务：'}\n${input.userTask}`,
    input.currentStage.description ? `${language === 'en' ? 'Current review node task:' : '当前审核节点任务：'}\n${input.currentStage.description}` : undefined,
    `${language === 'en' ? 'Review criteria:' : '审核标准：'}\n${input.reviewCriteria?.trim() || input.currentStage.review?.instructions?.trim() || (language === 'en' ? 'Decide whether the current result satisfies the task requirements.' : '判断当前结果是否满足任务要求。')}`,
    buildOrchestrationReviewResponseInstruction(language),
  ])
}

export function buildOrchestrationReviewResponseInstruction(languageInput?: OpenTeamLanguage): string {
  const language = normalizeLanguage(languageInput)
  return joinSections([
    PROMPT_I18N[language].jsonOnly,
    `${language === 'en' ? 'The JSON format must match:' : 'JSON 格式必须匹配：'}\n${reviewSchema(language)}`,
    language === 'en'
      ? 'decision must be pass or fail. Use fail when the review does not pass, and write exactly what to improve in nextRoundInstruction.'
      : 'decision 只能是 pass 或 fail。不通过时使用 fail，并在 nextRoundInstruction 写清楚下一次重试要改什么。',
  ])
}

function reviewSchema(language: OpenTeamLanguage): string {
  const schema = language === 'en'
    ? {
        decision: 'pass | fail',
        reason: 'Review explanation',
        failedCriteria: ['Criteria that were not met'],
        nextRoundInstruction: 'Required when decision is fail; otherwise an empty string',
      }
    : {
        decision: 'pass | fail',
        reason: '审核说明',
        failedCriteria: ['未满足的标准'],
        nextRoundInstruction: 'decision 为 fail 时必填，否则为空字符串',
      }
  return JSON.stringify(schema, null, 2)
}

export function buildOrchestrationDebateMessageContent(input: BuildOrchestrationDebateMessageContentInput): string {
  const language = normalizeLanguage(input.language)
  const maxRounds = Math.max(1, input.maxRounds)
  const sideLabel = debateSideLabel(input.side, language)
  const lastVerdict = input.lastVerdict?.nextRoundInstruction?.trim()
  return joinSections([
    `${language === 'en' ? 'Current task:' : '当前任务：'}\n${input.userTask}`,
    input.currentStage.description ? `${language === 'en' ? 'Current debate node task:' : '当前辩论节点任务：'}\n${input.currentStage.description}` : undefined,
    `${language === 'en' ? 'Debate topic:' : '辩论主题：'}\n${input.currentStage.name}`,
    `${language === 'en' ? 'Your side:' : '你的立场：'}${sideLabel}`,
    `${language === 'en' ? 'Your role:' : '你的角色：'}${input.roleName}`,
    `${language === 'en' ? 'Round:' : '当前轮次：'}${language === 'en' ? `${input.round} / ${maxRounds}` : `第 ${input.round} / ${maxRounds} 轮`}${input.round >= maxRounds ? (language === 'en' ? ' (final round)' : '（最后一轮）') : ''}`,
    `${language === 'en' ? 'Statements so far:' : '已有发言：'}\n${formatDebateTranscript(input.transcript, language)}`,
    lastVerdict ? `${language === 'en' ? 'Judge requirement for this round:' : '裁判要求：'}\n${lastVerdict}` : undefined,
    language === 'en'
      ? 'Respond directly to the other side: point out the concrete disagreement, add new evidence, or revise your argument. Do not repeat the task and do not output JSON.'
      : '请直接回应对手的论点：指出具体分歧，补充新的论据，或修正自己的论证。不要复述当前任务，不要输出 JSON。',
  ])
}

export function buildOrchestrationDebateJudgeMessageContent(input: BuildOrchestrationDebateJudgeMessageContentInput): string {
  const language = normalizeLanguage(input.language)
  const maxRounds = Math.max(1, input.maxRounds)
  return joinSections([
    `${language === 'en' ? 'Current task:' : '当前任务：'}\n${input.userTask}`,
    input.currentStage.description ? `${language === 'en' ? 'Current debate node task:' : '当前辩论节点任务：'}\n${input.currentStage.description}` : undefined,
    `${language === 'en' ? 'Debate topic:' : '辩论主题：'}\n${input.currentStage.name}`,
    `${language === 'en' ? 'Judging criteria:' : '评判标准：'}\n${input.currentStage.debate?.instructions?.trim() || (language === 'en' ? 'Judge which side argues more convincingly against the task requirements.' : '根据任务要求，判断哪一方的论证更充分、回应更有效。')}`,
    `${language === 'en' ? 'Round:' : '当前轮次：'}${language === 'en' ? `${input.round} / ${maxRounds}` : `第 ${input.round} / ${maxRounds} 轮`}`,
    `${language === 'en' ? 'Debate transcript:' : '辩论记录：'}\n${formatDebateTranscript(input.transcript, language)}`,
    buildOrchestrationDebateResponseInstruction(language, input.round >= maxRounds),
  ])
}

export function buildOrchestrationDebateResponseInstruction(languageInput?: OpenTeamLanguage, isFinalRound = false): string {
  const language = normalizeLanguage(languageInput)
  return joinSections([
    PROMPT_I18N[language].jsonOnly,
    `${language === 'en' ? 'The JSON format must match:' : 'JSON 格式必须匹配：'}\n${debateSchema(language)}`,
    language === 'en'
      ? 'decision must be continue or conclude. Use continue when another round is needed and write the exact question the next round must answer in nextRoundInstruction. Use conclude when the debate has converged and write the final recommendation in finalRecommendation. winner must be pro, con or draw.'
      : 'decision 只能是 continue 或 conclude。还需要一轮时使用 continue，并在 nextRoundInstruction 写清下一轮必须回应的具体问题；可以收敛时使用 conclude，并在 finalRecommendation 写出最终建议。winner 只能是 pro、con 或 draw。',
    isFinalRound ? (language === 'en' ? 'This is the final round, so decision must be conclude.' : '这是最后一轮，decision 必须使用 conclude。') : undefined,
  ])
}

function debateSchema(language: OpenTeamLanguage): string {
  const schema = language === 'en'
    ? {
        decision: 'continue | conclude',
        winner: 'pro | con | draw',
        reason: 'Verdict explanation',
        nextRoundInstruction: 'Required when decision is continue; the exact question the next round must answer',
        finalRecommendation: 'Required when decision is conclude; the final recommendation',
      }
    : {
        decision: 'continue | conclude',
        winner: 'pro | con | draw',
        reason: '裁定说明',
        nextRoundInstruction: 'decision 为 continue 时必填，写清下一轮必须回应的具体问题',
        finalRecommendation: 'decision 为 conclude 时必填，给出最终建议',
      }
  return JSON.stringify(schema, null, 2)
}

function formatDebateTranscript(entries: OrchestrationDebateTranscriptEntry[], language: OpenTeamLanguage): string {
  if (entries.length === 0) return language === 'en' ? 'No statements yet.' : '尚无发言。'
  return entries
    .map(entry => {
      const side = debateSideLabel(entry.side, language)
      return language === 'en'
        ? `Round ${entry.round} · ${side} · ${entry.roleName}:\n${entry.content}`
        : `第 ${entry.round} 轮 · ${side} · ${entry.roleName}：\n${entry.content}`
    })
    .join('\n\n')
}

function debateSideLabel(side: 'pro' | 'con', language: OpenTeamLanguage): string {
  if (language === 'en') return side === 'pro' ? 'Pro' : 'Con'
  return side === 'pro' ? '正方' : '反方'
}

function joinSections(sections: Array<string | undefined>): string {
  return sections.filter((section): section is string => Boolean(section?.trim())).join('\n\n')
}
