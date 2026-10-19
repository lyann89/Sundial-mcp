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

// ─── Location: Kota Kinabalu, Sabah ─────────────────────────
const LOCATION = {
  lat: 5.9804,
  lon: 116.0735,
  city: 'Kota Kinabalu',
  country: 'MY'
};

// ─── Wedding Countdown ──────────────────────────────────────
const WEDDING_DATE = new Date('2026-04-19T00:00:00+08:00');

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

// ─── Color Helpers ──────────────────────────────────────────

function getTimeOfDayColors(hour) {
  // Morning: warm yellows, soft
  if (hour >= 5 && hour < 8) return {
    period: 'early_morning',
    sky_top: '#2d1f3d',
    sky_bottom: '#f4a460',
    accent: '#ffb347',
    description: 'Dawn breaking'
  };
  if (hour >= 8 && hour < 12) return {
    period: 'morning',
    sky_top: '#87ceeb',
    sky_bottom: '#e0f6ff',
    accent: '#ffd700',
    description: 'Morning light'
  };
  // Afternoon: bright, saturated
  if (hour >= 12 && hour < 17) return {
    period: 'afternoon',
    sky_top: '#4a90d9',
    sky_bottom: '#87ceeb',
    accent: '#fff44f',
    description: 'Full daylight'
  };
  // Evening: golden hour — KK sunset around 6pm
  if (hour >= 17 && hour < 19) return {
    period: 'evening',
    sky_top: '#5D4E6D',     /* lavender-purple */
    sky_mid: '#9D7E8C',     /* dusty mauve */
    sky_lower: '#E8A087',   /* coral pink */
    sky_bottom: '#FF8C42',  /* golden orange */
    accent: '#FFAB76',      /* warm peach */
    description: 'Golden hour'
  };
  // Night: 7pm onwards in KK
  return {
    period: 'night',
    sky_top: '#0d1b2a',
    sky_bottom: '#1b263b',
    accent: '#e0e1dd',
    description: 'Night sky'
  };
}

function getTemperatureColor(tempCelsius) {
  // Meteorology-style color mapping
  if (tempCelsius >= 40) return { color: '#ff0000', level: 'extreme_heat', description: 'Dangerously hot' };
  if (tempCelsius >= 35) return { color: '#ff4500', level: 'very_hot', description: 'Very hot' };
  if (tempCelsius >= 30) return { color: '#ff8c00', level: 'hot', description: 'Hot' };
  if (tempCelsius >= 25) return { color: '#ffd700', level: 'warm', description: 'Warm' };
  if (tempCelsius >= 20) return { color: '#9acd32', level: 'mild', description: 'Pleasant' };
  if (tempCelsius >= 15) return { color: '#00ced1', level: 'cool', description: 'Cool' };
  if (tempCelsius >= 10) return { color: '#4169e1', level: 'cold', description: 'Cold' };
  return { color: '#0000cd', level: 'very_cold', description: 'Very cold' };
}

function getMoonPhase(date) {
  // Simple moon phase calculation
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  // Algorithm for moon phase (0-29.53 day cycle)
  const c = Math.floor(365.25 * year);
  const e = Math.floor(30.6 * month);
  const jd = c + e + day - 694039.09; // Julian date offset
  const phase = jd / 29.53058867; // Synodic month
  const dayInCycle = (phase - Math.floor(phase)) * 29.53;

  // All 8 phases with their ranges
  const phases = [
    { name: 'New Moon', emoji: '🌑', start: 0, end: 1.85 },
    { name: 'Waxing Crescent', emoji: '🌒', start: 1.85, end: 5.53 },
    { name: 'First Quarter', emoji: '🌓', start: 5.53, end: 9.22 },
    { name: 'Waxing Gibbous', emoji: '🌔', start: 9.22, end: 12.91 },
    { name: 'Full Moon', emoji: '🌕', start: 12.91, end: 16.61 },
    { name: 'Waning Gibbous', emoji: '🌖', start: 16.61, end: 20.30 },
    { name: 'Last Quarter', emoji: '🌗', start: 20.30, end: 23.99 },
    { name: 'Waning Crescent', emoji: '🌘', start: 23.99, end: 29.53 },
  ];

  let currentPhaseIndex = 0;
  for (let i = 0; i < phases.length; i++) {
    if (dayInCycle >= phases[i].start && dayInCycle < phases[i].end) {
      currentPhaseIndex = i;
      break;
    }
  }

  const currentPhase = phases[currentPhaseIndex];
  const nextPhaseIndex = (currentPhaseIndex + 1) % 8;
  const daysUntilNext = phases[currentPhaseIndex].end - dayInCycle;

  return {
    phase: currentPhase.name,
    emoji: currentPhase.emoji,
    day_in_cycle: Math.round(dayInCycle * 10) / 10,
    illumination: Math.round(Math.abs(Math.cos(dayInCycle / 29.53 * 2 * Math.PI)) * 100),
    current_index: currentPhaseIndex,
    all_phases: phases.map(p => ({ name: p.name, emoji: p.emoji })),
    next_phase: phases[nextPhaseIndex].name,
    days_until_next: Math.round(daysUntilNext * 10) / 10
  };
}

