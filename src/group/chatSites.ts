import type { ChatSite } from './types'

/**
 * Every chat site OpenTeam can host a member in, in display order.
 * Keeping the list in one place keeps the manifest, adapters, and UI in sync.
 */
export const CHAT_SITE_LIST: readonly ChatSite[] = ['gemini', 'chatgpt', 'claude', 'deepseek', 'grok', 'kimi', 'glm', 'qwen']

export const DEFAULT_CHAT_SITE: ChatSite = 'gemini'

export function isChatSite(value: unknown): value is ChatSite {
  return typeof value === 'string' && (CHAT_SITE_LIST as readonly string[]).includes(value)
}

export function chatSiteLabel(site: ChatSite | undefined): string {
  switch (site) {
    case 'chatgpt':
      return 'ChatGPT'
    case 'claude':
      return 'Claude'
    case 'deepseek':
      return 'DeepSeek'
    case 'grok':
      return 'Grok'
    case 'kimi':
      return 'Kimi'
    case 'glm':
      return '智谱清言'
    case 'qwen':
      return 'Qwen'
    default:
      return 'Gemini'
  }
}
