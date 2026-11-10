import { describe, expect, it } from 'vitest'
import { BUILTIN_ORCHESTRATION_TEMPLATES } from './orchestrationTemplates'

describe('built-in orchestration templates', () => {
  it('covers the core orchestration structures users need to learn', () => {
    const capabilities = new Set(BUILTIN_ORCHESTRATION_TEMPLATES.flatMap(template => template.capabilities))

    expect([...capabilities]).toEqual(expect.arrayContaining(['sequential', 'parallel', 'review', 'loop', 'merge', 'debate']))
  })

  it('defines valid stage role references and graph edges', () => {
    for (const template of BUILTIN_ORCHESTRATION_TEMPLATES) {
      const roleKeys = new Set(template.roles.map(role => role.key))
      const stageIds = new Set(template.stages.map(stage => stage.id))

      expect(template.roles.length, template.id).toBeGreaterThan(0)
      expect(template.stages.length, template.id).toBeGreaterThan(0)

      for (const stage of template.stages) {
        expect(stage.roleKeys.length, `${template.id}:${stage.id}`).toBeGreaterThan(0)
        for (const roleKey of stage.roleKeys) expect(roleKeys.has(roleKey), `${template.id}:${stage.id}:${roleKey}`).toBe(true)
        for (const reviewerRoleKey of stage.review?.reviewerRoleKeys ?? []) {
          expect(roleKeys.has(reviewerRoleKey), `${template.id}:${stage.id}:${reviewerRoleKey}`).toBe(true)
        }
        if (stage.debate) {
          expect(roleKeys.has(stage.debate.judgeRoleKey), `${template.id}:${stage.id}:judge`).toBe(true)
          expect(stage.roleKeys, `${template.id}:${stage.id}:debaters`).toHaveLength(2)
        }
      }

      for (const edge of template.edges) {
        expect(stageIds.has(edge.from), `${template.id}:${edge.from}`).toBe(true)
        expect(stageIds.has(edge.to), `${template.id}:${edge.to}`).toBe(true)
      }
    }
  })

  it('provides a runnable default task for every template', () => {
    for (const template of BUILTIN_ORCHESTRATION_TEMPLATES) {
      expect(template.defaultTask.trim().length, template.id).toBeGreaterThan(12)
      expect(template.defaultTask, template.id).not.toContain('例如')
    }
  })

  it('includes a runnable pro/con debate template', () => {
    const debate = BUILTIN_ORCHESTRATION_TEMPLATES.find(template => template.id === 'debate')
    const stage = debate?.stages[0]

    expect(stage?.kind).toBe('debate')
    expect(stage?.roleKeys).toEqual(['pro', 'con'])
    expect(stage?.debate?.judgeRoleKey).toBe('judge')
    expect(stage?.debate?.rounds).toBe(3)
    expect(stage?.debate?.instructions?.trim().length).toBeGreaterThan(0)
  })

  it('includes concrete examples for parallel work and review loops', () => {
    const parallel = BUILTIN_ORCHESTRATION_TEMPLATES.find(template => template.id === 'parallel-merge')
    const loop = BUILTIN_ORCHESTRATION_TEMPLATES.find(template => template.id === 'review-loop')

    expect(parallel?.stages.some(stage => stage.roleKeys.length > 1)).toBe(true)
    expect(parallel?.edges.some(edge => edge.to === 'merge')).toBe(true)
    expect(loop?.stages.some(stage => stage.kind === 'review' && stage.review?.instructions)).toBe(true)
    expect(loop?.edges).toContainEqual({ from: 'review', to: 'revise', sourcePort: 'fail' })
  })
})