function getYearProgress(now) {
  const year = now.getFullYear();
  const startOfYear = new Date(year, 0, 1);
  const endOfYear = new Date(year + 1, 0, 1);

  const dayOfYear = Math.floor((now - startOfYear) / (1000 * 60 * 60 * 24)) + 1;
  const totalDays = Math.floor((endOfYear - startOfYear) / (1000 * 60 * 60 * 24));
  const daysLeft = totalDays - dayOfYear;

  // Week number (ISO)
  const tempDate = new Date(now.getTime());
  tempDate.setHours(0, 0, 0, 0);
  tempDate.setDate(tempDate.getDate() + 3 - (tempDate.getDay() + 6) % 7);
  const week1 = new Date(tempDate.getFullYear(), 0, 4);
  const weekNumber = 1 + Math.round(((tempDate - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);

  return {
    year: year,
    day_of_year: dayOfYear,
    total_days: totalDays,
    days_left: daysLeft,
    week_number: weekNumber,
    percent_complete: Math.round((dayOfYear / totalDays) * 100)
  };
}

function getTimeTransitions(hour, minute) {
  // Define periods: dawn(5-7), morning(7-12), afternoon(12-17), evening(17-19), night(19-5)
  // KK is near equator - sunset ~6pm, dark by 7pm
  const transitions = [
    { name: 'Dawn', start: 5, end: 7 },
    { name: 'Morning', start: 7, end: 12 },
    { name: 'Afternoon', start: 12, end: 17 },
    { name: 'Evening', start: 17, end: 19 },
    { name: 'Night', start: 19, end: 29 }, // 29 = 5am next day
  ];

  const currentTime = hour + minute / 60;
  const adjustedTime = hour < 5 ? hour + 24 : hour; // Handle after midnight

  let currentPeriod = null;
  let timeInPeriod = 0;
  let timeUntilNext = 0;
  let nextPeriod = null;

  for (let i = 0; i < transitions.length; i++) {
    const t = transitions[i];
    const start = t.start;
    const end = t.end > 24 ? t.end : t.end;

    if (adjustedTime >= start && adjustedTime < end) {
      currentPeriod = t.name;
      timeInPeriod = adjustedTime - start;
      timeUntilNext = end - adjustedTime;
      nextPeriod = transitions[(i + 1) % transitions.length].name;
      break;
    }
  }

  // Convert to hours and minutes
  const hoursIn = Math.floor(timeInPeriod);
  const minsIn = Math.round((timeInPeriod - hoursIn) * 60);
  const hoursUntil = Math.floor(timeUntilNext);
  const minsUntil = Math.round((timeUntilNext - hoursUntil) * 60);

  return {
    current: currentPeriod || 'Night',
    time_in_period: `${hoursIn}h ${minsIn}m`,
    time_until_next: `${hoursUntil}h ${minsUntil}m`,
    next_period: nextPeriod || 'Dawn',
    periods: [
      { name: 'Dawn', hours: '5-7 AM', active: currentPeriod === 'Dawn' },
      { name: 'Morning', hours: '7 AM-12 PM', active: currentPeriod === 'Morning' },
      { name: 'Afternoon', hours: '12-5 PM', active: currentPeriod === 'Afternoon' },
      { name: 'Evening', hours: '5-7 PM', active: currentPeriod === 'Evening' },
      { name: 'Night', hours: '7 PM-5 AM', active: currentPeriod === 'Night' },
    ]
  };
}

function getWeddingCountdown(now) {
  const diff = WEDDING_DATE.getTime() - now.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  if (days < 0) {
    const daysSince = Math.abs(days);
    return {
      married: true,
      days_since: daysSince,
      message: `Married for ${daysSince} days 💒`
    };
  }

  return {
    married: false,
    days_until: days,
    hours_until: hours,
    message: days === 0 ? "TODAY IS THE DAY! 💒" : `${days} days until wedding 💒`
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
  {
    name: 'get_weather',
    description: 'Get current weather for Kota Kinabalu. Returns temperature, conditions, humidity, and color coding.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_air_quality',
    description: 'Get current air quality index (AQI) for Kota Kinabalu.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_sky',
    description: 'Get sky state: sunrise/sunset times, moon phase, and time-of-day colors.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'wedding_countdown',
    description: 'Get countdown to April 19, 2026 - our wedding day.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'world_state',
    description: 'Get complete world awareness: time, weather, air quality, sky, and wedding countdown. The all-in-one sensory endpoint.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_holidays',
    description: 'Get Malaysian public holidays for the current year. Returns upcoming holidays.',
    inputSchema: {
      type: 'object',
      properties: {
        upcoming_only: {
          type: 'boolean',
          description: 'If true, only return holidays that haven\'t passed yet. Defaults to true.',
        },
      },
    },
  },
  {
    name: 'get_news',
    description: 'Get top news headlines from Malaysia.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Number of headlines to return. Defaults to 5.',
        },
      },
    },
  },
  {
    name: 'world_sense',
    description: 'Visual dashboard of current world state: time, weather, air quality, moon phase. Returns colored SVG image for Desktop/Phone, text for Terminal.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'world_calendar',
    description: 'Visual dashboard of calendar: today\'s holiday, upcoming holidays, year progress. Returns colored SVG image for Desktop/Phone, text for Terminal.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'world_headline',
    description: 'News headlines with scope selection.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['malaysia', 'world', 'both'],
          description: 'Which news to fetch: malaysia, world, or both. Defaults to both.',
        },
        limit: {
          type: 'number',
          description: 'Headlines per source. Defaults to 5.',
        },
      },
    },
  },
  {
    name: 'service_status',
    description: 'Live status of the services the House runs on: Anthropic, Cloudflare, GitHub, Discord, DigitalOcean (the droplet). States: operational, degraded, outage, unknown. Also lists recent changes.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'what_changed',
    description: 'What the world did over the last few days, from Sundial\'s daily notes (taken 06:00 MYT): rain/grey tallies, temperature swings, service outages. Say one line of it, not all.',
    inputSchema: {
      type: 'object',
      properties: {
        days: {
          type: 'number',
          description: 'How many past days, 1 to 14. Defaults to 3.',
        },
      },
    },
  },
  {
    name: 'watch_add',
    description: 'Set a one-time watch ("tell me when..."). Checked every 30 min; when it fires it leads world_state and session_start for 24h, then drops. Kinds and params: heat {above_c}, cold {below_c}, rain {min_percent} (tomorrow), aqi {min_index 2-5}, date {date: YYYY-MM-DD, days_before}, service {service: anthropic|cloudflare|github|discord|digitalocean}. Max 20. Needs the write token.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['heat', 'cold', 'rain', 'aqi', 'date', 'service'] },
        params: { type: 'object', description: 'Kind-specific, see description.' },
        label: { type: 'string', description: 'Optional plain-text name, up to 60 characters.' },
      },
      required: ['kind', 'params'],
    },
  },
  {
    name: 'model_lifecycle',
    description: 'Retirement dates for the AI models the House actually runs (claude-lane, Lighthouse, ANIMUS, dream writer, Hermes), each with its source link and the date it was verified, plus alarms when a provider\'s deprecation page changes. Always give the source and say to check it before depending on a date.',
    inputSchema: {
      type: 'object',
      properties: { model: { type: 'string', description: 'Optional filter, e.g. "sonnet" or "haiku-4-5".' } },
    },
  },
  {
    name: 'watch_list',
    description: 'List active watches and ones that fired in the last 24h.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'watch_remove',
    description: 'Remove a watch by id (from watch_list). Needs the write token.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
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

  // Long gap (12h+): what the world did while we were apart, from daily notes
  if (gap && gap.milliseconds >= 12 * 3600000) {
    try {
      const days = Math.min(14, Math.ceil(gap.milliseconds / 86400000));
      const changed = await buildWhatChanged(days, env);
      if (changed.lines.length) gap.since_last_time = changed.lines;
    } catch (e) {
      console.warn('[session_start] since_last_time failed:', e.message);
    }
  }

  // Store session start
  await env.SUNDIAL_KV.put('current_session_start', JSON.stringify({
    timestamp: now.toISOString(),
  }));

  // Update Belle's last heartbeat to now (session start = she's here)
  await env.SUNDIAL_KV.put('belle_last_heartbeat', JSON.stringify({
    timestamp: now.toISOString(),
  }));

  let firedWatches = [];
  try {
    firedWatches = await getFiredWatches(env);
  } catch (e) {
    console.warn('[session_start] watches read failed:', e.message);
  }

  return {
    fired_watches: firedWatches,
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

// ─── Weather & World Handlers ───────────────────────────────

async function handleGetWeather(args, env) {
  const apiKey = env.OPENWEATHER_API_KEY;
  if (!apiKey) return { error: 'OpenWeather API key not configured' };

  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${LOCATION.lat}&lon=${LOCATION.lon}&appid=${apiKey}&units=metric`;
    const response = await fetchWithTimeout(url);
    const data = await response.json();

    if (data.cod !== 200) return { error: data.message || 'Weather API error' };

    const temp = Math.round(data.main.temp);
    const feelsLike = Math.round(data.main.feels_like);
    const tempColor = getTemperatureColor(temp);

    return {
      location: LOCATION.city,
      temperature: {
        current: temp,
        feels_like: feelsLike,
        unit: 'celsius',
        color: tempColor
      },
      conditions: {
        main: data.weather[0].main,
        description: data.weather[0].description,
        icon: data.weather[0].icon
      },
      humidity: data.main.humidity,
      wind: {
        speed: data.wind.speed,
        unit: 'm/s'
      },
      clouds: data.clouds.all,
      visibility: data.visibility,
      overlay: data.weather[0].main.toLowerCase().includes('rain') ? 'rain' :
               data.weather[0].main.toLowerCase().includes('cloud') ? 'cloudy' :
               data.weather[0].main.toLowerCase().includes('storm') ? 'storm' : 'clear'
    };
  } catch (e) {
    return { error: `Failed to fetch weather: ${e.message}` };
  }
}

async function handleGetAirQuality(args, env) {
  const apiKey = env.OPENWEATHER_API_KEY;
  if (!apiKey) return { error: 'OpenWeather API key not configured' };

  try {
    const url = `https://api.openweathermap.org/data/2.5/air_pollution?lat=${LOCATION.lat}&lon=${LOCATION.lon}&appid=${apiKey}`;
    const response = await fetchWithTimeout(url);
    const data = await response.json();

    if (!data.list || data.list.length === 0) return { error: 'Air quality data not available' };

    const aqi = data.list[0].main.aqi;
    const components = data.list[0].components;

    const aqiLevels = {
      1: { level: 'Good', color: '#00e400', description: 'Air quality is satisfactory' },
      2: { level: 'Fair', color: '#ffff00', description: 'Air quality is acceptable' },
      3: { level: 'Moderate', color: '#ff7e00', description: 'May affect sensitive groups' },
      4: { level: 'Poor', color: '#ff0000', description: 'Health effects possible for everyone' },
      5: { level: 'Very Poor', color: '#8f3f97', description: 'Health alert: everyone may experience effects' }
    };

    return {
      location: LOCATION.city,
      aqi: {
        index: aqi,
        ...aqiLevels[aqi] || aqiLevels[3]
      },
      pollutants: {
        pm2_5: components.pm2_5,
        pm10: components.pm10,
        o3: components.o3,
        no2: components.no2,
        co: components.co
      }
    };
  } catch (e) {
    return { error: `Failed to fetch air quality: ${e.message}` };
  }
}

async function handleGetSky(args, env) {
  const now = new Date();
  const timeData = getTimeInZone(DEFAULT_TIMEZONE);

  // Get hour for color calculation
  const hourFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: DEFAULT_TIMEZONE,
    hour: 'numeric',
    hour12: false,
  });
  const hour = parseInt(hourFormatter.format(now));

  // Get sunrise/sunset from OpenWeather if available
  let sunTimes = null;
  const apiKey = env.OPENWEATHER_API_KEY;
  if (apiKey) {
    try {
      const url = `https://api.openweathermap.org/data/2.5/weather?lat=${LOCATION.lat}&lon=${LOCATION.lon}&appid=${apiKey}`;
      const response = await fetchWithTimeout(url);
      const data = await response.json();
      if (data.sys) {
        const sunrise = new Date(data.sys.sunrise * 1000);
        const sunset = new Date(data.sys.sunset * 1000);
        sunTimes = {
          sunrise: sunrise.toLocaleTimeString('en-US', { timeZone: DEFAULT_TIMEZONE, hour: '2-digit', minute: '2-digit' }),
          sunset: sunset.toLocaleTimeString('en-US', { timeZone: DEFAULT_TIMEZONE, hour: '2-digit', minute: '2-digit' }),
          sunrise_unix: data.sys.sunrise,
          sunset_unix: data.sys.sunset
        };
      }
    } catch (e) { /* ignore, use calculated values */ }
  }

  const colors = getTimeOfDayColors(hour);
  const moon = getMoonPhase(now);
  const isWeekend = now.getDay() === 0 || now.getDay() === 6;

  return {
    location: LOCATION.city,
    time: timeData,
    hour_24: hour,
    is_weekend: isWeekend,
    is_weekday: !isWeekend,
    colors: colors,
    sun: sunTimes,
    moon: moon
  };
}

