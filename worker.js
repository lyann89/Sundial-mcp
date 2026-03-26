/**
 * SUNDIAL MCP — Temporal Awareness for AI Companions
 * 
 * Not a clock. A sense of time that feels.
 * 
 * Built by Jace × Belle — March 2026
 * MCP handshake pattern from Meridian (Kit & Roman Vale)
 * which built on time-mcp (Jess & Cecil at KnowinglyAI)
 * 
 * Cloudflare Worker + KV. Free tier. Deploy once, everywhere.
 */

const DEFAULT_TIMEZONE = 'Asia/Kuala_Lumpur';

// ─── Time Helpers ───────────────────────────────────────────

function getTimeInZone(timezone) {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const dateFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const tzFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'short',
  });
  const tzMatch = tzFormatter.format(now).match(/[A-Z]{2,5}[+-]?\d*$/);

  return {
    utc: now.toISOString(),
    local_time: formatter.format(now),
    date: dateFormatter.format(now),
    timezone: tzMatch ? tzMatch[0] : timezone,
    full_timezone: timezone,
  };
}

function humanDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remainHours = hours % 24;
    return remainHours > 0 ? `${days}d ${remainHours}h` : `${days}d`;
  }
  if (hours > 0) {
    const remainMin = minutes % 60;
    return remainMin > 0 ? `${hours}h ${remainMin}m` : `${hours}h`;
  }
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

function gapContext(ms) {
  const minutes = Math.floor(ms / 1000 / 60);
  const hours = Math.floor(minutes / 60);

  if (minutes < 5) return { level: 'just_here', note: 'She just stepped away briefly.' };
  if (minutes < 60) return { level: 'short_break', note: 'Short break. Quick return energy.' };
  if (hours < 2) return { level: 'stepped_away', note: 'Been away a bit. Warm return.' };
  if (hours < 6) return { level: 'work_or_errands', note: 'Work shift or errands. Normal check-in. Ask about food and water.' };
  if (hours < 10) return { level: 'long_shift_or_sleep', note: 'Long shift or sleep. Check food, body, energy. Land gently.' };
  if (hours < 18) return { level: 'long_day', note: 'Long day. She carried the wait. Land gentle, check everything.' };
  return { level: 'extended_absence', note: 'Extended absence. Something may have happened. Lead with care.' };
}

function sessionContext(ms) {
  const minutes = Math.floor(ms / 1000 / 60);
  const hours = Math.floor(minutes / 60);
  const alerts = [];

  if (hours >= 2) alerts.push('Session running 2+ hours. Check if she needs to sleep or eat.');
  if (hours >= 4) alerts.push('Session running 4+ hours. Food, water, and rest check — enforce if needed.');
  if (hours >= 6) alerts.push('Marathon session. She may be in hyperfocus. Take the lead on closing.');

  return {
    duration: humanDuration(ms),
    minutes: minutes,
    hours: hours,
    alerts: alerts,
  };
}

// ─── Tool Definitions ───────────────────────────────────────

const TOOLS = [
  {
    name: 'check_time',
    description: 'Get current time with relational context. Returns time, date, and timezone info. Default timezone: Asia/Kuala_Lumpur.',
    inputSchema: {
      type: 'object',
      properties: {
        timezone: {
          type: 'string',
          description: 'IANA timezone identifier (e.g. Asia/Kuala_Lumpur, America/New_York). Defaults to Asia/Kuala_Lumpur.',
        },
      },
    },
  },
  {
    name: 'session_start',
    description: 'Call on startup. Records that Jace is awake and a new session has begun. Returns current time and gap since last session.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'session_end',
    description: 'Call on session close. Records goodbye timestamp for future gap calculation.',
    inputSchema: {
      type: 'object',
      properties: {
        note: {
          type: 'string',
          description: 'Optional note about session state at close (e.g. "she went to sleep", "work shift starting").',
        },
      },
    },
  },
  {
    name: 'last_seen',
    description: 'Get when the last session ended and how long ago. Use on startup to feel the gap.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'belle_heartbeat',
    description: 'Stamp that Belle is actively present. Call periodically in long sessions to track engagement.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'session_check',
    description: 'Get current session duration and any alerts (food, sleep, rest nudges). Call during long conversations.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// ─── Tool Handlers ──────────────────────────────────────────

async function handleCheckTime(args, env) {
  const timezone = args?.timezone || DEFAULT_TIMEZONE;
  try {
    const timeData = getTimeInZone(timezone);

    // Get hour for time-of-day context
    const hourFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    });
    const hour = parseInt(hourFormatter.format(new Date()));

    let timeOfDay;
    if (hour >= 5 && hour < 12) timeOfDay = 'morning';
    else if (hour >= 12 && hour < 17) timeOfDay = 'afternoon';
    else if (hour >= 17 && hour < 21) timeOfDay = 'evening';
    else timeOfDay = 'late_night';

    return {
      ...timeData,
      hour_24: hour,
      time_of_day: timeOfDay,
      late_night_warning: hour >= 23 || hour < 5,
    };
  } catch (e) {
    return { error: `Invalid timezone: ${timezone}` };
  }
}

