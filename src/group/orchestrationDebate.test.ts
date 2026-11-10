import { describe, expect, it } from 'vitest'
import { parseDebateVerdict } from './orchestrationDebate'

describe('parseDebateVerdict', () => {
  it('parses a continue verdict from fenced JSON', () => {
    const result = parseDebateVerdict('```json\n{"decision":"continue","winner":"draw","reason":"Need cost analysis.","nextRoundInstruction":"Quantify the rollout cost.","finalRecommendation":""}\n```')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.verdict.decision).toBe('continue')
      expect(result.verdict.nextRoundInstruction).toBe('Quantify the rollout cost.')
      expect(result.verdict.rawJson).toContain('"decision":"continue"')
    }
  })

  it('defaults winner to draw and parses a conclude verdict', () => {
    const result = parseDebateVerdict('{"decision":"conclude","reason":"Pro is more convincing.","nextRoundInstruction":"","finalRecommendation":"Adopt the proposal with a cost cap."}')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.verdict.decision).toBe('conclude')
      expect(result.verdict.winner).toBe('draw')
      expect(result.verdict.finalRecommendation).toContain('cost cap')
    }
  })

  it('rejects missing JSON, bad JSON and invalid enums', () => {
    expect(parseDebateVerdict('no json here').ok).toBe(false)
    expect(parseDebateVerdict('{"decision":"continue"').ok).toBe(false)
    expect(parseDebateVerdict('{"decision":"stop","reason":"x"}').ok).toBe(false)
    expect(parseDebateVerdict('{"decision":"conclude","reason":"","finalRecommendation":"x"}').ok).toBe(false)
    expect(parseDebateVerdict('{"decision":"continue","reason":"x","nextRoundInstruction":""}').ok).toBe(false)
    expect(parseDebateVerdict('{"decision":"conclude","reason":"x","finalRecommendation":""}').ok).toBe(false)
  })
})