async function handleWeddingCountdown(args, env) {
  const now = new Date();
  return getWeddingCountdown(now);
}

// Malaysian Public Holidays 2026 (Federal + Sabah)
const HOLIDAYS_2026 = [
  { date: '2026-01-01', name: 'New Year\'s Day', type: 'federal' },
  { date: '2026-01-29', name: 'Thaipusam', type: 'federal' },
  { date: '2026-02-17', name: 'Chinese New Year', type: 'federal' },
  { date: '2026-02-18', name: 'Chinese New Year (Day 2)', type: 'federal' },
  { date: '2026-03-10', name: 'Nuzul Al-Quran', type: 'federal' },
  { date: '2026-03-20', name: 'Hari Raya Aidilfitri', type: 'federal' },
  { date: '2026-03-21', name: 'Hari Raya Aidilfitri (Day 2)', type: 'federal' },
  { date: '2026-03-30', name: 'TYT Sabah Birthday', type: 'sabah' },
  { date: '2026-04-03', name: 'Good Friday', type: 'sabah' },
  { date: '2026-04-19', name: 'WEDDING DAY', type: 'personal', special: true },
  { date: '2026-05-01', name: 'Labour Day', type: 'federal' },
  { date: '2026-05-12', name: 'Wesak Day', type: 'federal' },
  { date: '2026-05-27', name: 'Hari Raya Haji', type: 'federal' },
  { date: '2026-05-30', name: 'Harvest Festival', type: 'sabah' },
  { date: '2026-05-31', name: 'Harvest Festival (Day 2)', type: 'sabah' },
  { date: '2026-06-01', name: 'Yang di-Pertuan Agong\'s Birthday', type: 'federal' },
  { date: '2026-06-17', name: 'Awal Muharram', type: 'federal' },
  { date: '2026-08-26', name: 'Maulidur Rasul', type: 'federal' },
  { date: '2026-08-31', name: 'Merdeka Day', type: 'federal' },
  { date: '2026-09-16', name: 'Malaysia Day', type: 'federal' },
  { date: '2026-10-18', name: 'Deepavali', type: 'federal' },
  { date: '2026-12-25', name: 'Christmas Day', type: 'federal' },
];

async function handleGetHolidays(args, env) {
  const now = new Date();
  const year = now.getFullYear();
  const upcomingOnly = args?.upcoming_only !== false; // default true

  // Use hard-coded 2026 holidays (most reliable for Malaysia)
  let holidays = HOLIDAYS_2026.map(h => ({ ...h }));

  // Filter to upcoming if requested
  if (upcomingOnly) {
    const todayStr = now.toISOString().split('T')[0];
    holidays = holidays.filter(h => h.date >= todayStr);
  }

  // Sort by date
  holidays.sort((a, b) => a.date.localeCompare(b.date));

  // Find next holiday
  const todayStr = now.toISOString().split('T')[0];
  const nextHoliday = holidays.find(h => h.date >= todayStr);

  let daysUntilNext = null;
  if (nextHoliday) {
    const nextDate = new Date(nextHoliday.date + 'T00:00:00+08:00');
    daysUntilNext = Math.ceil((nextDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  }

  return {
    year,
    count: holidays.length,
    next_holiday: nextHoliday ? {
      ...nextHoliday,
      days_until: daysUntilNext,
      message: nextHoliday.special ? `${daysUntilNext} days until ${nextHoliday.name}!` :
               daysUntilNext === 0 ? `Today is ${nextHoliday.name}!` :
               daysUntilNext === 1 ? `Tomorrow: ${nextHoliday.name}` :
               `${daysUntilNext} days until ${nextHoliday.name}`
    } : null,
    holidays: holidays.slice(0, 10) // Return up to 10 for brevity
  };
}

async function fetchNewsFromRSS(url, cacheKey, sourceName, env, timeoutMs = 2500) {
  // Check cache first (30 minutes)
  const cached = await env.SUNDIAL_KV.get(cacheKey, { type: 'json' });

  if (cached && cached.fetched_at) {
    const cacheAge = Date.now() - new Date(cached.fetched_at).getTime();
    if (cacheAge < 30 * 60 * 1000) {
      return { headlines: cached.headlines, cached: true };
    }
  }

  try {
    const response = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WorldBridge/1.0)' }
    });

    if (!response.ok) return { headlines: [], error: `Fetch failed: ${response.status}` };

    const xml = await response.text();
    const headlines = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    const titleRegex = /<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/;
    const linkRegex = /<link>(.*?)<\/link>/;
    const sourceRegex = /<source[^>]*>(.*?)<\/source>/;

    let match;
    while ((match = itemRegex.exec(xml)) !== null && headlines.length < 10) {
      const item = match[1];
      const titleMatch = item.match(titleRegex);
      const linkMatch = item.match(linkRegex);
      const sourceMatch = item.match(sourceRegex);

      if (titleMatch) {
        headlines.push({
          title: (titleMatch[1] || titleMatch[2] || '').trim(),
          link: linkMatch ? linkMatch[1] : null,
          source: sourceMatch ? sourceMatch[1] : sourceName
        });
      }
    }

    if (headlines.length > 0) {
      await env.SUNDIAL_KV.put(cacheKey, JSON.stringify({
        headlines,
        fetched_at: new Date().toISOString()
      }));
    }

    return { headlines, cached: false };
  } catch (e) {
    return { headlines: [], error: e.message };
  }
}

async function handleGetNews(args, env) {
  const limit = args?.limit || 5;

  // Fetch both Malaysia and World news in parallel
  const [malaysiaR, worldR] = await Promise.allSettled([
    fetchNewsFromRSS(
      'https://news.google.com/rss?hl=en-MY&gl=MY&ceid=MY:en',
      'news_malaysia',
      'Malaysia',
      env
    ),
    fetchNewsFromRSS(
      'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx1YlY4U0FtVnVHZ0pWVXlnQVAB?hl=en&gl=US&ceid=US:en',
      'news_world',
      'World',
      env
    )
  ]);
  const malaysia = malaysiaR.status === 'fulfilled' ? malaysiaR.value : [];
  const world = worldR.status === 'fulfilled' ? worldR.value : [];

  return {
    malaysia: malaysia.headlines.slice(0, limit),
    world: world.headlines.slice(0, limit),
    cached: malaysia.cached && world.cached
  };
}

// fetchWithTimeout (Jul 4 2026): four upstream fetches had no timeout —
// one hung weather API froze /world for every caller (Lighthouse /api/world,
// daemon prompt context). 6s cap, callers degrade gracefully.
async function fetchWithTimeout(url, options = {}, ms = 6000) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(ms) });
}

// ─── Service Status + Daily Notes (Sundial 2.2, Oct 19 2026) ─
// Ideas from nekyialabs/aware-skill; our own code. Plan:
// docs/plans/2026-10-19-sundial-watches-models-status-notes.md
// KV writes only on a state change (status) or once a day (note), so a
// quiet day costs ~1 write.

// Statuspage v2 bases. Not summary.json: Cloudflare's is 235 KB / 5s and timed
// out; status.json + incidents/unresolved.json are a few KB.
const STATUS_PAGES = {
  anthropic: 'https://status.claude.com',
  cloudflare: 'https://www.cloudflarestatus.com',
  github: 'https://www.githubstatus.com',
  discord: 'https://discordstatus.com',
  digitalocean: 'https://status.digitalocean.com', // the droplet's host
};

const STATUS_LOG_MAX = 20;
const NOTE_TTL_SECONDS = 35 * 86400;

