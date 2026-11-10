import type { DebateDecision, DebateWinner } from './types'

export interface ParsedDebateVerdict {
  decision: DebateDecision
  winner: DebateWinner
  reason: string
  nextRoundInstruction: string
  finalRecommendation: string
  rawJson: string
}

export type ParseDebateVerdictResult =
  | { ok: true; verdict: ParsedDebateVerdict }
  | { ok: false; error: string }

export function parseDebateVerdict(raw: string): ParseDebateVerdictResult {
  const rawJson = extractJson(raw)
  if (!rawJson) {
    return { ok: false, error: 'Debate response did not contain JSON.' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawJson)
  } catch {
    return { ok: false, error: 'Debate response JSON is invalid.' }
  }

  if (!isRecord(parsed)) {
    return { ok: false, error: 'Debate response JSON must be an object.' }
  }

  const decision = parsed.decision
  if (decision !== 'continue' && decision !== 'conclude') {
    return { ok: false, error: 'Debate decision must be continue or conclude.' }
  }

  if (typeof parsed.reason !== 'string' || parsed.reason.trim().length === 0) {
    return { ok: false, error: 'Debate reason must be a non-empty string.' }
  }

  const winner = parsed.winner === undefined ? 'draw' : parsed.winner
  if (winner !== 'pro' && winner !== 'con' && winner !== 'draw') {
    return { ok: false, error: 'Debate winner must be pro, con or draw.' }
  }

  if (typeof parsed.nextRoundInstruction !== 'string') {
    return { ok: false, error: 'Debate nextRoundInstruction must be a string.' }
  }

  if (typeof parsed.finalRecommendation !== 'string') {
    return { ok: false, error: 'Debate finalRecommendation must be a string.' }
  }

  if (decision === 'continue' && parsed.nextRoundInstruction.trim().length === 0) {
    return { ok: false, error: 'Debate nextRoundInstruction is required when decision is continue.' }
  }

  if (decision === 'conclude' && parsed.finalRecommendation.trim().length === 0) {
    return { ok: false, error: 'Debate finalRecommendation is required when decision is conclude.' }
  }

  return {
    ok: true,
    verdict: {
      decision,
      winner,
      reason: parsed.reason.trim(),
      nextRoundInstruction: parsed.nextRoundInstruction.trim(),
      finalRecommendation: parsed.finalRecommendation.trim(),
      rawJson,
    },
  }
}

function extractJson(raw: string): string | undefined {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  const candidate = (fenced?.[1] ?? raw).trim()
  return candidate.length > 0 ? candidate : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
