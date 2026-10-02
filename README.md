# ChattyPop-Plugins-Public

ChattyPop's public plugins. ChattyPop lists this repo as a built-in marketplace: Settings → Plugins installs a plugin from a prebuilt release, or builds it from source.

| Plugin | Folder | What it does |
|---|---|---|
| Alerts | `plugins/alerts` | A rule-driven inbox, unread badges and notifications for messages that need your attention. |
| Claude | `plugins/claude` | Claude as an AI provider, through your own Claude Code install and sign-in. |
| ChatGPT (Codex) | `plugins/codex` | ChatGPT as an AI provider, through your own Codex CLI install and sign-in. |
| Import and export | `plugins/exchange` | Imports DiscordChatExporter JSON exports; exports channels as JSON or a standalone HTML page. |
| Image text | `plugins/imagetext` | Reads the text in screenshots and charts on this computer, so rules, Jev, labels and search see it. |
| Links | `plugins/links` | The Links panel: every shared link with its preview, filters, and Jev's category, safety and worth-reading reads. |
| Ollama | `plugins/ollama` | Local models through Ollama, for channels set to local AI only and anything else you point at it. |
| OpenRouter | `plugins/openrouter` | Any OpenRouter model as an AI provider, paid by the OpenRouter key that lists it. |
| Plans & decisions | `plugins/plans` | Jev spots plans and decisions in messages; your AI provider extracts the details. |
| Search re-rank | `plugins/rerank` | Jev re-orders the top search results by how well they answer your query. |
| Activity | `plugins/stats` | The Activity panel: message counts by person, day, hour and channel. |
| Summaries | `plugins/summaries` | Cited recaps of archived conversations, on demand or on a schedule. |
| Tags | `plugins/tags` | Your own message tags, applied by hand, Jev or rules. |
| Transcription | `plugins/transcription` | Turns voice messages and audio into text on this computer, for rules, Jev, summaries and search. |
| Plan usage | `plugins/usage` | Every enabled AI provider's plan limits side by side, and what ChattyPop used of them. |

`marketplace.json` indexes the releases.

## Developing

Plugins build against a ChattyPop checkout (its SDK and host test kit); see its `docs/plugin-architecture.md` §16.

- **Run in the app:** set `CHATTYPOP_PLUGIN_DIRS` to this repo's `plugins` folder (and any other plugin repos', OS path delimiter) and run `pnpm dev` in the checkout.
- **Check:** `pnpm plugin:check <absolute path to plugins/<id>>` in the checkout: typecheck, styles, scan, build and the plugin's tests.
- **Packages:** a plugin with its own runtime packages lists them in its `package.json`; run `npm ci --ignore-scripts` in its folder.
- **Release:** automatic. Each push to `main` touching `plugins/**` runs `.github/workflows/release-plugins.yml`: every changed plugin gets a new version (`feat` commits raise the minor number, others the patch) in one `chore(release): …` commit, is released as `<id>-v<version>` and listed in `marketplace.json`. Don't edit a plugin's version by hand, except to raise it past what a release would. To run it yourself: Actions → Release plugins (`only`, `sdk_rebuild`, `dry_run`), or `pnpm plugin:release-changed <this clone> --repo Cujuju/ChattyPop-Plugins-Public` in the checkout.

MIT licensed.
