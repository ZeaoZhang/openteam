// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BUILTIN_GROUP_TEMPLATES } from '../group/builtinGroupTemplates'
import type { GroupChat, GroupRole } from '../group/types'
import { createTeamPageState } from './appState'
import { createTeamUiController } from './teamUiController'

describe('createTeamUiController', () => {
  beforeEach(() => {
    document.body.innerHTML = teamUiBody()
  })

  it('does not recover roles whose existing iframe is already assigned', () => {
    const chat = makeChat('chat-1', ['role-1', 'role-2'])
    const roles = [
      makeRole(chat.id, 'role-1'),
      makeRole(chat.id, 'role-2'),
    ]
    const runCommand = vi.fn(async () => undefined)
    const restoreChat = vi.fn(() => roles.map(role => ({
      chatId: chat.id,
      roleId: role.id,
      src: 'https://gemini.google.com/',
      active: true,
      status: 'assigned' as const,
      assignmentAttempts: 1,
    })))

    createTeamUiController({
      state: createTeamPageState(),
      settingsButtonEl: document.querySelector<HTMLButtonElement>('#settings-button')!,
      settingsMenuEl: document.querySelector<HTMLElement>('#settings-menu')!,
      quickCreateChatEl: document.querySelector<HTMLButtonElement>('#quick-create-chat')!,
      createChatFormEl: document.querySelector<HTMLFormElement>('#create-chat-form')!,
      newChatNameEl: document.querySelector<HTMLInputElement>('#new-chat-name')!,
      togglePeopleDrawerEl: document.querySelector<HTMLButtonElement>('#toggle-people-drawer')!,
      rolePanelEl: document.querySelector<HTMLElement>('#role-panel')!,
      iframeHost: { restoreChat },
      getLanguage: () => 'zh-CN',
      getCurrentChat: () => chat,
      getCurrentRoles: () => roles,
      getSelectedLoginSite: () => 'gemini',
      render: vi.fn(),
      renderChatList: vi.fn(),
      renderRolePanel: vi.fn(),
      renderAddPersonDialog: vi.fn(),
      closePeopleModals: vi.fn(),
      closeExternalModels: vi.fn(),
      registerComposerEvents: vi.fn(),
      registerPeopleLibraryEvents: vi.fn(),
      registerExternalModelsEvents: vi.fn(),
      runCommand,
      showError: vi.fn(),
      log: { debug: vi.fn(), info: vi.fn() },
    }).registerUi()

    document.querySelector<HTMLButtonElement>('#restore-chat')!.click()

    expect(restoreChat).toHaveBeenCalledWith({ ...chat, roleIds: roles.map(role => role.id) }, roles)
    expect(runCommand).not.toHaveBeenCalledWith('GROUP_ROLE_RECOVER', expect.anything())
  })

  it('creates a new chat from a selected group template', () => {
    const runCommand = vi.fn(async () => undefined)

    createTeamUiController({
      state: createTeamPageState(),
      settingsButtonEl: document.querySelector<HTMLButtonElement>('#settings-button')!,
      settingsMenuEl: document.querySelector<HTMLElement>('#settings-menu')!,
      quickCreateChatEl: document.querySelector<HTMLButtonElement>('#quick-create-chat')!,
      createChatFormEl: document.querySelector<HTMLFormElement>('#create-chat-form')!,
      newChatNameEl: document.querySelector<HTMLInputElement>('#new-chat-name')!,
      togglePeopleDrawerEl: document.querySelector<HTMLButtonElement>('#toggle-people-drawer')!,
      rolePanelEl: document.querySelector<HTMLElement>('#role-panel')!,
      iframeHost: { restoreChat: vi.fn(() => []) },
      getLanguage: () => 'zh-CN',
      getCurrentChat: () => undefined,
      getCurrentRoles: () => [],
      getSelectedLoginSite: () => 'gemini',
      render: vi.fn(),
      renderChatList: vi.fn(),
      renderRolePanel: vi.fn(),
      renderAddPersonDialog: vi.fn(),
      closePeopleModals: vi.fn(),
      closeExternalModels: vi.fn(),
      registerComposerEvents: vi.fn(),
      registerPeopleLibraryEvents: vi.fn(),
      registerExternalModelsEvents: vi.fn(),
      runCommand,
      showError: vi.fn(),
      log: { debug: vi.fn(), info: vi.fn() },
    }).registerUi()

    document.querySelector<HTMLButtonElement>('#quick-create-chat')!.click()
    document.querySelector<HTMLButtonElement>('#open-group-template-create')!.click()
    const firstTemplateButton = document.querySelector<HTMLButtonElement>('.group-template-option')!
    firstTemplateButton.click()
    document.querySelector<HTMLButtonElement>('#confirm-group-template-create')!.click()

    const template = BUILTIN_GROUP_TEMPLATES[0]
    expect(runCommand).toHaveBeenCalledWith('GROUP_CHAT_CREATE', {
      name: template.defaultChatName,
      mode: template.defaultMode,
      roles: template.roles,
      welcomeMessage: expect.stringContaining(`欢迎来到「${template.name}」`),
    })
    expect(document.querySelector<HTMLElement>('#group-template-modal')!.hidden).toBe(true)
    expect(document.querySelector<HTMLFormElement>('#create-chat-form')!.hidden).toBe(true)
  })

  it('renders and creates group templates in English mode', () => {
    const runCommand = vi.fn(async () => undefined)

    createTeamUiController({
      state: createTeamPageState(),
      settingsButtonEl: document.querySelector<HTMLButtonElement>('#settings-button')!,
      settingsMenuEl: document.querySelector<HTMLElement>('#settings-menu')!,
      quickCreateChatEl: document.querySelector<HTMLButtonElement>('#quick-create-chat')!,
      createChatFormEl: document.querySelector<HTMLFormElement>('#create-chat-form')!,
      newChatNameEl: document.querySelector<HTMLInputElement>('#new-chat-name')!,
      togglePeopleDrawerEl: document.querySelector<HTMLButtonElement>('#toggle-people-drawer')!,
      rolePanelEl: document.querySelector<HTMLElement>('#role-panel')!,
      iframeHost: { restoreChat: vi.fn(() => []) },
      getLanguage: () => 'en',
      getCurrentChat: () => undefined,
      getCurrentRoles: () => [],
      getSelectedLoginSite: () => 'gemini',
      render: vi.fn(),
      renderChatList: vi.fn(),
      renderRolePanel: vi.fn(),
      renderAddPersonDialog: vi.fn(),
      closePeopleModals: vi.fn(),
      closeExternalModels: vi.fn(),
      registerComposerEvents: vi.fn(),
      registerPeopleLibraryEvents: vi.fn(),
      registerExternalModelsEvents: vi.fn(),
      runCommand,
      showError: vi.fn(),
      log: { debug: vi.fn(), info: vi.fn() },
    }).registerUi()

    document.querySelector<HTMLButtonElement>('#open-group-template-create')!.click()
    const firstTemplateButton = document.querySelector<HTMLButtonElement>('.group-template-option')!
    expect(firstTemplateButton.textContent).toContain('Study Master Group')
    expect(firstTemplateButton.textContent).toContain('StudyPlanner')
    expect(firstTemplateButton.textContent).not.toContain('学霸学习群')

    firstTemplateButton.click()
    document.querySelector<HTMLButtonElement>('#confirm-group-template-create')!.click()

    expect(runCommand).toHaveBeenCalledWith('GROUP_CHAT_CREATE', expect.objectContaining({
      name: 'Study Master Group',
      roles: expect.arrayContaining([expect.objectContaining({ name: 'StudyPlanner' })]),
      welcomeMessage: expect.stringContaining('Welcome to "Study Master Group"'),
    }))
  })

  it('filters group templates by category and search in the picker', () => {
    createTeamUiController({
      state: createTeamPageState(),
      settingsButtonEl: document.querySelector<HTMLButtonElement>('#settings-button')!,
      settingsMenuEl: document.querySelector<HTMLElement>('#settings-menu')!,
      quickCreateChatEl: document.querySelector<HTMLButtonElement>('#quick-create-chat')!,
      createChatFormEl: document.querySelector<HTMLFormElement>('#create-chat-form')!,
      newChatNameEl: document.querySelector<HTMLInputElement>('#new-chat-name')!,
      togglePeopleDrawerEl: document.querySelector<HTMLButtonElement>('#toggle-people-drawer')!,
      rolePanelEl: document.querySelector<HTMLElement>('#role-panel')!,
      iframeHost: { restoreChat: vi.fn(() => []) },
      getLanguage: () => 'zh-CN',
      getCurrentChat: () => undefined,
      getCurrentRoles: () => [],
      getSelectedLoginSite: () => 'gemini',
      render: vi.fn(),
      renderChatList: vi.fn(),
      renderRolePanel: vi.fn(),
      renderAddPersonDialog: vi.fn(),
      closePeopleModals: vi.fn(),
      closeExternalModels: vi.fn(),
      registerComposerEvents: vi.fn(),
      registerPeopleLibraryEvents: vi.fn(),
      registerExternalModelsEvents: vi.fn(),
      runCommand: vi.fn(async () => undefined),
      showError: vi.fn(),
      log: { debug: vi.fn(), info: vi.fn() },
    }).registerUi()

    document.querySelector<HTMLButtonElement>('#open-group-template-create')!.click()

    const categoryButton = [...document.querySelectorAll<HTMLButtonElement>('.group-template-category-filter')]
      .find(button => button.textContent === '技术研发')
    expect(categoryButton).toBeTruthy()
    categoryButton!.click()
    expect([...document.querySelectorAll<HTMLElement>('.group-template-option strong')].map(el => el.textContent)).toEqual([
      '软件开发群',
      'AI Agent 开发群',
      '数据分析群',
    ])

    const searchEl = document.querySelector<HTMLInputElement>('#group-template-search')!
    searchEl.value = 'Agent'
    searchEl.dispatchEvent(new Event('input', { bubbles: true }))
    expect([...document.querySelectorAll<HTMLElement>('.group-template-option strong')].map(el => el.textContent)).toEqual(['AI Agent 开发群'])

    searchEl.value = '不存在的模板'
    searchEl.dispatchEvent(new Event('input', { bubbles: true }))
    expect(document.querySelector('.group-template-option')).toBeNull()
    expect(document.querySelector<HTMLElement>('.group-template-empty')?.textContent).toContain('没有找到匹配的小组')
  })

  it('keeps risk badges beside the template name and role count under the name', () => {
    createTeamUiController({
      state: createTeamPageState(),
      settingsButtonEl: document.querySelector<HTMLButtonElement>('#settings-button')!,
      settingsMenuEl: document.querySelector<HTMLElement>('#settings-menu')!,
      quickCreateChatEl: document.querySelector<HTMLButtonElement>('#quick-create-chat')!,
      createChatFormEl: document.querySelector<HTMLFormElement>('#create-chat-form')!,
      newChatNameEl: document.querySelector<HTMLInputElement>('#new-chat-name')!,
      togglePeopleDrawerEl: document.querySelector<HTMLButtonElement>('#toggle-people-drawer')!,
      rolePanelEl: document.querySelector<HTMLElement>('#role-panel')!,
      iframeHost: { restoreChat: vi.fn(() => []) },
      getLanguage: () => 'zh-CN',
      getCurrentChat: () => undefined,
      getCurrentRoles: () => [],
      getSelectedLoginSite: () => 'gemini',
      render: vi.fn(),
      renderChatList: vi.fn(),
      renderRolePanel: vi.fn(),
      renderAddPersonDialog: vi.fn(),
      closePeopleModals: vi.fn(),
      closeExternalModels: vi.fn(),
      registerComposerEvents: vi.fn(),
      registerPeopleLibraryEvents: vi.fn(),
      registerExternalModelsEvents: vi.fn(),
      runCommand: vi.fn(async () => undefined),
      showError: vi.fn(),
      log: { debug: vi.fn(), info: vi.fn() },
    }).registerUi()

    document.querySelector<HTMLButtonElement>('#open-group-template-create')!.click()
    const professionalCard = [...document.querySelectorAll<HTMLButtonElement>('.group-template-option')]
      .find(card => card.querySelector('strong')?.textContent === '小公司财务群')

    expect(professionalCard).toBeTruthy()
    const top = professionalCard!.querySelector<HTMLElement>('.group-template-option-top')!
    expect(top.querySelector<HTMLElement>('.group-template-risk')?.textContent).toBe('专业边界')
    expect(top.querySelector<HTMLElement>('.group-template-role-count')?.textContent).toBe('6 个角色')
    expect([...professionalCard!.children].some(child => child.classList.contains('group-template-card-footer'))).toBe(false)
  })

  it('renders a truncated preview of long group template summaries with the full text available on hover', () => {
    createTeamUiController({
      state: createTeamPageState(),
      settingsButtonEl: document.querySelector<HTMLButtonElement>('#settings-button')!,
      settingsMenuEl: document.querySelector<HTMLElement>('#settings-menu')!,
      quickCreateChatEl: document.querySelector<HTMLButtonElement>('#quick-create-chat')!,
      createChatFormEl: document.querySelector<HTMLFormElement>('#create-chat-form')!,
      newChatNameEl: document.querySelector<HTMLInputElement>('#new-chat-name')!,
      togglePeopleDrawerEl: document.querySelector<HTMLButtonElement>('#toggle-people-drawer')!,
      rolePanelEl: document.querySelector<HTMLElement>('#role-panel')!,
      iframeHost: { restoreChat: vi.fn(() => []) },
      getLanguage: () => 'zh-CN',
      getCurrentChat: () => undefined,
      getCurrentRoles: () => [],
      getSelectedLoginSite: () => 'gemini',
      render: vi.fn(),
      renderChatList: vi.fn(),
      renderRolePanel: vi.fn(),
      renderAddPersonDialog: vi.fn(),
      closePeopleModals: vi.fn(),
      closeExternalModels: vi.fn(),
      registerComposerEvents: vi.fn(),
      registerPeopleLibraryEvents: vi.fn(),
      registerExternalModelsEvents: vi.fn(),
      runCommand: vi.fn(async () => undefined),
      showError: vi.fn(),
      log: { debug: vi.fn(), info: vi.fn() },
    }).registerUi()

    document.querySelector<HTMLButtonElement>('#open-group-template-create')!.click()
    const card = document.querySelector<HTMLButtonElement>('.group-template-option')!
    const summary = card.querySelector<HTMLElement>('.group-template-summary')!
    const template = BUILTIN_GROUP_TEMPLATES[0]

    expect(card.classList.contains('has-long-summary')).toBe(true)
    expect(summary.classList.contains('group-template-summary-collapsed')).toBe(false)
    expect(summary.textContent).toBe(template.summary)
    expect(summary.title).toBe(template.summary)
  })

  it('closes the member panel and the new-chat form on Escape', () => {
    const state = createTeamPageState()
    const render = vi.fn()

    createTeamUiController({
      state,
      settingsButtonEl: document.querySelector<HTMLButtonElement>('#settings-button')!,
      settingsMenuEl: document.querySelector<HTMLElement>('#settings-menu')!,
      quickCreateChatEl: document.querySelector<HTMLButtonElement>('#quick-create-chat')!,
      createChatFormEl: document.querySelector<HTMLFormElement>('#create-chat-form')!,
      newChatNameEl: document.querySelector<HTMLInputElement>('#new-chat-name')!,
      togglePeopleDrawerEl: document.querySelector<HTMLButtonElement>('#toggle-people-drawer')!,
      rolePanelEl: document.querySelector<HTMLElement>('#role-panel')!,
      iframeHost: { restoreChat: vi.fn(() => []) },
      getLanguage: () => 'zh-CN',
      getCurrentChat: () => undefined,
      getCurrentRoles: () => [],
      getSelectedLoginSite: () => 'gemini',
      render,
      renderChatList: vi.fn(),
      renderRolePanel: vi.fn(),
      renderAddPersonDialog: vi.fn(),
      closePeopleModals: vi.fn(),
      closeExternalModels: vi.fn(),
      registerComposerEvents: vi.fn(),
      registerPeopleLibraryEvents: vi.fn(),
      registerExternalModelsEvents: vi.fn(),
      runCommand: vi.fn(async () => undefined),
      showError: vi.fn(),
      log: { debug: vi.fn(), info: vi.fn() },
    }).registerUi()

    document.querySelector<HTMLButtonElement>('#quick-create-chat')!.click()
    state.peopleDrawerOpen = true
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(document.querySelector<HTMLFormElement>('#create-chat-form')!.hidden).toBe(true)
    expect(document.querySelector<HTMLButtonElement>('#quick-create-chat')!.getAttribute('aria-expanded')).toBe('false')
    expect(state.peopleDrawerOpen).toBe(false)
    expect(render).toHaveBeenCalledTimes(1)
  })
})

