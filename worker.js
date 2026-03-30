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
  // Evening: golden hour — Kota Kinabalu sky
  if (hour >= 17 && hour < 20) return {
    period: 'evening',
    sky_top: '#5D4E6D',     /* lavender-purple */
    sky_mid: '#9D7E8C',     /* dusty mauve */
    sky_lower: '#E8A087',   /* coral pink */
    sky_bottom: '#FF8C42',  /* golden orange */
    accent: '#FFAB76',      /* warm peach */
    description: 'Golden hour'
  };
  // Night: deep blues, purples
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
  // Define periods: dawn(5-7), morning(7-12), afternoon(12-17), evening(17-20), night(20-5)
  const transitions = [
    { name: 'Dawn', start: 5, end: 7 },
    { name: 'Morning', start: 7, end: 12 },
    { name: 'Afternoon', start: 12, end: 17 },
    { name: 'Evening', start: 17, end: 20 },
    { name: 'Night', start: 20, end: 29 }, // 29 = 5am next day
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
      { name: 'Evening', hours: '5-8 PM', active: currentPeriod === 'Evening' },
      { name: 'Night', hours: '8 PM-5 AM', active: currentPeriod === 'Night' },
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

// ─── Weather & World Handlers ───────────────────────────────

async function handleGetWeather(args, env) {
  const apiKey = env.OPENWEATHER_API_KEY;
  if (!apiKey) return { error: 'OpenWeather API key not configured' };

  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${LOCATION.lat}&lon=${LOCATION.lon}&appid=${apiKey}&units=metric`;
    const response = await fetch(url);
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
    const response = await fetch(url);
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
      const response = await fetch(url);
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

async function fetchNewsFromRSS(url, cacheKey, sourceName, env) {
  // Check cache first (30 minutes)
  const cached = await env.SUNDIAL_KV.get(cacheKey, { type: 'json' });

  if (cached && cached.fetched_at) {
    const cacheAge = Date.now() - new Date(cached.fetched_at).getTime();
    if (cacheAge < 30 * 60 * 1000) {
      return { headlines: cached.headlines, cached: true };
    }
  }

  try {
    const response = await fetch(url, {
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
  const [malaysia, world] = await Promise.all([
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

  return {
    malaysia: malaysia.headlines.slice(0, limit),
    world: world.headlines.slice(0, limit),
    cached: malaysia.cached && world.cached
  };
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
  const [weather, airQuality] = await Promise.all([
    handleGetWeather(args, env),
    handleGetAirQuality(args, env)
  ]);

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
  const holidays = await handleGetHolidays({ upcoming_only: true }, env);

  // Get news headlines (both Malaysia and World)
  const news = await handleGetNews({ limit: 3 }, env);

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
          version: '2.0.0',
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
      return new Response(JSON.stringify({ status: 'ok', service: 'sundial-mcp', version: '2.0.0' }), {
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

    return new Response('Not found', { status: 404, headers: corsHeaders });
  },
};