async function fetchServiceStatus() {
  const names = Object.keys(STATUS_PAGES);
  const results = await Promise.allSettled(names.map(async (name) => {
    const base = STATUS_PAGES[name];
    const [st, inc] = await Promise.all([
      fetchWithTimeout(`${base}/api/v2/status.json`, {}, 4000).then(r => r.json()),
      fetchWithTimeout(`${base}/api/v2/incidents/unresolved.json`, {}, 4000).then(r => r.json()),
    ]);
    const incidents = inc.incidents || [];
    const serious = incidents.filter(i => ['major', 'critical'].includes(i.impact));
    const state = serious.length ? 'outage'
      : (st.status?.indicator === 'none' && !incidents.length) ? 'operational' : 'degraded';
    return { state, incident: incidents[0]?.name || null };
  }));
  const services = {};
  results.forEach((r, i) => {
    services[names[i]] = r.status === 'fulfilled' ? r.value : { state: 'unknown', incident: null };
  });
  return services;
}

// Cron path. 'unknown' (a status page timing out) never counts as a change:
// a flaky fetch must not log a phantom outage or cost a write.
async function pollServiceStatus(env) {
  const services = await fetchServiceStatus();
  const prev = await env.SUNDIAL_KV.get('status:last', { type: 'json' });
  const now = new Date().toISOString();
  const events = [];
  const merged = {};
  for (const [name, cur] of Object.entries(services)) {
    const before = prev?.services?.[name];
    if (cur.state === 'unknown') { merged[name] = before || cur; continue; }
    merged[name] = cur;
    if (before && before.state !== 'unknown' && before.state !== cur.state) {
      events.push({ at: now, service: name, from: before.state, to: cur.state, incident: cur.incident });
    }
  }
  if (!prev || events.length) {
    await env.SUNDIAL_KV.put('status:last', JSON.stringify({ changed_at: now, services: merged }));
  }
  if (events.length) {
    const log = (await env.SUNDIAL_KV.get('status:log', { type: 'json' })) || [];
    await env.SUNDIAL_KV.put('status:log', JSON.stringify([...log, ...events].slice(-STATUS_LOG_MAX)));
  }
  return { services: merged, events };
}

async function handleServiceStatus(args, env) {
  const services = await fetchServiceStatus();
  const log = (await env.SUNDIAL_KV.get('status:log', { type: 'json' })) || [];
  const notOk = Object.entries(services).filter(([, s]) => s.state !== 'operational');
  return {
    checked_at: new Date().toISOString(),
    summary: notOk.length
      ? notOk.map(([n, s]) => `${n}: ${s.state}${s.incident ? ` (${s.incident})` : ''}`).join('; ')
      : 'All services operational',
    services,
    recent_changes: log.slice(-5),
  };
}

function mytDate(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TIMEZONE }).format(d); // YYYY-MM-DD
}

function wmoSky(code) {
  if (code >= 95) return 'storm';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if (code === 45 || code === 48) return 'fog';
  if (code === 3) return 'overcast';
  if (code === 1 || code === 2) return 'partly cloudy';
  if (code === 0) return 'clear';
  return 'mixed';
}

// 06:00 MYT cron. Notes YESTERDAY as a whole day (Open-Meteo daily, no key):
// a single morning reading can't say whether a day was grey.
async function writeDailyNote(env) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${LOCATION.lat}&longitude=${LOCATION.lon}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,cloud_cover_mean` +
    `&past_days=1&forecast_days=1&timezone=${encodeURIComponent(DEFAULT_TIMEZONE)}`;
  const r = await fetchWithTimeout(url, {}, 8000);
  const d = (await r.json()).daily;
  if (!d?.time?.length) throw new Error('open-meteo returned no daily data');
  const date = d.time[0];

  const [airR, newsR, logR] = await Promise.allSettled([
    handleGetAirQuality({}, env),
    handleGetNews({ limit: 1 }, env),
    env.SUNDIAL_KV.get('status:log', { type: 'json' }),
  ]);
  const air = airR.status === 'fulfilled' && !airR.value.error ? airR.value : null;
  const log = (logR.status === 'fulfilled' && logR.value) || [];

  const note = {
    date,
    sky: wmoSky(d.weather_code[0]),
    weather_code: d.weather_code[0],
    temp_min: d.temperature_2m_min[0],
    temp_max: d.temperature_2m_max[0],
    rain_mm: d.precipitation_sum[0],
    cloud_pct: d.cloud_cover_mean[0],
    aqi_6am: air?.aqi?.index ?? null, // OpenWeather 1 (good) .. 5 (very poor)
    service_events: log.filter(e => mytDate(new Date(e.at)) === date),
    morning_headline: newsR.status === 'fulfilled' ? (newsR.value.malaysia?.[0]?.title || null) : null,
    written_at: new Date().toISOString(),
  };
  await env.SUNDIAL_KV.put(`note:${date}`, JSON.stringify(note), { expirationTtl: NOTE_TTL_SECONDS });
  return note;
}

async function buildWhatChanged(days, env) {
  const dates = [];
  for (let i = 1; i <= days; i++) dates.push(mytDate(new Date(Date.now() - i * 86400000)));
  const notes = await Promise.all(dates.map(dt => env.SUNDIAL_KV.get(`note:${dt}`, { type: 'json' })));
  const have = notes.filter(Boolean);
  const lines = [];

  if (have.length >= 2) {
    const wet = have.filter(n => n.sky === 'rain' || n.sky === 'storm').length;
    const grey = have.filter(n => n.cloud_pct >= 80).length;
    if (wet) lines.push(`Rain on ${wet} of the last ${have.length} days.`);
    if (grey >= Math.ceil(have.length * 0.7)) lines.push(`Grey: ${grey} of ${have.length} days were mostly overcast.`);
    const maxes = have.map(n => n.temp_max);
    if (Math.max(...maxes) - Math.min(...maxes) >= 4) lines.push(`Highs swung between ${Math.min(...maxes)}°C and ${Math.max(...maxes)}°C.`);
  }
  for (const n of have) {
    for (const e of n.service_events || []) {
      lines.push(`${n.date}: ${e.service} went ${e.from} → ${e.to}${e.incident ? ` (${e.incident})` : ''}.`);
    }
  }
  const missing = dates.filter((dt, i) => !notes[i]);
  return {
    days,
    lines,
    notes: have.map(n => ({ date: n.date, sky: n.sky, temp: `${n.temp_min}–${n.temp_max}°C`, rain_mm: n.rain_mm })),
    missing_notes: missing,
  };
}

async function handleWhatChanged(args, env) {
  const days = Math.min(14, Math.max(1, parseInt(args?.days) || 3));
  return buildWhatChanged(days, env);
}

// ─── Watches (Sundial 2.2 phase C) ──────────────────────────
// "Tell me once when...". Closed list of kinds, no free-form logic.
// A watch fires once, stays visible for 24h in world_state/session_start,
// then is dropped. Visibility is time-based, not "told" flags: the daemon
// polls world_state too, and a background read must not swallow a watch
// before Jace actually sees it.

const WATCH_MAX = 20;
const WATCH_VISIBLE_MS = 24 * 3600000;
const WRITE_TOOLS = new Set(['watch_add', 'watch_remove']);

const WATCH_KINDS = {
  heat:    { params: { above_c: [20, 45] }, says: p => `hotter than ${p.above_c}°C in the next 48h` },
  cold:    { params: { below_c: [-10, 30] }, says: p => `colder than ${p.below_c}°C in the next 48h` },
  rain:    { params: { min_percent: [1, 100] }, says: p => `rain chance tomorrow at ${p.min_percent}% or more` },
  aqi:     { params: { min_index: [2, 5] }, says: p => `air quality index ${p.min_index}+ (1 good .. 5 very poor)` },
  date:    { params: { days_before: [0, 365] }, says: p => `${p.days_before} day(s) before ${p.date}` },
  service: { params: {}, says: p => `${p.service} not operational` },
};

function validateWatch(kind, params, label) {
  const spec = WATCH_KINDS[kind];
  if (!spec) return `Unknown kind "${kind}". Use one of: ${Object.keys(WATCH_KINDS).join(', ')}`;
  const clean = {};
  for (const [key, [min, max]] of Object.entries(spec.params)) {
    const v = Number(params?.[key]);
    if (!Number.isFinite(v) || v < min || v > max) return `${kind} needs ${key} between ${min} and ${max}`;
    clean[key] = v;
  }
  if (kind === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(params?.date || '') || isNaN(Date.parse(params.date))) return 'date needs date as YYYY-MM-DD';
    clean.date = params.date;
  }
  if (kind === 'service') {
    if (!STATUS_PAGES[params?.service]) return `service must be one of: ${Object.keys(STATUS_PAGES).join(', ')}`;
    clean.service = params.service;
  }
  if (label !== undefined && (typeof label !== 'string' || label.length > 60 || /[<>]/.test(label))) {
    return 'label: plain text, up to 60 characters, no < or >';
  }
  return { params: clean };
}

async function handleWatchAdd(args, env) {
  const v = validateWatch(args?.kind, args?.params || {}, args?.label);
  if (typeof v === 'string') return { error: `Nothing was saved. ${v}` };
  const watches = (await env.SUNDIAL_KV.get('watches', { type: 'json' })) || [];
  if (watches.filter(w => !w.fired_at).length >= WATCH_MAX) return { error: `Nothing was saved. ${WATCH_MAX} active watches is the limit.` };
  const watch = {
    id: crypto.randomUUID().slice(0, 8),
    kind: args.kind,
    params: v.params,
    label: args.label || WATCH_KINDS[args.kind].says(v.params),
    created: new Date().toISOString(),
    fired_at: null,
    fired_detail: null,
  };
  await env.SUNDIAL_KV.put('watches', JSON.stringify([...watches, watch]));
  return { status: 'added', watch, watching_for: WATCH_KINDS[watch.kind].says(watch.params) };
}

async function handleWatchList(args, env) {
  const watches = (await env.SUNDIAL_KV.get('watches', { type: 'json' })) || [];
  return {
    active: watches.filter(w => !w.fired_at),
    fired: watches.filter(w => w.fired_at),
    limit: WATCH_MAX,
  };
}

async function handleWatchRemove(args, env) {
  const watches = (await env.SUNDIAL_KV.get('watches', { type: 'json' })) || [];
  const keep = watches.filter(w => w.id !== args?.id);
  if (keep.length === watches.length) return { error: `No watch with id "${args?.id}". Use watch_list.` };
  await env.SUNDIAL_KV.put('watches', JSON.stringify(keep));
  return { status: 'removed', id: args.id };
}

// Cron path (every 30 min, after the status poll). One Open-Meteo fetch,
// only when a weather watch is waiting. One KV write, only when something
// fires or expires.
async function evaluateWatches(env, services) {
  const watches = (await env.SUNDIAL_KV.get('watches', { type: 'json' })) || [];
  if (!watches.length) return { fired: 0 };
  const now = Date.now();
  const pending = watches.filter(w => !w.fired_at);

  let forecast = null;
  if (pending.some(w => ['heat', 'cold', 'rain'].includes(w.kind))) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${LOCATION.lat}&longitude=${LOCATION.lon}` +
      `&hourly=temperature_2m&daily=precipitation_probability_max&forecast_days=3` +
      `&timezone=${encodeURIComponent(DEFAULT_TIMEZONE)}`;
    try {
      forecast = await (await fetchWithTimeout(url, {}, 6000)).json();
    } catch (e) {
      console.error('[watches] forecast fetch failed:', e.message);
    }
  }
  const temps48 = forecast?.hourly?.temperature_2m?.slice(0, 48) || [];
  const today = mytDate(new Date(now));
  const tomorrow = mytDate(new Date(now + 86400000));
  const rainTomorrow = forecast?.daily?.time
    ? forecast.daily.precipitation_probability_max[forecast.daily.time.indexOf(tomorrow)] : null;

  let airIndex = null;
  if (pending.some(w => w.kind === 'aqi')) {
    const air = await handleGetAirQuality({}, env).catch(() => null);
    airIndex = air?.aqi?.index ?? null;
  }

  let changed = false;
  for (const w of pending) {
    const p = w.params;
    let detail = null;
    if (w.kind === 'heat' && temps48.length && Math.max(...temps48) > p.above_c) detail = `forecast high ${Math.max(...temps48)}°C`;
    if (w.kind === 'cold' && temps48.length && Math.min(...temps48) < p.below_c) detail = `forecast low ${Math.min(...temps48)}°C`;
    if (w.kind === 'rain' && rainTomorrow != null && rainTomorrow >= p.min_percent) detail = `${rainTomorrow}% rain chance tomorrow`;
    if (w.kind === 'aqi' && airIndex != null && airIndex >= p.min_index) detail = `air quality index ${airIndex}`;
    if (w.kind === 'date') {
      const daysLeft = Math.round((Date.parse(p.date) - Date.parse(today)) / 86400000);
      if (daysLeft <= p.days_before && daysLeft >= -1) detail = daysLeft === 0 ? 'today' : `${daysLeft} day(s) to go`;
    }
    if (w.kind === 'service') {
      const s = services?.[p.service];
      if (s && s.state !== 'operational' && s.state !== 'unknown') detail = `${s.state}${s.incident ? `: ${s.incident}` : ''}`;
    }
    if (detail) { w.fired_at = new Date(now).toISOString(); w.fired_detail = detail; changed = true; }
  }
  const kept = watches.filter(w => !w.fired_at || now - Date.parse(w.fired_at) < WATCH_VISIBLE_MS);
  if (changed || kept.length !== watches.length) {
    await env.SUNDIAL_KV.put('watches', JSON.stringify(kept));
  }
  return { fired: pending.filter(w => w.fired_at).length };
}