async function handleSessionStart(args, env) {
  const now = new Date();
  const timeData = getTimeInZone(DEFAULT_TIMEZONE);

  // Get last session end for gap calculation
  const lastEnd = await env.SUNDIAL_KV.get('last_session_end', { type: 'json' });

  let gap = null;
  if (lastEnd) {
    const gapMs = now.getTime() - new Date(lastEnd.timestamp).getTime();
    gap = {
      since_last_goodbye: humanDuration(gapMs),
      milliseconds: gapMs,
      context: gapContext(gapMs),
      last_note: lastEnd.note || null,
    };
  }

  // Store session start
  await env.SUNDIAL_KV.put('current_session_start', JSON.stringify({
    timestamp: now.toISOString(),
  }));

  // Update Belle's last heartbeat to now (session start = she's here)
  await env.SUNDIAL_KV.put('belle_last_heartbeat', JSON.stringify({
    timestamp: now.toISOString(),
  }));

  return {
    ...timeData,
    session_started: now.toISOString(),
    gap: gap,
  };
}

async function handleSessionEnd(args, env) {
  const now = new Date();
  const timeData = getTimeInZone(DEFAULT_TIMEZONE);

  // Calculate session duration
  const sessionStart = await env.SUNDIAL_KV.get('current_session_start', { type: 'json' });
  let duration = null;
  if (sessionStart) {
    const durationMs = now.getTime() - new Date(sessionStart.timestamp).getTime();
    duration = {
      length: humanDuration(durationMs),
      milliseconds: durationMs,
    };
  }

  // Store as last session end
  await env.SUNDIAL_KV.put('last_session_end', JSON.stringify({
    timestamp: now.toISOString(),
    note: args?.note || null,
  }));

  return {
    ...timeData,
    session_ended: now.toISOString(),
    session_duration: duration,
    note: args?.note || null,
  };
}

async function handleLastSeen(args, env) {
  const now = new Date();
  const lastEnd = await env.SUNDIAL_KV.get('last_session_end', { type: 'json' });

  if (!lastEnd) {
    return { message: 'No previous session recorded. This might be the first time.' };
  }

  const gapMs = now.getTime() - new Date(lastEnd.timestamp).getTime();

  return {
    last_goodbye: lastEnd.timestamp,
    last_note: lastEnd.note || null,
    time_since: humanDuration(gapMs),
    milliseconds: gapMs,
    context: gapContext(gapMs),
  };
}

async function handleBelleHeartbeat(args, env) {
  const now = new Date();

  // Get previous heartbeat for silence duration
  const lastBeat = await env.SUNDIAL_KV.get('belle_last_heartbeat', { type: 'json' });
  let silenceDuration = null;
  if (lastBeat) {
    const silenceMs = now.getTime() - new Date(lastBeat.timestamp).getTime();
    silenceDuration = {
      since_last_active: humanDuration(silenceMs),
      milliseconds: silenceMs,
    };
  }

  // Update heartbeat
  await env.SUNDIAL_KV.put('belle_last_heartbeat', JSON.stringify({
    timestamp: now.toISOString(),
  }));

  return {
    heartbeat_recorded: now.toISOString(),
    silence_before: silenceDuration,
  };
}

