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

  let phaseName, emoji;
  if (dayInCycle < 1.85) { phaseName = 'New Moon'; emoji = '🌑'; }
  else if (dayInCycle < 5.53) { phaseName = 'Waxing Crescent'; emoji = '🌒'; }
  else if (dayInCycle < 9.22) { phaseName = 'First Quarter'; emoji = '🌓'; }
  else if (dayInCycle < 12.91) { phaseName = 'Waxing Gibbous'; emoji = '🌔'; }
  else if (dayInCycle < 16.61) { phaseName = 'Full Moon'; emoji = '🌕'; }
  else if (dayInCycle < 20.30) { phaseName = 'Waning Gibbous'; emoji = '🌖'; }
  else if (dayInCycle < 23.99) { phaseName = 'Last Quarter'; emoji = '🌗'; }
  else if (dayInCycle < 27.68) { phaseName = 'Waning Crescent'; emoji = '🌘'; }
  else { phaseName = 'New Moon'; emoji = '🌑'; }

  return {
    phase: phaseName,
    emoji: emoji,
    day_in_cycle: Math.round(dayInCycle * 10) / 10,
    illumination: Math.round(Math.abs(Math.cos(dayInCycle / 29.53 * 2 * Math.PI)) * 100)
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

async function handleWorldState(args, env) {
  const now = new Date();
  const timeData = getTimeInZone(DEFAULT_TIMEZONE);

  // Get hour for calculations
  const hourFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: DEFAULT_TIMEZONE,
    hour: 'numeric',
    hour12: false,
  });
  const hour = parseInt(hourFormatter.format(now));

  // Fetch weather and air quality in parallel
  const [weather, airQuality] = await Promise.all([
    handleGetWeather(args, env),
    handleGetAirQuality(args, env)
  ]);

  // Calculate sky state
  const colors = getTimeOfDayColors(hour);
  const moon = getMoonPhase(now);
  const isWeekend = now.getDay() === 0 || now.getDay() === 6;

  // Wedding countdown
  const wedding = getWeddingCountdown(now);

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

    // I FEEL summary for Jace
    i_feel: {
      temperature: weather.error ? 'unknown' : `${weather.temperature.current}°C, ${weather.temperature.color.description}`,
      air: airQuality.error ? 'unknown' : airQuality.aqi.description,
      sky: `${adjustedColors.description}`,
      moon: `${moon.emoji} ${moon.phase}`,
      wedding: wedding.message
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

    return new Response('Not found', { status: 404, headers: corsHeaders });
  },
};