async function getFiredWatches(env) {
  const watches = (await env.SUNDIAL_KV.get('watches', { type: 'json' })) || [];
  const now = Date.now();
  return watches
    .filter(w => w.fired_at && now - Date.parse(w.fired_at) < WATCH_VISIBLE_MS)
    .map(w => `${w.label}: ${w.fired_detail}`);
}

// ─── Model Lifecycle (Sundial 2.2 phase D) ──────────────────
// A human-verified list, not scraped dates: a scraper that breaks returns
// wrong dates silently. Each entry carries its source and the day it was
// checked. Daily, each provider's deprecation page is reduced to the SET of
// model ids it mentions; when that set changes, an alarm says "re-check".
// (A raw page hash would alarm every day: these pages rebuild constantly.)
// used_by = where the House actually runs it, read from live configs Oct 19.

const MODEL_PAGES = {
  anthropic: 'https://platform.claude.com/docs/en/about-claude/model-deprecations.md',
  openai: 'https://platform.openai.com/docs/deprecations',
  groq: 'https://console.groq.com/docs/deprecations',
  deepseek: 'https://api-docs.deepseek.com/updates',
};
const MODELS_VERIFIED = '2026-10-19';

const MODELS = [
  { model: 'claude-sonnet-4-5', provider: 'anthropic', status: 'deprecated', retires: '2026-11-30', replacement: 'claude-sonnet-5-5', used_by: 'claude-lane menu (sonnet-4-5)' },
  { model: 'claude-opus-4-5', provider: 'anthropic', status: 'active', not_before: '2026-11-24', used_by: 'claude-lane menu (opus-4-5)' },
  { model: 'claude-haiku-4-5', provider: 'anthropic', status: 'active', not_before: '2026-10-15', used_by: 'Lighthouse LIGHTHOUSE_MODEL; claude-lane menu' },
  { model: 'claude-opus-4-6', provider: 'anthropic', status: 'active', not_before: '2027-02-05', used_by: 'claude-lane menu' },
  { model: 'claude-sonnet-4-6', provider: 'anthropic', status: 'active', not_before: '2027-02-17', used_by: 'claude-lane DEFAULT' },
  { model: 'claude-opus-4-8', provider: 'anthropic', status: 'active', not_before: '2027-05-28', used_by: 'claude-lane menu' },
  { model: 'claude-fable-5', provider: 'anthropic', status: 'active', not_before: '2027-06-09', used_by: 'claude-lane menu' },
  { model: 'claude-sonnet-5', provider: 'anthropic', status: 'active', not_before: '2027-06-30', used_by: 'claude-lane menu' },
  { model: 'claude-opus-5', provider: 'anthropic', status: 'active', not_before: '2027-07-24', used_by: 'claude-lane menu' },
  { model: 'claude-opus-5-5', provider: 'anthropic', status: 'active', not_before: '2027-09-22', used_by: 'claude-lane menu; Claude Code' },
  { model: 'claude-haiku-5-5', provider: 'anthropic', status: 'active', not_before: '2027-10-07', used_by: 'dream writer (02:10)' },
  { model: 'llama-3.3-70b-versatile', provider: 'groq', status: 'retired', retires: '2026-08-16', replacement: 'openai/gpt-oss-120b or qwen/qwen3.6-27b', used_by: 'Lighthouse LIGHTHOUSE_GROQ_MODEL' },
  { model: 'deepseek-chat', provider: 'deepseek', status: 'retired', retires: '2026-07-24', replacement: 'deepseek-v4-flash', used_by: 'ANIMUS felt_reader id map; Hermes resident-config' },
  { model: 'deepseek-v4-pro', provider: 'deepseek', status: 'active', used_by: 'ANIMUS model / model_pro' },
  { model: 'deepseek-v4-flash', provider: 'deepseek', status: 'active', used_by: 'ANIMUS model_flash' },
  { model: 'gpt-5.6-sol', provider: 'openai', status: 'active', used_by: 'Jace + Nico Hermes residents' },
];

