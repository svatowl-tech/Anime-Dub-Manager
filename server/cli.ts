import fs from 'fs';
import path from 'path';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

function resolveConfig() {
  const serverUrl = (
    process.env.ADM_SERVER_URL ||
    `http://127.0.0.1:${process.env.APP_PORT || process.env.PORT || 3000}`
  ).replace(/\/+$/, '');

  let agentToken = (process.env.ADM_AGENT_TOKEN || '').trim();
  if (!agentToken) {
    const candidateDirs = [
      process.env.ADM_DATA_DIR,
      '/data',
      path.join(process.cwd(), 'server_data'),
      path.join(process.cwd(), 'mock_user_data'),
    ].filter(Boolean) as string[];
    for (const dir of candidateDirs) {
      const authFile = path.join(dir, 'server_auth.json');
      try {
        if (fs.existsSync(authFile)) {
          const parsed = JSON.parse(fs.readFileSync(authFile, 'utf8'));
          if (parsed?.agentToken) {
            agentToken = String(parsed.agentToken);
            break;
          }
        }
      } catch {}
    }
  }
  return { serverUrl, agentToken };
}

function parseFlags(argv: string[]) {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags };
}

function printHelp() {
  console.log(`Anime Dub Manager CLI (Agent & Curator Control)

Usage:
  npm run cli -- <command> [options] [--json]

Commands:
  overview                                  Show server, AI_env, queue & inbox summary
  playbook                                  Print the AI Curator Playbook instructions
  projects [--archived]                     List projects
  project <projectId>                       Get detailed project info & episodes
  episodes [--project <projectId>]          List episodes
  episode <episodeId>                       Get episode details
  participants                              List studio participants (dubbers, engineers)
  search-anime <query> [--source all|anime365]
  search-torrents <query>
  download --source anime365|torrent|youtube --url <url> --target-dir <dir> --file-name <name> [--episode <id>]
  tasks                                     List active background tasks & downloads
  task <taskId>                             Check status of a background task
  assign --episode <id> --json-assignments '<json>' [--notify-tg --chat <peer> --topic <id>]
  scan-tg-tracks --chat <peer> [--topic <id>] [--limit 100]
  qa --episode <id> --audio <path> [--model small]
  auto-timing --episode <id>
  export-se --episode <id> [--target-dir <dir>]
  inbox [--status pending|all|approved|rejected]
  notify --title <t> --message <m> [--category approval|qa_alert|info] [--severity action_required|info|warning] [--project <id>] [--episode <id>] [--tab <tab>]
  respond --id <inboxId> --status approved|rejected|noted|resolved [--note <text>]
  tool <toolName> [--payload '<json>']      Call any MCP tool directly with JSON payload

Environment:
  ADM_SERVER_URL     Default: http://127.0.0.1:3000
  ADM_AGENT_TOKEN    Bearer token for agent authentication (auto-detected locally if omitted)
`);
}

