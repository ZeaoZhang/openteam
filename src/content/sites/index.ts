import { createClaudeAdapter } from './claude'
import { createChatGptAdapter } from './chatgpt'
import { createDeepSeekAdapter } from './deepseek'
import { createGeminiAdapter } from './gemini'
import { createGlmAdapter } from './glm'
import { createGrokAdapter } from './grok'
import { createKimiAdapter } from './kimi'
import { createQwenAdapter } from './qwen'
import type { ChatSiteAdapter } from './types'

export function getActiveChatSiteAdapter(): ChatSiteAdapter {
  if (location.hostname === 'claude.ai') return createClaudeAdapter()
  if (location.hostname === 'chat.deepseek.com') return createDeepSeekAdapter()
  if (location.hostname === 'chatgpt.com' || location.hostname === 'chat.openai.com') return createChatGptAdapter()
  if (location.hostname === 'grok.com') return createGrokAdapter()
  if (location.hostname === 'www.kimi.com' || location.hostname === 'kimi.com') return createKimiAdapter()
  if (location.hostname === 'chatglm.cn' || location.hostname === 'www.chatglm.cn') return createGlmAdapter()
  if (location.hostname === 'chat.qwen.ai' || location.hostname === 'qwen.ai') return createQwenAdapter()
  return createGeminiAdapter()
}