function makeChat(id: string, roleIds: string[]): GroupChat {
  return {
    id,
    name: '群聊',
    mode: 'independent',
    roleIds,
    messageIds: [],
    nextMessageSeq: 1,
    status: 'ready',
    createdAt: 1,
    updatedAt: 1,
  }
}

function makeRole(chatId: string, id: string): GroupRole {
  return {
    id,
    chatId,
    name: id,
    status: 'ready',
    contextCursor: 0,
    createdAt: 1,
    updatedAt: 1,
  }
}

function teamUiBody(): string {
  return `
  <button id="settings-button"></button>
  <div id="settings-menu" hidden></div>
  <button id="quick-create-chat"></button>
  <form id="create-chat-form" hidden>
    <input id="new-chat-name" />
    <input name="new-chat-mode" value="independent" checked />
    <button id="open-group-template-create" type="button"></button>
  </form>
  <div id="group-template-modal" hidden>
    <button id="close-group-template-modal"></button>
    <input id="group-template-search" />
    <div id="group-template-categories"></div>
    <div id="group-template-list"></div>
    <button id="confirm-group-template-create"></button>
  </div>
  <button id="toggle-people-drawer"></button>
  <aside id="role-panel"></aside>
  <button id="close-people-drawer"></button>
  <button id="close-window"></button>
  <button id="cancel-create-chat"></button>
  <button id="restore-chat"></button>
  <button id="open-gemini-login"></button>
`
}
