// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { emptyCard } from './viewHelpers'

describe('emptyCard', () => {
  it('renders the title and body inside the shared empty state shell', () => {
    const wrapper = emptyCard('还没有群聊', '在上方创建一个群聊。')

    expect(wrapper.className).toBe('empty-state')
    expect(wrapper.querySelector('.empty-card h3')?.textContent).toBe('还没有群聊')
    expect(wrapper.querySelector('.empty-card .muted')?.textContent).toBe('在上方创建一个群聊。')
    expect(wrapper.querySelector('.empty-icon')).toBeNull()
    expect(wrapper.querySelector('.empty-actions')).toBeNull()
  })

  it('renders an optional icon and keeps the action buttons clickable', () => {
    const action = document.createElement('button')
    action.textContent = '新建第一个群聊'
    const onClick = vi.fn()
    action.addEventListener('click', onClick)

    const wrapper = emptyCard('还没有群聊', '说明', { icon: '💬', actions: [action] })

    const icon = wrapper.querySelector<HTMLElement>('.empty-icon')
    expect(icon?.textContent).toBe('💬')
    expect(icon?.getAttribute('aria-hidden')).toBe('true')
    const actions = wrapper.querySelector('.empty-actions')
    expect(actions?.contains(action)).toBe(true)

    action.click()
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