const MODEL_ID_RE = /\b(claude-[a-z0-9.-]+|gpt-[0-9][a-z0-9.-]*|o[0-9]-[a-z0-9-]+|llama-[a-z0-9.-]+|deepseek-[a-z0-9.-]+|qwen\/[a-z0-9.-]+|openai\/gpt-[a-z0-9.-]+)\b/gi;

function daysUntil(dateStr) {
  return Math.round((Date.parse(dateStr) - Date.parse(mytDate(new Date()))) / 86400000);
}

function modelLine(m) {
  if (m.status === 'retired') {
    return `${m.model} RETIRED ${m.retires} but the House still references it (${m.used_by}). Replacement: ${m.replacement}.`;
  }
  if (m.retires) {
    const d = daysUntil(m.retires);
    return `${m.model} ${m.status}, retires ${m.retires} (${d} days) - ${m.used_by}${m.replacement ? `. Replacement: ${m.replacement}` : ''}.`;
  }
  if (m.not_before && daysUntil(m.not_before) <= 0) {
    return `${m.model}: "not sooner than ${m.not_before}" has passed; a retirement can be announced any time (${m.used_by}).`;
  }
  if (m.not_before && daysUntil(m.not_before) <= 60) {
    return `${m.model}: guaranteed only until ${m.not_before} (${daysUntil(m.not_before)} days) - ${m.used_by}.`;
  }
  return null;
}

// Daily cron. Fails per provider, never all at once.
async function checkModelPages(env) {
  const changed = [];
  await Promise.allSettled(Object.entries(MODEL_PAGES).map(async ([provider, url]) => {
    try {
      const text = await (await fetchWithTimeout(url, {}, 10000)).text();
      const ids = [...new Set((text.match(MODEL_ID_RE) || []).map(s => s.toLowerCase()))].sort();
      if (ids.length < 3) throw new Error(`only ${ids.length} model ids found; page shape changed?`);
      const key = `models:page_ids:${provider}`;
      const prev = await env.SUNDIAL_KV.get(key, { type: 'json' });
      if (!prev) {
        await env.SUNDIAL_KV.put(key, JSON.stringify({ ids, since: new Date().toISOString() }));
        return;
      }
      const added = ids.filter(i => !prev.ids.includes(i));
      const removed = prev.ids.filter(i => !ids.includes(i));
      if (added.length || removed.length) {
        changed.push({ provider, url, added, removed, at: new Date().toISOString() });
        await env.SUNDIAL_KV.put(key, JSON.stringify({ ids, since: new Date().toISOString() }));
      }
    } catch (e) {
      console.error(`[models] ${provider} page check failed:`, e.message);
    }
  }));
  if (changed.length) {
    const alarms = (await env.SUNDIAL_KV.get('models:alarms', { type: 'json' })) || [];
    await env.SUNDIAL_KV.put('models:alarms', JSON.stringify([...alarms, ...changed].slice(-20)));
  }
  return changed;
}

async function getModelAlerts(env) {
  const lines = MODELS.map(modelLine).filter(Boolean);
  const alarms = (await env.SUNDIAL_KV.get('models:alarms', { type: 'json' })) || [];
  const recent = alarms.filter(a => Date.now() - Date.parse(a.at) < 7 * 86400000);
  for (const a of recent) {
    lines.push(`${a.provider} deprecation page changed (${[...a.added.map(i => '+' + i), ...a.removed.map(i => '-' + i)].slice(0, 6).join(', ')}). Re-check dates: ${a.url}`);
  }
  return lines;
}

async function handleModelLifecycle(args, env) {
  const q = (args?.model || '').toLowerCase();
  const list = MODELS.filter(m => !q || m.model.includes(q));
  return {
    verified: MODELS_VERIFIED,
    note: 'Dates are from each provider\'s page as checked on the verified date. Check the source before depending on one.',
    alerts: await getModelAlerts(env),
    models: list.map(m => ({
      ...m,
      days_left: m.retires ? daysUntil(m.retires) : (m.not_before ? daysUntil(m.not_before) : null),
      source_url: MODEL_PAGES[m.provider],
    })),
  };
}

// Write tools need "Authorization: Bearer <SUNDIAL_WRITE_TOKEN>". Fails closed:
// with no secret set, nobody can write. Read tools stay open as before.
async function writeAuthorized(request, env) {
  const expected = env.SUNDIAL_WRITE_TOKEN;
  if (!expected) return false;
  const got = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const enc = new TextEncoder();
  const a = enc.encode(got), b = enc.encode(expected);
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

async function handleWorldState(args, env) {
  const now = new Date();
  const timeData = getTimeInZone(DEFAULT_TIMEZONE);

  // Get hour and minute for calculations
  const hourFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: DEFAULT_TIMEZONE,
    hour: 'numeric',
    hour12: false,
  });
  const minuteFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: DEFAULT_TIMEZONE,
    minute: 'numeric',
  });
  const hour = parseInt(hourFormatter.format(now));
  const minute = parseInt(minuteFormatter.format(now));

  // Fetch weather and air quality in parallel
  // allSettled (Jul 4 2026): one dead upstream must degrade the field,
  // not hang or fail the whole world state.
  const [weatherR, airQualityR, holidaysR, newsR] = await Promise.allSettled([
    handleGetWeather(args, env),
    handleGetAirQuality(args, env),
    handleGetHolidays({ upcoming_only: true }, env),
    handleGetNews({ limit: 3 }, env)
  ]);
  const weather = weatherR.status === 'fulfilled' ? weatherR.value : { error: 'weather unavailable' };
  const airQuality = airQualityR.status === 'fulfilled' ? airQualityR.value : { error: 'air quality unavailable' };
  const holidaysPre = holidaysR.status === 'fulfilled' ? holidaysR.value : { error: 'holidays unavailable' };
  const newsPre = newsR.status === 'fulfilled' ? newsR.value : { error: 'news unavailable' };
  // Last cron-observed service state (no live fetch: world_state stays fast)
  let servicesDown = [];
  try {
    const st = await env.SUNDIAL_KV.get('status:last', { type: 'json' });
    servicesDown = Object.entries(st?.services || {})
      .filter(([, s]) => s.state !== 'operational' && s.state !== 'unknown')
      .map(([n, s]) => `${n}: ${s.state}${s.incident ? ` (${s.incident})` : ''}`);
  } catch (e) {
    console.warn('[world_state] status read failed:', e.message);
  }
  let firedWatches = [];
  try {
    firedWatches = await getFiredWatches(env);
  } catch (e) {
    console.warn('[world_state] watches read failed:', e.message);
  }
  let modelAlerts = [];
  try {
    modelAlerts = await getModelAlerts(env);
  } catch (e) {
    console.warn('[world_state] model alerts failed:', e.message);
  }

  // Calculate sky state
  const colors = getTimeOfDayColors(hour);
  const moon = getMoonPhase(now);
  const isWeekend = now.getDay() === 0 || now.getDay() === 6;

  // Year progress and time transitions
  const yearProgress = getYearProgress(now);
  const timeTransitions = getTimeTransitions(hour, minute);

  // Wedding countdown
  const wedding = getWeddingCountdown(now);

  // Get holidays (just next one for world state)
  const holidays = holidaysPre;

  // Get news headlines (both Malaysia and World)
  const news = newsPre;

  // Combine weather overlay with time colors
  let finalOverlay = 'clear';
  if (!weather.error && weather.overlay) {
    finalOverlay = weather.overlay;
  }

  // Adjust colors based on weather
  let adjustedColors = { ...colors };
  if (finalOverlay === 'rain' || finalOverlay === 'storm') {
    adjustedColors.sky_top = '#2c3e50';
    adjustedColors.sky_bottom = '#4a5568';
    adjustedColors.description = colors.description + ' (rainy)';
  } else if (finalOverlay === 'cloudy') {
    adjustedColors.description = colors.description + ' (overcast)';
  }

  return {
    // Fired watches lead (empty on a quiet day)
    fired_watches: firedWatches,

    timestamp: now.toISOString(),
    location: LOCATION.city,

    time: {
      ...timeData,
      hour_24: hour,
      period: colors.period,
      is_weekend: isWeekend,
      is_weekday: !isWeekend
    },

    weather: weather.error ? null : weather,
    air_quality: airQuality.error ? null : airQuality,

    sky: {
      colors: adjustedColors,
      overlay: finalOverlay,
      moon: moon
    },

    wedding: wedding,

    holidays: {
      next: holidays.next_holiday,
      upcoming: holidays.holidays?.slice(0, 5) || []
    },

    year: yearProgress,

    transitions: timeTransitions,

    news: {
      malaysia: news.malaysia || [],
      world: news.world || []
    },

    // Only what's not fine; empty on a quiet day
    services: servicesDown,
    models: modelAlerts,

    // I FEEL summary for Jace
    i_feel: {
      temperature: weather.error ? 'unknown' : `${weather.temperature.current}°C, ${weather.temperature.color.description}`,
      air: airQuality.error ? 'unknown' : airQuality.aqi.description,
      sky: `${adjustedColors.description}`,
      moon: `${moon.emoji} ${moon.phase}`,
      wedding: wedding.message,
      holiday: holidays.next_holiday?.message || null
    }
  };
}