async function run() {
  const { positionals, flags } = parseFlags(process.argv.slice(2));
  const cmd = positionals[0];

  if (!cmd || cmd === 'help' || flags.help) {
    printHelp();
    process.exit(0);
  }

  const { serverUrl, agentToken } = resolveConfig();
  const client = axios.create({
    baseURL: `${serverUrl}/api/v1`,
    timeout: 180000,
    headers: {
      'Content-Type': 'application/json',
      ...(agentToken ? { Authorization: `Bearer ${agentToken}` } : {}),
    },
  });

  const callTool = async (toolName: string, payload: Record<string, any> = {}) => {
    const res = await client.post(`/tools/${encodeURIComponent(toolName)}`, payload);
    if (!res.data?.success) {
      throw new Error(res.data?.error || `Tool ${toolName} failed`);
    }
    return res.data.data;
  };

  let output: any;
  switch (cmd) {
    case 'overview':
      output = await callTool('get_overview');
      break;
    case 'playbook': {
      const res = await client.get('/playbook');
      console.log(res.data);
      return;
    }
    case 'projects':
      output = await callTool('list_projects', { includeArchived: Boolean(flags.archived) });
      break;
    case 'project':
      output = await callTool('get_project', { projectId: positionals[1] || String(flags.id || '') });
      break;
    case 'episodes':
      output = await callTool('list_episodes', {
        projectId: typeof flags.project === 'string' ? flags.project : undefined,
      });
      break;
    case 'episode':
      output = await callTool('get_episode', { episodeId: positionals[1] || String(flags.id || '') });
      break;
    case 'participants':
      output = await callTool('list_participants');
      break;
    case 'search-anime':
      output = await callTool('search_anime', {
        query: positionals.slice(1).join(' ') || String(flags.query || ''),
        source: flags.source === 'all' ? 'all' : 'anime365',
      });
      break;
    case 'search-torrents':
      output = await callTool('search_torrents', {
        query: positionals.slice(1).join(' ') || String(flags.query || ''),
      });
      break;
    case 'download':
      output = await callTool('download_episode_media', {
        sourceType: String(flags.source || 'anime365'),
        url: typeof flags.url === 'string' ? flags.url : undefined,
        magnet: typeof flags.magnet === 'string' ? flags.magnet : undefined,
        targetDir: typeof flags['target-dir'] === 'string' ? flags['target-dir'] : undefined,
        fileName: typeof flags['file-name'] === 'string' ? flags['file-name'] : undefined,
        episodeId: typeof flags.episode === 'string' ? flags.episode : undefined,
      });
      break;
    case 'tasks':
      output = await callTool('list_tasks');
      break;
    case 'task':
      output = await callTool('get_task_status', { taskId: positionals[1] || String(flags.id || '') });
      break;
    case 'assign': {
      const rawAssignments = String(flags['json-assignments'] || '[]');
      output = await callTool('assign_dubbers', {
        episodeId: String(flags.episode || ''),
        assignments: JSON.parse(rawAssignments),
        notifyTelegram: Boolean(flags['notify-tg']),
        telegramChatPeer: typeof flags.chat === 'string' ? flags.chat : undefined,
        telegramTopicId: flags.topic ? Number(flags.topic) : undefined,
      });
      break;
    }
    case 'scan-tg-tracks':
      output = await callTool('scan_telegram_tracks', {
        chatPeer: String(flags.chat || ''),
        topicId: flags.topic ? Number(flags.topic) : undefined,
        limit: flags.limit ? Number(flags.limit) : 100,
      });
      break;
    case 'qa':
      output = await callTool('run_qa_check', {
        episodeId: String(flags.episode || ''),
        audioFilePath: String(flags.audio || ''),
        model: typeof flags.model === 'string' ? flags.model : 'small',
      });
      break;
    case 'auto-timing':
      output = await callTool('run_auto_timing', { episodeId: String(flags.episode || '') });
      break;
    case 'export-se':
      output = await callTool('export_for_sound_engineer', {
        episodeId: String(flags.episode || ''),
        targetDir: typeof flags['target-dir'] === 'string' ? flags['target-dir'] : undefined,
      });
      break;
    case 'inbox':
      output = await callTool('list_curator_inbox', {
        status: typeof flags.status === 'string' ? flags.status : 'all',
      });
      break;
    case 'notify':
      output = await callTool('notify_curator', {
        title: String(flags.title || 'Уведомление агента'),
        message: String(flags.message || ''),
        category: typeof flags.category === 'string' ? flags.category : 'info',
        severity: typeof flags.severity === 'string' ? flags.severity : 'info',
        projectId: typeof flags.project === 'string' ? flags.project : undefined,
        episodeId: typeof flags.episode === 'string' ? flags.episode : undefined,
        targetTab: typeof flags.tab === 'string' ? flags.tab : undefined,
      });
      break;
    case 'respond':
      output = await callTool('respond_curator_inbox', {
        id: String(flags.id || positionals[1] || ''),
        status: typeof flags.status === 'string' ? flags.status : undefined,
        curatorNote: typeof flags.note === 'string' ? flags.note : undefined,
      });
      break;
    case 'tool': {
      const toolName = positionals[1];
      if (!toolName) throw new Error('Specify tool name: npm run cli -- tool <toolName> --payload "{}"');
      const payload = typeof flags.payload === 'string' ? JSON.parse(flags.payload) : {};
      output = await callTool(toolName, payload);
      break;
    }
    default:
      throw new Error(`Unknown command "${cmd}". Run with --help for usage.`);
  }

  console.log(JSON.stringify(output, null, 2));
}

run().catch((err) => {
  const message = err?.response?.data?.error || err?.message || String(err);
  console.error(JSON.stringify({ success: false, error: message }, null, 2));
  process.exit(1);
});
