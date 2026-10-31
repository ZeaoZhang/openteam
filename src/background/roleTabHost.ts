import type { AttachRoleMessage } from '../group/runtimeProtocol'
import type { GroupRole } from '../group/types'

export interface RoleTabHostDependencies {
  tabs?: Pick<typeof chrome.tabs, 'create' | 'get' | 'update' | 'remove' | 'reload' | 'sendMessage'>
  log: {
    info(event: string, details?: Record<string, unknown>): void
    warn(event: string, details?: Record<string, unknown>): void
  }
}

export interface OpenRoleTabOptions {
  role: Pick<GroupRole, 'id' | 'chatId' | 'name'>
  url: string
  existingTabId?: number
}

export interface OpenRoleTabResult {
  tabId: number
  created: boolean
}

export interface RoleTabHost {
  open(options: OpenRoleTabOptions): Promise<OpenRoleTabResult>
  focus(tabId: number): Promise<boolean>
  close(tabId: number): Promise<void>
  isAlive(tabId: number): Promise<boolean>
  attach(message: AttachRoleMessage, tabId: number): Promise<boolean>
  /** Reloads the tab so a stale content script (e.g. after an extension reload) gets re-injected. */
  reload(tabId: number): Promise<boolean>
}

const ATTACH_RETRY_COUNT = 10
const ATTACH_RETRY_DELAY_MS = 800

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function createRoleTabHost(deps: RoleTabHostDependencies): RoleTabHost {
  const tabs = deps.tabs ?? chrome.tabs

  const isAlive = async (tabId: number): Promise<boolean> => {
    try {
      const tab = await tabs.get(tabId)
      return Boolean(tab?.id !== undefined)
    } catch {
      return false
    }
  }

  const focus = async (tabId: number): Promise<boolean> => {
    try {
      const tab = await tabs.update(tabId, { active: true })
      if (tab?.windowId !== undefined) {
        try {
          await chrome.windows.update(tab.windowId, { focused: true })
        } catch {
          // window focus is best-effort
        }
      }
      return true
    } catch (error) {
      deps.log.warn('role-tab:focus-failed', { tabId, error: error instanceof Error ? error.message : String(error) })
      return false
    }
  }

  const close = async (tabId: number): Promise<void> => {
    try {
      await tabs.remove(tabId)
    } catch (error) {
      deps.log.warn('role-tab:close-failed', { tabId, error: error instanceof Error ? error.message : String(error) })
    }
  }

  const attach = async (message: AttachRoleMessage, tabId: number): Promise<boolean> => {
    for (let attempt = 0; attempt < ATTACH_RETRY_COUNT; attempt += 1) {
      try {
        const response = (await tabs.sendMessage(tabId, message, { frameId: 0 })) as { ok?: boolean } | undefined
        if (response?.ok) {
          deps.log.info('role-tab:attach-accepted', { tabId, roleId: message.roleId, attempt })
          return true
        }
      } catch (error) {
        deps.log.warn('role-tab:attach-attempt-failed', {
          tabId,
          roleId: message.roleId,
          attempt,
          error: error instanceof Error ? error.message : String(error),
        })
      }
      await delay(ATTACH_RETRY_DELAY_MS)
    }
    return false
  }

  const reload = async (tabId: number): Promise<boolean> => {
    try {
      await tabs.reload(tabId)
      deps.log.info('role-tab:reloaded', { tabId })
      return true
    } catch (error) {
      deps.log.warn('role-tab:reload-failed', { tabId, error: error instanceof Error ? error.message : String(error) })
      return false
    }
  }

  const open = async (options: OpenRoleTabOptions): Promise<OpenRoleTabResult> => {
    const existingTabId = options.existingTabId
    if (existingTabId !== undefined && (await isAlive(existingTabId))) {
      await focus(existingTabId)
      deps.log.info('role-tab:reused', { roleId: options.role.id, tabId: existingTabId })
      return { tabId: existingTabId, created: false }
    }

    const tab = await tabs.create({ url: options.url, active: false })
    const tabId = tab?.id
    if (tabId === undefined) throw new Error('无法打开角色标签页：浏览器没有返回标签页 ID')
    deps.log.info('role-tab:created', { roleId: options.role.id, tabId, url: options.url })
    return { tabId, created: true }
  }

  return { open, focus, close, isAlive, attach, reload }
}
