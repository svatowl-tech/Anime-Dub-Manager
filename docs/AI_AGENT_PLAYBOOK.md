# AI Agent Playbook — Anime Dub Manager (Curator Automation)

This guide enables any local AI agent (OpenClaw, Claude Desktop, Continue, Goose, n8n, custom Python/LangGraph/Ollama agent) running on Umbrel OS or a local workstation to perform the full Anime Dub Manager curator workflow autonomously while keeping the human curator in control via the **Curator Inbox** and **Telegram**.

---

## 1. Connection Transports & Authentication

Retrieve your `AGENT_TOKEN` in the Web UI under **Настройки → Umbrel Сервер, AI-агент и Уведомления** (or set `ADM_AGENT_TOKEN` in `.env` / Umbrel compose).

### A. MCP Streamable HTTP (Recommended for Remote/Local Network Agents)
- **Endpoint**: `http://<server-host>:3000/mcp`
- **Headers**:
  - `Authorization: Bearer <AGENT_TOKEN>` (or `x-agent-token: <AGENT_TOKEN>`)

### B. MCP Legacy SSE (For clients that only support `/sse`)
- **SSE Stream**: `http://<server-host>:3000/sse`
- **Message POST**: `http://<server-host>:3000/messages`
- **Headers**: `Authorization: Bearer <AGENT_TOKEN>`

### C. MCP Stdio (Local process inside the container or host)
```json
{
  "mcpServers": {
    "anime-dub-manager": {
      "command": "npx",
      "args": ["tsx", "server/mcpStdio.ts"],
      "env": {
        "ADM_SERVER_MODE": "true",
        "ADM_DATA_DIR": "/data",
        "ADM_AI_ENV_DIR": "/opt/ai_env"
      }
    }
  }
}
```

### D. REST API + OpenAPI v3.1
- **OpenAPI Spec**: `GET http://<server-host>:3000/api/v1/openapi.json` (can be imported directly into Open WebUI Tools, Dify, Flowise, n8n, LangChain, or CrewAI)
- **Tools List**: `GET http://<server-host>:3000/api/v1/tools`
- **Execute Any Tool**: `POST http://<server-host>:3000/api/v1/tools/<tool_name>` with JSON body `{ ...args }` and `Authorization: Bearer <AGENT_TOKEN>`

### E. CLI (`server/cli.ts`)
Set `ADM_SERVER_URL=http://<server-host>:3000` and `ADM_AGENT_TOKEN=<AGENT_TOKEN>`:
```bash
npx tsx server/cli.ts --help
npx tsx server/cli.ts overview
npx tsx server/cli.ts projects
npx tsx server/cli.ts inbox --status pending
npx tsx server/cli.ts respond --id <notification_id> --status approved --note "Ок, запускай сборку"
```

---

## 2. Standard Curator Workflow (End-to-End SOP)

1. **Discover Workspace & Participants**
   - `get_overview` — inspect server health, AI runtime, active tasks, and pending curator inbox items.
   - `list_participants` — list all dubbers, sound engineers, and their Telegram handles.
2. **Prepare Project & Episode**
   - `list_projects` / `save_project` — create or locate project (`title`, `releaseType`: `VOICEOVER | RECAST | REDUB`, `year`, `genres`).
   - `save_episode` — create or update an episode.
3. **Download Raw Media & Subtitles**
   - `search_torrents` -> `get_torrent_metadata` -> `download_episode_media` -> poll `get_task_status` / `list_tasks`.
   - Or `search_anime` / `sync_project_anime365` / `download_episode_media` (Anime365 or YouTube).
4. **Parse Subtitles & Assign Roles**
   - `inspect_subtitles` / `auto_fix_subtitles` — extract characters and line counts.
   - `assign_dubbers` + `split_subtitles_by_dubber` — map characters to dubbers (`dubberId`) and optionally notify Telegram.
   - **Best Practice**: Notify the curator via `notify_curator` with `category: "assignment_review"` or `severity: "action_required"` so the curator can review the casting in Web Inbox / Telegram.
5. **Collect Takes, Run Quality Assurance (QA) & Auto-Timing**
   - `scan_telegram_tracks` -> `download_telegram_track` -> `run_audio_analysis`.
   - `run_qa_check` — transcribe recorded dubber takes with Whisper and compare against ASS script.
   - `run_auto_timing` — align episode tracks and resolve timing collisions.
6. **Notify Curator Before Final Release**
   - Call `notify_curator` with:
     - `category: "approval"`
     - `severity: "action_required"`
     - `projectId`, `episodeNumber`, `targetTab: "qa"` (or `"release"`)
     - `proposedAction`: concise summary of changes.
   - Poll `get_inbox_item` or `list_curator_inbox` for human curator verdict (`approved` / `rejected` / `noted`) and `curatorNote`.
7. **Render & Export**
   - `export_for_sound_engineer` — prepare timed WAV/stems pack for the sound engineer.
   - `build_release` — render final release MP4/MKV.
   - Call `notify_curator` with `category: "release_ready"` (and optionally `send_telegram_message` for release announcements).

---

## 3. All Registered MCP Tools

- **Overview & Tasks**: `get_overview`, `list_tasks`, `get_task_status`, `abort_task`
- **Projects & Episodes**: `list_projects`, `get_project`, `save_project`, `list_episodes`, `get_episode`, `save_episode`
- **Participants**: `list_participants`, `save_participant`
- **Media & Downloads**: `search_anime`, `sync_project_anime365`, `search_torrents`, `get_torrent_metadata`, `download_episode_media`
- **Subtitles & Roles**: `inspect_subtitles`, `auto_fix_subtitles`, `split_subtitles_by_dubber`, `assign_dubbers`
- **Telegram Tracks & AI Audio / QA / Timing**: `scan_telegram_tracks`, `download_telegram_track`, `run_audio_analysis`, `run_qa_check`, `run_auto_timing`
- **Mixing & Release**: `export_for_sound_engineer`, `build_release`
- **Telegram & Curator Inbox**: `send_telegram_message`, `notify_curator`, `list_curator_inbox`, `get_inbox_item`, `respond_curator_inbox`
- **Generic Escape Hatch**: `invoke_ipc_raw` (invoke any registered backend IPC channel directly)
