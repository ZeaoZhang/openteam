# OpenTeam

**🌐 Language:** English | [简体中文](README.zh-CN.md)

> A local-first AI team workspace that turns your existing ChatGPT, Claude, Gemini, DeepSeek, Grok, Kimi, Zhipu GLM, and Qwen web sessions into a multi-agent discussion room.

OpenTeam is a Manifest V3 Chrome extension. It does not require model API keys and does not spend extra ChatGPT, Claude, Gemini, DeepSeek, Grok, Kimi, GLM, or Qwen API tokens. Instead, it reuses the AI accounts you already have open in your browser, sends tasks to those web sessions, and gathers replies from different people and models into one shared team chat.

Use it for learning, research, and personal non-commercial experiments where one answer is not enough: product reviews, technical design reviews, content planning, personal decisions, multi-model comparison, and multi-step work that benefits from several AI roles thinking together.

## 🌱 Background

OpenTeam is a sister project to [OpenLink](https://github.com/afumu/openlink), an earlier browser extension I built around using the browser itself as the working surface. While building OpenLink, I already wanted a companion extension that could reuse signed-in browser sessions to talk with large language models and compare answers across models, but that idea stayed on the shelf while other work got busy.

The idea became concrete after I met Lu ([YUANLU007](https://github.com/YUANLU007)), a news editor. In her writing workflow, she often needs to compare several AI systems, inspect how different models answer the same question, and use multiple perspectives for factual checks. That matched the original OpenLink idea closely, so OpenTeam became its sister project: a local browser workspace for sending one task to multiple AI web sessions and gathering their responses in one discussion room.

![OpenTeam group chat preview](docs/assets/group-chat-ui-concept.png)

## 💬 Community

Join the OpenTeam WeChat community by scanning the QR code below. If the QR code has expired, add WeChat ID `afumudev` and include `OpenTeam` in your request so I can invite you to the group.

<p>
  <img src="docs/assets/openteam-wechat-group-qr.jpg" alt="OpenTeam WeChat community QR code" width="280">
</p>

## ✨ Highlights

- 🚫 **0 API token workflow**: reuse AI website sessions instead of calling model APIs directly.
- 🧩 **Multi-model discussion**: coordinate Gemini, ChatGPT, Claude, DeepSeek, Grok, Kimi, Zhipu GLM, and Qwen web sessions in one chat.
- 🧑‍🏫 **Built-in advisor library**: start with 38 expert and thinking-style advisor templates, or create your own people.
- 📣 **Mention-based routing**: use `@person` to ask one member, or `@everyone` to dispatch the same task to the whole team.
- 🔄 **Independent and collaborative modes**: compare isolated perspectives first, then let members reference, challenge, and build on each other.
- 💾 **Local-first storage**: chats, people, messages, notes, highlights, and settings are stored in browser storage.
- 🤖 **Agent control CLI**: optional `openteamcli` support lets local agents create chats, add roles, post tasks, and wait for replies.
- 🪟 **Two hosting modes per member**: keep a member embedded in the team workspace, or run its AI page in its own browser tab when the site blocks embedded frames.
- 🔌 **Connection check**: the settings menu reports every member's link state and which sites are usable inside the embedded workspace.

## 🧭 How It Works

Each OpenTeam member is bound to an AI website session. When you send a message, OpenTeam builds a prompt from the chat mode, member persona, referenced messages, and shared context. The extension then delivers that prompt into the member's AI page and listens for the reply.

By default that AI page is embedded in the team workspace as an iframe. A member can also be switched to **independent tab hosting** from its member card; the page then runs in its own browser tab and the same prompt/reply pipeline talks to that tab. Use tab hosting for sites that break inside embedded frames: Grok blocks its reply WebSocket there, Kimi ignores scripted sends, and Zhipu GLM keeps re-asking for its slider check. Those three sites default to tab hosting.

```text
team.html
  -> background service worker
  -> AI site iframe (embedded) or AI site tab (independent tab hosting)
  -> content script
  -> AI webpage reply
  -> OpenTeam message stream
```

Supported site types:

| Site | Common fit |
| --- | --- |
| Gemini | Long context, research, multimodal material |
| ChatGPT | General execution, tool-shaped workflows, fast iteration |
| Claude | Long documents, review, structured writing, careful reasoning |
| DeepSeek | Code, reasoning, Chinese-language work, cost-sensitive tasks |
| Grok | Current-events research, alternative phrasing, X/Grok web-session workflows |
| Kimi | Long Chinese documents, writing, agent-shaped tasks |
| Zhipu GLM | Chinese-language Q&A, writing, general assistance |
| Qwen | Chinese/English general work, code, translation |

These are practical defaults, not rankings. Actual quality depends on model versions, account plans, task type, and input material.

## ⚠️ Disclaimer

OpenTeam is an unofficial project for learning, research, and personal non-commercial use only. It is not affiliated with, endorsed by, or supported by OpenAI, Anthropic, Google, DeepSeek, xAI, or any supported AI website.

OpenTeam interacts with AI websites through user-authenticated browser sessions and DOM automation. Website changes, account rules, rate limits, anti-abuse systems, or terms of service may affect whether it works. You are responsible for reviewing and complying with the rules, policies, laws, and regulations that apply to your use.

Do not use OpenTeam for commercial products, hosted services, paid workflows, bulk automation, spam, scraping, bypassing access controls, bypassing paid access, or any activity that violates third-party terms or rights.

Use it at your own risk. The maintainers are not responsible for account restrictions, service interruptions, data loss, legal issues, or other consequences arising from your use. This notice is not legal advice.

## 🚀 Install

### Option 1: Build the Extension From Source

Most users only need the browser extension:

```bash
git clone https://github.com/afumu/openteam.git
cd openteam
npm install
npm run build
```

After the build finishes, open `chrome://extensions/`, turn on Developer mode, click **Load unpacked**, select the generated `dist/` directory, and then click the OpenTeam extension icon to open the team workspace.

### Option 2: CLI + Agent Skill

Use this path if you want Codex, Claude Code, or another local agent to control OpenTeam chats. Install the CLI from npm, then install the agent skill:

```bash
npm install -g @afumu/openteamcli
npx skills add afumu/openteam --skill openteam-control
openteamcli daemon start
openteamcli doctor
```

The skills installer will ask which agent, scope, and install method to use. Use the GitHub command above for the public repository; if you are developing from a local checkout or unzipped source package, install the skill from the repository root instead:

```bash
npx skills add . --skill openteam-control
```

After installation, open the OpenTeam extension page and enable local agent control in settings. See [OpenTeam CLI](packages/openteamcli/README.md) for more CLI details.

## 🛠️ Development From Source

```bash
npm install
npm run dev
```

Build the extension and load the generated `dist/` directory from `chrome://extensions/` with Developer mode enabled.

Useful checks:

```bash
npm run typecheck
npm test
npm run build
npm run verify
```

`npm run verify` runs type checking, unit tests, and a production build.

## 🔐 Permissions and Privacy

OpenTeam is local-first, but it needs browser-extension permissions that are worth reviewing before installation:

- `storage`: save chats, people, notes, settings, and local state.
- `tabs`: locate and communicate with extension and AI-site tabs/frames.
- `alarms`: schedule runtime maintenance tasks.
- `declarativeNetRequest`: adjust response headers so supported AI websites can be embedded in the extension iframe workspace.
- `clipboardRead` / `clipboardWrite`: support copy and clipboard-based interactions.
- Host permissions: allow OpenTeam to work with supported AI websites and embedded web sessions.

OpenTeam does not provide cloud sync. Your AI conversations are still processed by the AI websites you use, under their own account rules, usage limits, privacy policies, and terms of service.

## 🚧 Current Limits

- OpenTeam is Chrome / Chromium-first.
- AI-site adapters depend on page DOM structure, so website redesigns can break prompt sending or reply capture.
- The iframe workspace requires response-header changes through `declarativeNetRequest`, which makes the permission surface heavier than a normal popup extension.
- Some sites work poorly inside an embedded frame, and default to tab hosting: Grok (its reply WebSocket is blocked in frames), Kimi (ignores scripted sends in frames and persists unsent drafts to the account), and Zhipu GLM (keeps asking for a slider human check in new pages).
- Zhipu GLM can only send after a human drags its slider once in the hosting tab; OpenTeam detects that state and asks you to verify instead of hanging.
- Kimi and some other sites rate-limit free accounts; OpenTeam surfaces the site's throttling message instead of waiting for a reply that will never arrive.
- Built-in famous-person advisor templates are prompt templates inspired by public ideas. They are not real people and should not be presented as real participation.
- Medical, legal, financial, and other high-stakes outputs still require human judgment and qualified professional advice.

## 🗂️ Repository Layout

```text
public/                 Chrome extension manifest, team page, styles, DNR rules
src/background/         service worker, command handlers, runtime routing
src/content/            AI-site content scripts, adapters, reply observation
src/group/              group data model, store, roles, prompts, mention parsing
src/teamPage/           OpenTeam workspace UI
packages/openteamcli/   local CLI and daemon for agent control
docs/                   design documents and assets
```

## 🤝 Contributing

Issues and pull requests are welcome. Good starting areas include:

- AI-site adapter fixes when target websites change.
- Permission and privacy hardening.
- Test coverage for group routing, prompt construction, storage, and UI flows.
- Documentation, examples, and onboarding improvements.
- New advisor templates or orchestration patterns with clear boundaries.

Before opening a pull request, run:

```bash
npm run verify
```

## 📚 Documentation

- [Design document](docs/DESIGN.md)
- [OpenTeam CLI](packages/openteamcli/README.md)

## 📜 License

OpenTeam is released under the [PolyForm Noncommercial License 1.0.0](LICENSE), using the SPDX identifier `PolyForm-Noncommercial-1.0.0`.

You may use, study, modify, and redistribute the project for non-commercial purposes only. Commercial use, commercial redistribution, hosted commercial services, paid workflows, and productized commercial use are not permitted without separate written permission.