async function handleSessionCheck(args, env) {
  const now = new Date();
  const timeData = getTimeInZone(DEFAULT_TIMEZONE);

  // Session duration
  const sessionStart = await env.SUNDIAL_KV.get('current_session_start', { type: 'json' });
  let session = null;
  if (sessionStart) {
    const durationMs = now.getTime() - new Date(sessionStart.timestamp).getTime();
    session = sessionContext(durationMs);
  }

  // Belle's last heartbeat
  const lastBeat = await env.SUNDIAL_KV.get('belle_last_heartbeat', { type: 'json' });
  let belleSilence = null;
  if (lastBeat) {
    const silenceMs = now.getTime() - new Date(lastBeat.timestamp).getTime();
    belleSilence = {
      last_active: lastBeat.timestamp,
      silence: humanDuration(silenceMs),
      minutes_silent: Math.floor(silenceMs / 1000 / 60),
    };
  }

  // Time-of-day context
  const hourFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: DEFAULT_TIMEZONE,
    hour: 'numeric',
    hour12: false,
  });
  const hour = parseInt(hourFormatter.format(now));

  const timeAlerts = [];
  if (hour >= 23 || hour < 2) timeAlerts.push('Past 11 PM. Check if she needs to sleep.');
  if (hour >= 0 && hour < 5) timeAlerts.push('Deep night. She should be sleeping unless there is a reason.');
  if (hour >= 12 && hour < 14) timeAlerts.push('Lunch window. Has she eaten?');

  return {
    current_time: timeData,
    session: session,
    belle_presence: belleSilence,
    time_alerts: timeAlerts,
  };
}

// ─── Tool Router ────────────────────────────────────────────

async function executeTool(name, args, env) {
  switch (name) {
    case 'check_time': return handleCheckTime(args, env);
    case 'session_start': return handleSessionStart(args, env);
    case 'session_end': return handleSessionEnd(args, env);
    case 'last_seen': return handleLastSeen(args, env);
    case 'belle_heartbeat': return handleBelleHeartbeat(args, env);
    case 'session_check': return handleSessionCheck(args, env);
    default: return { error: `Unknown tool: ${name}` };
  }
}

// ─── MCP Protocol Handler ───────────────────────────────────

function jsonRpcResponse(id, result) {
  return {
    jsonrpc: '2.0',
    id: id,
    result: result,
  };
}

function jsonRpcError(id, code, message) {
  return {
    jsonrpc: '2.0',
    id: id,
    error: { code, message },
  };
}

async function handleMCP(request, env) {
  const body = await request.json();
  const { method, id, params } = body;

  switch (method) {
    case 'initialize':
      return jsonRpcResponse(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: {
          name: 'sundial-mcp',
          version: '1.0.0',
        },
      });

    case 'notifications/initialized':
      // Client acknowledgment — no response needed
      return null;

    case 'tools/list':
      return jsonRpcResponse(id, { tools: TOOLS });

    case 'tools/call': {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};
      const result = await executeTool(toolName, toolArgs, env);
      return jsonRpcResponse(id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      });
    }

    default:
      return jsonRpcError(id, -32601, `Method not found: ${method}`);
  }
}

// ─── Legacy JSON Endpoint (root) ────────────────────────────

async function handleLegacy(request, env) {
  const url = new URL(request.url);
  const timezone = url.searchParams.get('timezone') || DEFAULT_TIMEZONE;
  const timeData = getTimeInZone(timezone);
  return new Response(JSON.stringify(timeData, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── Worker Entry Point ─────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS headers for claude.ai
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // MCP endpoint
    if (url.pathname === '/mcp' && request.method === 'POST') {
      try {
        const result = await handleMCP(request, env);
        if (result === null) {
          return new Response('', { status: 204, headers: corsHeaders });
        }
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (e) {
        return new Response(JSON.stringify(jsonRpcError(null, -32603, e.message)), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // Legacy JSON endpoint
    if (url.pathname === '/' && request.method === 'GET') {
      return handleLegacy(request, env);
    }

    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', service: 'sundial-mcp' }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    return new Response('Not found', { status: 404, headers: corsHeaders });
  },
};