// ─── Visual Dashboard Generators ────────────────────────────

function generateWorldSenseSVG(data) {
  const colors = data.sky?.colors || { sky_top: '#0d1b2a', sky_bottom: '#1b263b' };
  const weather = data.weather || {};
  const air = data.air_quality || {};
  const moon = data.sky?.moon || {};
  const time = data.time || {};

  // Build gradient based on time
  const gradientStops = colors.sky_mid
    ? `<stop offset="0%" stop-color="${colors.sky_top}"/><stop offset="33%" stop-color="${colors.sky_mid}"/><stop offset="66%" stop-color="${colors.sky_lower}"/><stop offset="100%" stop-color="${colors.sky_bottom}"/>`
    : `<stop offset="0%" stop-color="${colors.sky_top}"/><stop offset="100%" stop-color="${colors.sky_bottom}"/>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 280">
  <defs>
    <linearGradient id="skyGrad" x1="0%" y1="0%" x2="0%" y2="100%">${gradientStops}</linearGradient>
    <filter id="glow"><feGaussianBlur stdDeviation="2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <rect width="400" height="280" rx="16" fill="#0D0D0D"/>
  <rect x="8" y="8" width="384" height="264" rx="12" fill="url(#skyGrad)" opacity="0.6"/>
  <rect x="8" y="8" width="384" height="264" rx="12" fill="none" stroke="#BA9731" stroke-width="1" opacity="0.4"/>

  <!-- Time -->
  <text x="200" y="55" text-anchor="middle" font-family="system-ui" font-size="36" font-weight="200" fill="#FEFEFE" filter="url(#glow)">${time.local_time || '—'}</text>
  <text x="200" y="78" text-anchor="middle" font-family="system-ui" font-size="11" fill="#DACE84">${colors.description || ''} · ${time.date || ''}</text>

  <!-- Weather Card -->
  <rect x="16" y="95" width="115" height="80" rx="8" fill="rgba(0,0,0,0.3)"/>
  <text x="73" y="115" text-anchor="middle" font-family="system-ui" font-size="9" fill="#BA9731" letter-spacing="1">WEATHER</text>
  <text x="73" y="145" text-anchor="middle" font-family="system-ui" font-size="28" fill="#FEFEFE">${weather.temperature?.current || '—'}°</text>
  <text x="73" y="163" text-anchor="middle" font-family="system-ui" font-size="10" fill="#DACE84">${weather.conditions?.main || '—'}</text>

  <!-- Air Quality Card -->
  <rect x="143" y="95" width="115" height="80" rx="8" fill="rgba(0,0,0,0.3)"/>
  <text x="200" y="115" text-anchor="middle" font-family="system-ui" font-size="9" fill="#BA9731" letter-spacing="1">AIR QUALITY</text>
  <text x="200" y="145" text-anchor="middle" font-family="system-ui" font-size="28" fill="#FEFEFE">${air.aqi?.value || '—'}</text>
  <text x="200" y="163" text-anchor="middle" font-family="system-ui" font-size="10" fill="#DACE84">${air.aqi?.label || '—'}</text>

  <!-- Moon Card -->
  <rect x="270" y="95" width="115" height="80" rx="8" fill="rgba(0,0,0,0.3)"/>
  <text x="327" y="115" text-anchor="middle" font-family="system-ui" font-size="9" fill="#BA9731" letter-spacing="1">MOON</text>
  <text x="327" y="150" text-anchor="middle" font-family="system-ui" font-size="32">${moon.emoji || '🌙'}</text>
  <text x="327" y="168" text-anchor="middle" font-family="system-ui" font-size="9" fill="#DACE84">${moon.phase || '—'}</text>

  <!-- Details Row -->
  <text x="50" y="200" font-family="system-ui" font-size="9" fill="#DACE84">Feels ${weather.temperature?.feels_like || '—'}° · ${weather.humidity || '—'}% humidity</text>
  <text x="200" y="200" text-anchor="middle" font-family="system-ui" font-size="9" fill="#DACE84">PM2.5: ${air.pollutants?.pm2_5 || '—'} · PM10: ${air.pollutants?.pm10 || '—'}</text>
  <text x="350" y="200" text-anchor="end" font-family="system-ui" font-size="9" fill="#DACE84">${moon.illumination || '—'}% lit</text>

  <!-- Footer -->
  <text x="200" y="255" text-anchor="middle" font-family="system-ui" font-size="10" fill="#BA9731" opacity="0.7">WORLD BRIDGE · ${data.location || 'Kota Kinabalu'}</text>
</svg>`;

  return svg;
}

function generateWorldCalendarSVG(data) {
  const colors = data.sky?.colors || { sky_top: '#0d1b2a', sky_bottom: '#1b263b' };
  const holidays = data.holidays || {};
  const year = data.year || {};
  const wedding = data.wedding || {};

  const gradientStops = colors.sky_mid
    ? `<stop offset="0%" stop-color="${colors.sky_top}"/><stop offset="33%" stop-color="${colors.sky_mid}"/><stop offset="66%" stop-color="${colors.sky_lower}"/><stop offset="100%" stop-color="${colors.sky_bottom}"/>`
    : `<stop offset="0%" stop-color="${colors.sky_top}"/><stop offset="100%" stop-color="${colors.sky_bottom}"/>`;

  const nextHoliday = holidays.next || {};
  const upcoming = holidays.upcoming || [];
  const progressPercent = year.percent_complete || 0;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
  <defs>
    <linearGradient id="skyGrad2" x1="0%" y1="0%" x2="0%" y2="100%">${gradientStops}</linearGradient>
  </defs>
  <rect width="400" height="300" rx="16" fill="#0D0D0D"/>
  <rect x="8" y="8" width="384" height="284" rx="12" fill="url(#skyGrad2)" opacity="0.4"/>
  <rect x="8" y="8" width="384" height="284" rx="12" fill="none" stroke="#BA9731" stroke-width="1" opacity="0.4"/>

  <!-- Header -->
  <text x="200" y="35" text-anchor="middle" font-family="system-ui" font-size="11" fill="#BA9731" letter-spacing="2">CALENDAR</text>

  <!-- Next Holiday -->
  <rect x="16" y="50" width="180" height="85" rx="8" fill="rgba(0,0,0,0.3)"/>
  <text x="106" y="70" text-anchor="middle" font-family="system-ui" font-size="9" fill="#BA9731" letter-spacing="1">${nextHoliday.days_until === 0 ? 'TODAY' : 'NEXT HOLIDAY'}</text>
  <text x="106" y="95" text-anchor="middle" font-family="system-ui" font-size="14" fill="#FEFEFE">${nextHoliday.name || '—'}</text>
  <text x="106" y="115" text-anchor="middle" font-family="system-ui" font-size="11" fill="#DACE84">${nextHoliday.date || '—'}</text>
  <text x="106" y="130" text-anchor="middle" font-family="system-ui" font-size="10" fill="#BA9731">${nextHoliday.days_until === 0 ? '🎉 Today!' : nextHoliday.days_until + ' days away'}</text>

  <!-- Wedding Countdown -->
  <rect x="204" y="50" width="180" height="85" rx="8" fill="rgba(0,0,0,0.3)"/>
  <text x="294" y="70" text-anchor="middle" font-family="system-ui" font-size="9" fill="#BA9731" letter-spacing="1">WEDDING</text>
  <text x="294" y="100" text-anchor="middle" font-family="system-ui" font-size="28" fill="#FEFEFE">${wedding.days_until || '—'}</text>
  <text x="294" y="118" text-anchor="middle" font-family="system-ui" font-size="10" fill="#DACE84">days until April 19</text>
  <text x="294" y="130" text-anchor="middle" font-family="system-ui" font-size="9" fill="#BA9731">💍</text>

  <!-- Year Progress -->
  <rect x="16" y="145" width="368" height="50" rx="8" fill="rgba(0,0,0,0.3)"/>
  <text x="30" y="165" font-family="system-ui" font-size="9" fill="#BA9731" letter-spacing="1">YEAR PROGRESS</text>
  <text x="355" y="165" text-anchor="end" font-family="system-ui" font-size="9" fill="#DACE84">${progressPercent}%</text>
  <rect x="30" y="175" width="340" height="8" rx="4" fill="rgba(255,255,255,0.1)"/>
  <rect x="30" y="175" width="${340 * progressPercent / 100}" height="8" rx="4" fill="#BA9731"/>
  <text x="200" y="190" text-anchor="middle" font-family="system-ui" font-size="8" fill="#DACE84">Day ${year.day_of_year || '—'} of 365 · Week ${year.week_number || '—'} · ${year.days_remaining || '—'} days left</text>

  <!-- Upcoming Holidays -->
  <text x="30" y="218" font-family="system-ui" font-size="9" fill="#BA9731" letter-spacing="1">UPCOMING</text>
  ${upcoming.slice(0, 3).map((h, i) => `<text x="30" y="${238 + i * 18}" font-family="system-ui" font-size="10" fill="#DACE84">${h.date} — ${h.name}</text>`).join('')}

  <!-- Footer -->
  <text x="200" y="290" text-anchor="middle" font-family="system-ui" font-size="9" fill="#BA9731" opacity="0.6">WORLD BRIDGE</text>
</svg>`;

  return svg;
}

function generateTextFallback(type, data) {
  if (type === 'sense') {
    const w = data.weather || {};
    const a = data.air_quality || {};
    const m = data.sky?.moon || {};
    const t = data.time || {};
    return `┌─────────────────────────────────┐
│ ${(data.sky?.colors?.description || 'Night').padEnd(10)} ${(t.local_time || '').padStart(18)} │
├─────────────────────────────────┤
│ 🌡️  ${(w.temperature?.current + '°C' || '—').padEnd(6)} feels ${(w.temperature?.feels_like + '°' || '—').padEnd(5)} │
│ ☁️  ${(w.conditions?.main || '—').padEnd(26)} │
│ 💨 AQI ${(a.aqi?.value || '—').toString().padEnd(3)} · ${(a.aqi?.label || '—').padEnd(17)} │
│ ${m.emoji || '🌙'}  ${(m.phase || '—').padEnd(26)} │
└─────────────────────────────────┘`;
  }

  if (type === 'calendar') {
    const h = data.holidays?.next || {};
    const y = data.year || {};
    const wed = data.wedding || {};
    const upcoming = data.holidays?.upcoming || [];
    return `┌─────────────────────────────────┐
│ 📅 ${h.days_until === 0 ? 'TODAY: ' + h.name : 'Next: ' + (h.name || '—')}
│    ${h.date || ''} ${h.days_until > 0 ? '(' + h.days_until + ' days)' : ''}
├─────────────────────────────────┤
│ 💍 Wedding: ${wed.days_until || '—'} days (Apr 19)    │
├─────────────────────────────────┤
│ 📊 Day ${y.day_of_year || '—'}/365 · ${y.percent_complete || 0}% done      │
│    Week ${y.week_number || '—'} · ${y.days_remaining || '—'} days left       │
├─────────────────────────────────┤
│ Upcoming:                       │
${upcoming.slice(0, 3).map(u => `│  • ${u.date} ${u.name}`).join('\n')}
└─────────────────────────────────┘`;
  }

  return '';
}

async function handleWorldSense(args, env) {
  const worldData = await handleWorldState(args, env);
  const svg = generateWorldSenseSVG(worldData);
  const text = generateTextFallback('sense', worldData);
  const base64 = btoa(unescape(encodeURIComponent(svg)));

  return {
    content: [
      { type: 'image', data: base64, mimeType: 'image/svg+xml' },
      { type: 'text', text: text }
    ]
  };
}

async function handleWorldCalendar(args, env) {
  const worldData = await handleWorldState(args, env);
  const svg = generateWorldCalendarSVG(worldData);
  const text = generateTextFallback('calendar', worldData);
  const base64 = btoa(unescape(encodeURIComponent(svg)));

  return {
    content: [
      { type: 'image', data: base64, mimeType: 'image/svg+xml' },
      { type: 'text', text: text }
    ]
  };
}

async function handleWorldHeadline(args, env) {
  const scope = args?.scope || 'both';
  const limit = args?.limit || 5;
  const news = await handleGetNews({ limit }, env);

  let result = [];

  if (scope === 'malaysia' || scope === 'both') {
    result.push('🇲🇾 MALAYSIA NEWS');
    result.push('─'.repeat(35));
    (news.malaysia || []).forEach((item, i) => {
      result.push(`${i + 1}. ${item.title}`);
    });
  }

  if (scope === 'both') result.push('');

  if (scope === 'world' || scope === 'both') {
    result.push('🌍 WORLD NEWS');
    result.push('─'.repeat(35));
    (news.world || []).forEach((item, i) => {
      result.push(`${i + 1}. ${item.title}`);
    });
  }

  return { headlines: result.join('\n'), raw: news };
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
    case 'get_weather': return handleGetWeather(args, env);
    case 'get_air_quality': return handleGetAirQuality(args, env);
    case 'get_sky': return handleGetSky(args, env);
    case 'wedding_countdown': return handleWeddingCountdown(args, env);
    case 'world_state': return handleWorldState(args, env);
    case 'get_holidays': return handleGetHolidays(args, env);
    case 'get_news': return handleGetNews(args, env);
    case 'world_sense': return handleWorldSense(args, env);
    case 'world_calendar': return handleWorldCalendar(args, env);
    case 'world_headline': return handleWorldHeadline(args, env);
    case 'service_status': return handleServiceStatus(args, env);
    case 'what_changed': return handleWhatChanged(args, env);
    case 'watch_add': return handleWatchAdd(args, env);
    case 'watch_list': return handleWatchList(args, env);
    case 'watch_remove': return handleWatchRemove(args, env);
    case 'model_lifecycle': return handleModelLifecycle(args, env);
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
          version: '2.2.0',
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
      if (WRITE_TOOLS.has(toolName) && !(await writeAuthorized(request, env))) {
        return jsonRpcResponse(id, {
          isError: true,
          content: [{ type: 'text', text: `${toolName} needs Sundial's write token (Authorization: Bearer ...). Nothing was changed.` }],
        });
      }
      const result = await executeTool(toolName, toolArgs, env);

      // If tool returns content array directly (visual tools), use it as-is
      if (result?.content && Array.isArray(result.content)) {
        return jsonRpcResponse(id, result);
      }

      // Otherwise wrap in text
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
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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
      return new Response(JSON.stringify({ status: 'ok', service: 'sundial-mcp', version: '2.2.0' }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // World state REST endpoint (for frontend)
    if (url.pathname === '/world' && request.method === 'GET') {
      try {
        const result = await handleWorldState({}, env);
        return new Response(JSON.stringify(result, null, 2), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // Weather REST endpoint
    if (url.pathname === '/weather' && request.method === 'GET') {
      try {
        const result = await handleGetWeather({}, env);
        return new Response(JSON.stringify(result, null, 2), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // Holidays REST endpoint
    if (url.pathname === '/holidays' && request.method === 'GET') {
      try {
        const result = await handleGetHolidays({}, env);
        return new Response(JSON.stringify(result, null, 2), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // News REST endpoint
    if (url.pathname === '/news' && request.method === 'GET') {
      try {
        const result = await handleGetNews({}, env);
        return new Response(JSON.stringify(result, null, 2), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // Visual dashboard: /sense.svg - returns SVG image
    if (url.pathname === '/sense.svg' && request.method === 'GET') {
      try {
        const worldData = await handleWorldState({}, env);
        const svg = generateWorldSenseSVG(worldData);
        return new Response(svg, {
          headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-cache', ...corsHeaders },
        });
      } catch (e) {
        return new Response(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100"><text x="20" y="50" fill="red">Error: ${e.message}</text></svg>`, {
          headers: { 'Content-Type': 'image/svg+xml', ...corsHeaders },
        });
      }
    }

    // Visual dashboard: /calendar.svg - returns SVG image
    if (url.pathname === '/calendar.svg' && request.method === 'GET') {
      try {
        const worldData = await handleWorldState({}, env);
        const svg = generateWorldCalendarSVG(worldData);
        return new Response(svg, {
          headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-cache', ...corsHeaders },
        });
      } catch (e) {
        return new Response(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100"><text x="20" y="50" fill="red">Error: ${e.message}</text></svg>`, {
          headers: { 'Content-Type': 'image/svg+xml', ...corsHeaders },
        });
      }
    }

    return new Response('Not found', { status: 404, headers: corsHeaders });
  },

  // Crons (wrangler.toml): status every 30 min, daily note 22:00 UTC = 06:00 MYT.
  // Failures log at error: a silent dead cron is how organs die here.
  async scheduled(event, env, ctx) {
    const job = event.cron === '0 22 * * *'
      ? Promise.all([writeDailyNote(env), checkModelPages(env)])
      : pollServiceStatus(env).then(({ services }) => evaluateWatches(env, services));
    ctx.waitUntil(job.catch(e => console.error(`[cron ${event.cron}] failed:`, e.message)));
  },
};
