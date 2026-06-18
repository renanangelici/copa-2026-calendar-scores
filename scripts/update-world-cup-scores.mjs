import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CONFIG = {
  calendarId:
    process.env.GOOGLE_CALENDAR_ID ||
    "5876f101afb64371650d9ac4ab8c39c59dfacae79cbe4f29be21a4312daa860f@group.calendar.google.com",
  apiFootballKey: process.env.API_FOOTBALL_KEY,
  apiBase: "https://v3.football.api-sports.io",
  espnScoreboardUrl:
    process.env.ESPN_SCOREBOARD_URL ||
    "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard",
  worldCupApiBase: process.env.WORLDCUP26_API_BASE || "https://worldcup26.ir",
  useApiFootballFallback: process.env.USE_API_FOOTBALL_FALLBACK === "1",
  apiLeagueId: process.env.API_FOOTBALL_LEAGUE_ID || "1",
  apiSeason: process.env.API_FOOTBALL_SEASON || "2026",
  timezone: "America/Sao_Paulo",
  forceRun: process.env.FORCE_RUN === "1",
  dryRun: process.env.DRY_RUN === "1",
  schedulePath: "copa-do-mundo-2026-todos-os-jogos.csv"
};

const TEAM_ALIASES = {
  "mexico": ["mexico", "méxico"],
  "south africa": ["south africa", "africa do sul", "áfrica do sul"],
  "korea republic": ["korea republic", "south korea", "coreia do sul"],
  "czechia": ["czechia", "czech republic", "tchequia"],
  "canada": ["canada", "canadá"],
  "bosnia and herzegovina": ["bosnia and herzegovina", "bosnia", "bósnia e herzegovina", "bosnia e herzegovina"],
  "united states": ["united states", "usa", "estados unidos"],
  "paraguay": ["paraguay", "paraguai"],
  "haiti": ["haiti"],
  "scotland": ["scotland", "escocia", "escócia"],
  "australia": ["australia", "austrália"],
  "turkey": ["turkey", "turkiye", "türkiye", "turquia"],
  "brazil": ["brazil", "brasil"],
  "morocco": ["morocco", "marrocos"],
  "qatar": ["qatar", "catar"],
  "switzerland": ["switzerland", "suica", "suíça"],
  "cote divoire": ["cote divoire", "cote d'ivoire", "côte d'ivoire", "ivory coast", "costa do marfim"],
  "ecuador": ["ecuador", "equador"],
  "germany": ["germany", "alemanha"],
  "curacao": ["curacao", "curaçao"],
  "netherlands": ["netherlands", "paises baixos", "países baixos", "holanda"],
  "japan": ["japan", "japao", "japão"],
  "sweden": ["sweden", "suecia", "suécia"],
  "tunisia": ["tunisia", "tunísia"],
  "saudi arabia": ["saudi arabia", "arabia saudita", "arábia saudita"],
  "uruguay": ["uruguay", "uruguai"],
  "spain": ["spain", "espanha"],
  "cape verde": ["cape verde", "cabo verde"],
  "iran": ["iran", "ir iran", "ira"],
  "new zealand": ["new zealand", "nova zelandia", "nova zelândia"],
  "belgium": ["belgium", "belgica", "bélgica"],
  "egypt": ["egypt", "egito"],
  "france": ["france", "franca", "frança"],
  "senegal": ["senegal"],
  "iraq": ["iraq", "iraque"],
  "norway": ["norway", "noruega"],
  "argentina": ["argentina"],
  "algeria": ["algeria", "argelia", "argélia"],
  "austria": ["austria", "áustria"],
  "jordan": ["jordan", "jordania", "jordânia"],
  "ghana": ["ghana", "gana"],
  "panama": ["panama", "panamá"],
  "england": ["england", "inglaterra"],
  "croatia": ["croatia", "croacia", "croácia"],
  "portugal": ["portugal"],
  "congo dr": ["congo dr", "dr congo", "congo", "rd congo", "dr congo", "congo dr"],
  "uzbekistan": ["uzbekistan", "uzbequistao", "uzbequistão"],
  "colombia": ["colombia", "colômbia"]
};

const FINAL_STATUSES = new Set(["FT", "AET", "PEN"]);
const LIVE_STATUSES = new Set(["1H", "HT", "2H", "ET", "BT", "P", "LIVE"]);

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});

async function main() {
  validateEnv();

  const now = new Date();
  const schedule = readSchedule(CONFIG.schedulePath);
  if (!CONFIG.forceRun && !isInAnyMatchWindow(schedule, now)) {
    console.log("Fora de janela de jogo. Nada a fazer.");
    return;
  }

  const calendarToken = await getGoogleAccessToken();
  const candidates = await getCandidateCalendarEvents(calendarToken, now);
  if (!candidates.length) {
    console.log("Nenhum evento candidato encontrado na agenda.");
    return;
  }

  const fixtures = await getRelevantFixtures(now);
  if (!fixtures.length) {
    console.log("Nenhuma fonte retornou partidas relevantes agora.");
    return;
  }

  let updates = 0;
  for (const event of candidates) {
    const fixture = findMatchingFixture(event, fixtures);
    if (!fixture) continue;

    const patch = buildEventPatch(event, fixture);
    if (!patch) continue;

    updates += 1;
    console.log(`${CONFIG.dryRun ? "[DRY RUN] " : ""}${event.summary} -> ${patch.summary}`);
    if (!CONFIG.dryRun) {
      await patchCalendarEvent(calendarToken, event.id, patch);
    }
  }

  console.log(`Eventos atualizados: ${updates}`);
}

function validateEnv() {
  if (CONFIG.useApiFootballFallback && !CONFIG.apiFootballKey) {
    throw new Error("Falta secret API_FOOTBALL_KEY.");
  }
  if (
    !process.env.GOOGLE_SERVICE_ACCOUNT_JSON &&
    (!process.env.GOOGLE_OAUTH_CLIENT_JSON || !process.env.GOOGLE_OAUTH_REFRESH_TOKEN)
  ) {
    throw new Error(
      "Faltam secrets do Google. Use GOOGLE_SERVICE_ACCOUNT_JSON ou GOOGLE_OAUTH_CLIENT_JSON + GOOGLE_OAUTH_REFRESH_TOKEN."
    );
  }
}

function readSchedule(filePath) {
  const rows = parseCsv(fs.readFileSync(filePath, "utf8"));
  return rows.map(row => ({
    matchNumber: Number(row.Jogo),
    title: row.Titulo,
    phase: row.Fase,
    utcStart: new Date(row["Data UTC"])
  }));
}

function isInAnyMatchWindow(schedule, now) {
  const nowMs = now.getTime();
  return schedule.some(match => {
    const start = match.utcStart.getTime();
    const windowStart = start - 20 * 60 * 1000;
    const windowEnd = start + 6 * 60 * 60 * 1000;
    return nowMs >= windowStart && nowMs <= windowEnd;
  });
}

async function getRelevantFixtures(now) {
  const map = new Map();

  try {
    const espn = await espnFixtures(now);
    console.log(`ESPN retornou ${espn.length} partida(s).`);
    for (const fixture of espn) {
      map.set(`espn:${fixture.fixture.id}`, fixture);
    }
  } catch (error) {
    console.warn(`ESPN indisponivel nesta execucao: ${error.message}`);
  }

  try {
    const worldCupFixtures = await worldCup26Fixtures();
    console.log(`worldcup26.ir retornou ${worldCupFixtures.length} partida(s).`);
    for (const fixture of worldCupFixtures) {
      map.set(`worldcup26:${fixture.matchNumber}`, fixture);
    }
  } catch (error) {
    console.warn(`worldcup26.ir indisponivel nesta execucao: ${error.message}`);
  }

  if (!CONFIG.useApiFootballFallback) {
    return [...map.values()];
  }

  try {
    const live = await apiFootball("/fixtures?live=all");
    const liveFixtures = live.response || [];

    let dateFixtures = [];
    if (!liveFixtures.length) {
      const today = formatDateInTimeZone(now, CONFIG.timezone);
      const byDate = await apiFootball(
        `/fixtures?date=${today}&league=${CONFIG.apiLeagueId}&season=${CONFIG.apiSeason}`
      );
      dateFixtures = byDate.response || [];
    }

    console.log(`API-Football retornou ${liveFixtures.length} live e ${dateFixtures.length} por data.`);

    for (const fixture of [...liveFixtures, ...dateFixtures]) {
      map.set(`api-football:${fixture.fixture.id}`, fixture);
    }
  } catch (error) {
    console.warn(`API-Football indisponivel nesta execucao: ${error.message}`);
  }

  return [...map.values()];
}

async function espnFixtures(now) {
  const date = formatDateInTimeZone(now, CONFIG.timezone).replace(/-/g, "");
  const data = await fetchJsonWithRetry(`${CONFIG.espnScoreboardUrl}?dates=${date}`, {}, 3);
  const events = data.events || [];
  return events.map(espnEventToFixture).filter(Boolean);
}

function espnEventToFixture(event) {
  const competition = event.competitions?.[0];
  if (!competition) return null;

  const competitors = competition.competitors || [];
  const home = competitors.find(team => team.homeAway === "home");
  const away = competitors.find(team => team.homeAway === "away");
  if (!home || !away) return null;

  const status = competition.status || event.status || {};
  const statusType = status.type || {};
  const statusName = String(statusType.name || "").toUpperCase();
  const statusState = String(statusType.state || "").toLowerCase();
  const completed = Boolean(statusType.completed);

  let shortStatus = "NS";
  if (completed || statusState === "post") {
    shortStatus = "FT";
  } else if (statusName.includes("HALFTIME") || statusName.includes("STATUS_HALFTIME")) {
    shortStatus = "HT";
  } else if (statusState === "in") {
    shortStatus = "LIVE";
  }

  const elapsed = parseElapsedLabel(status.displayClock || statusType.detail || statusType.shortDetail);

  return {
    source: "ESPN",
    matchNumber: Number(event.id),
    fixture: {
      id: `espn-${event.id}`,
      date: event.date || competition.date,
      status: { short: shortStatus, elapsed: elapsed.minute, rawElapsed: elapsed.label }
    },
    teams: {
      home: { name: home.team?.displayName || home.team?.name || "" },
      away: { name: away.team?.displayName || away.team?.name || "" }
    },
    goals: { home: parseScore(home.score), away: parseScore(away.score) }
  };
}

async function apiFootball(path) {
  const response = await fetch(CONFIG.apiBase + path, {
    headers: { "x-apisports-key": CONFIG.apiFootballKey }
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`API-Football HTTP ${response.status}: ${text.slice(0, 400)}`);
  }
  return JSON.parse(text);
}

async function worldCup26Fixtures() {
  const data = await fetchJsonWithRetry(`${CONFIG.worldCupApiBase}/get/games`, {}, 3);
  const games = data.games || [];
  return games.map(worldCup26GameToFixture).filter(Boolean);
}

async function fetchJsonWithRetry(url, options = {}, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchJson(url, options);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise(resolve => setTimeout(resolve, attempt * 1000));
      }
    }
  }
  throw lastError;
}

async function fetchJson(url, options = {}) {
  try {
    const response = await fetch(url, options);
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 400)}`);
    }
    return JSON.parse(text);
  } catch (error) {
    if (isDnsFailure(error) && (!options.method || options.method === "GET") && !options.headers) {
      const { stdout } = await execFileAsync("curl", ["-L", "-sS", url], {
        maxBuffer: 20 * 1024 * 1024
      });
      return JSON.parse(stdout);
    }
    throw error;
  }
}

function isDnsFailure(error) {
  return (
    error?.cause?.code === "ENOTFOUND" ||
    error?.cause?.code === "EAI_AGAIN" ||
    error?.code === "ENOTFOUND" ||
    error?.code === "EAI_AGAIN"
  );
}

function worldCup26GameToFixture(game) {
  const homeGoals = parseScore(game.home_score);
  const awayGoals = parseScore(game.away_score);
  const timeElapsed = String(game.time_elapsed || "").trim();
  const elapsed = parseElapsedLabel(timeElapsed);
  const finished = /^true$/i.test(String(game.finished || ""));
  const notStarted = !finished && /^(notstarted|not started|ns|upcoming|scheduled)?$/i.test(timeElapsed);

  let shortStatus = "NS";
  if (finished) {
    shortStatus = "FT";
  } else if (/^(ht|half[- ]?time|interval)$/i.test(timeElapsed)) {
    shortStatus = "HT";
  } else if (!notStarted) {
    shortStatus = "LIVE";
  }

  return {
    source: "worldcup26.ir",
    matchNumber: Number(game.id),
    fixture: {
      id: `worldcup26-${game.id}`,
      date: game.date || parseWorldCup26LocalDate(game.local_date),
      status: { short: shortStatus, elapsed: elapsed.minute, rawElapsed: elapsed.label }
    },
    teams: {
      home: { name: game.home_team_name_en || game.home_team_label || "" },
      away: { name: game.away_team_name_en || game.away_team_label || "" }
    },
    goals: { home: homeGoals, away: awayGoals }
  };
}

function parseScore(value) {
  if (value == null || value === "" || /^null$/i.test(String(value))) return null;
  const score = Number(value);
  return Number.isFinite(score) ? score : null;
}

function parseElapsedLabel(value) {
  const match = String(value || "").match(/(\d{1,3})(?:\s*\+\s*(\d{1,2}))?/);
  if (!match) return { minute: null, label: null };

  const minute = Number(match[1]);
  const label = match[2] ? `${match[1]}+${match[2]}'` : `${match[1]}'`;
  return { minute: Number.isFinite(minute) ? minute : null, label };
}

function parseWorldCup26LocalDate(value) {
  const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, month, day, year, hour, minute] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:00`;
}

async function getCandidateCalendarEvents(token, now) {
  const timeMin = new Date(now.getTime() - 8 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date(now.getTime() + 45 * 60 * 1000).toISOString();
  const params = new URLSearchParams({
    singleEvents: "true",
    orderBy: "startTime",
    timeMin,
    timeMax,
    maxResults: "20"
  });

  const response = await googleFetch(
    token,
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CONFIG.calendarId)}/events?${params}`
  );
  const data = await response.json();
  return (data.items || []).filter(event =>
    /Jogo\s+\d+\s+da Copa do Mundo/i.test(stripHtml(event.description || ""))
  );
}

function findMatchingFixture(event, fixtures) {
  const eventTitle = normalize(event.summary || "");
  const eventStart = new Date(event.start?.dateTime || event.start?.date).getTime();
  const eventMatchNumber = matchNumberFromDescription(event.description || "");

  const scored = fixtures
    .map(fixture => {
      const fixtureStart = new Date(fixture.fixture.date).getTime();
      const diffMinutes = Math.abs(fixtureStart - eventStart) / 60000;

      const home = fixture.teams.home.name;
      const away = fixture.teams.away.name;
      const homeMatches = aliasesFor(home).some(alias => eventTitle.includes(normalize(alias)));
      const awayMatches = aliasesFor(away).some(alias => eventTitle.includes(normalize(alias)));
      const teamScore = (homeMatches ? 4 : 0) + (awayMatches ? 4 : 0);
      const numberScore = eventMatchNumber && fixture.matchNumber === eventMatchNumber ? 2 : 0;
      if (teamScore < 8) return null;

      if (!eventMatchNumber || fixture.matchNumber !== eventMatchNumber) {
        if (!Number.isFinite(diffMinutes) || diffMinutes > 150) return null;
      }

      const timeScore = Number.isFinite(diffMinutes) ? Math.max(0, 3 - diffMinutes / 20) : 0;

      return { fixture, score: teamScore + numberScore + timeScore, teamScore, diffMinutes };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best) return null;
  if (best.teamScore >= 8) return best.fixture;
  if (best.diffMinutes <= 20 && (!scored[1] || scored[1].diffMinutes > 20)) return best.fixture;
  return null;
}

function buildEventPatch(event, fixture) {
  const status = fixture.fixture.status || {};
  const shortStatus = status.short;
  const isFinal = FINAL_STATUSES.has(shortStatus);
  const isLive = LIVE_STATUSES.has(shortStatus);
  if (!isFinal && !isLive) return null;

  const homeGoals = fixture.goals.home;
  const awayGoals = fixture.goals.away;
  if (homeGoals == null || awayGoals == null) return null;

  const titleParts = getTitleParts(event.summary || "");
  const statusLabel = getStatusLabel(shortStatus, status.elapsed, status.rawElapsed);
  const stage = titleParts.stage || stageFromDescription(event.description || "");
  const prefix = isFinal ? stage : `${stage} - ${statusLabel}`;
  const nextSummary = `(${prefix}) ${titleParts.left} ${homeGoals} x ${awayGoals} ${titleParts.right}`.trim();

  const patch = {};
  if (event.summary !== nextSummary) patch.summary = nextSummary;

  if (isFinal) {
    const finalLine = `Placar final: ${stripFlag(titleParts.left)} ${homeGoals} x ${awayGoals} ${stripFlag(titleParts.right)}.`;
    const nextDescription = upsertFinalScoreLine(event.description || "", finalLine);
    if ((event.description || "") !== nextDescription) patch.description = nextDescription;
  }

  return Object.keys(patch).length ? patch : null;
}

async function patchCalendarEvent(token, eventId, patch) {
  const response = await googleFetch(
    token,
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CONFIG.calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    }
  );
  await response.json();
}

async function googleFetch(token, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Calendar HTTP ${response.status}: ${text.slice(0, 800)}`);
  }
  return response;
}

async function getGoogleAccessToken() {
  if (process.env.GOOGLE_OAUTH_CLIENT_JSON && process.env.GOOGLE_OAUTH_REFRESH_TOKEN) {
    return getGoogleAccessTokenWithRefreshToken();
  }

  const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/calendar.events",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  };

  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(unsigned)
    .sign(serviceAccount.private_key);
  const assertion = `${unsigned}.${base64url(signature)}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Google OAuth HTTP ${response.status}: ${JSON.stringify(data).slice(0, 800)}`);
  }
  return data.access_token;
}

async function getGoogleAccessTokenWithRefreshToken() {
  const client = parseOAuthClient(process.env.GOOGLE_OAUTH_CLIENT_JSON);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client.client_id,
      client_secret: client.client_secret,
      refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN,
      grant_type: "refresh_token"
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Google OAuth refresh HTTP ${response.status}: ${JSON.stringify(data).slice(0, 800)}`);
  }
  return data.access_token;
}

function parseOAuthClient(rawJson) {
  const parsed = JSON.parse(rawJson);
  const client = parsed.installed || parsed.web || parsed;
  if (!client.client_id || !client.client_secret) {
    throw new Error("GOOGLE_OAUTH_CLIENT_JSON nao contem client_id/client_secret.");
  }
  return client;
}

function getTitleParts(title) {
  const match = title.match(/^\(([^)]+)\)\s+(.+)$/);
  const rawStage = match ? match[1] : "";
  const rest = match ? match[2] : title;
  const stage = rawStage.split(" - ")[0];

  const scored = rest.match(/^(.+?)\s+\d+\s+x\s+\d+\s+(.+)$/);
  if (scored) return { stage, left: scored[1].trim(), right: scored[2].trim() };

  const future = rest.match(/^(.+?)\s+x\s+(.+)$/);
  if (future) return { stage, left: future[1].trim(), right: future[2].trim() };

  return { stage, left: rest.trim(), right: "" };
}

function stageFromDescription(description) {
  const clean = stripHtml(description);
  const match = clean.match(/Fase:\s*([^\n.]+)/i);
  return match ? match[1].trim() : "";
}

function getStatusLabel(shortStatus, elapsed, rawElapsed = null) {
  if (shortStatus === "HT") return "Intervalo";
  if (shortStatus === "ET") return elapsed ? `Prorrogacao ${elapsed}'` : "Prorrogacao";
  if (shortStatus === "P") return "Penaltis";
  if (rawElapsed) return `AO VIVO ${rawElapsed}`;
  return elapsed ? `AO VIVO ${elapsed}'` : "AO VIVO";
}

function matchNumberFromDescription(description) {
  const match = stripHtml(description).match(/Jogo\s+(\d+)\s+da Copa do Mundo/i);
  return match ? Number(match[1]) : null;
}

function upsertFinalScoreLine(description, finalLine) {
  const lines = stripHtml(description)
    .split(/\n|(?=Fase:)|(?=Horário no Rio de Janeiro:)|(?=Transmissão:)/)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !/^Placar final:/i.test(line));

  const phaseIndex = lines.findIndex(line => /^Fase:/i.test(line));
  if (phaseIndex === -1) {
    lines.splice(1, 0, finalLine);
  } else {
    lines.splice(phaseIndex + 1, 0, finalLine);
  }
  return lines.join("\n");
}

function aliasesFor(name) {
  const key = normalize(name);
  for (const aliases of Object.values(TEAM_ALIASES)) {
    if (aliases.map(normalize).includes(key)) return aliases;
  }
  return [name];
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function stripFlag(value) {
  return String(value || "")
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, "")
    .replace(/[\u{1F3F4}\u{E0061}-\u{E007A}\u{E007F}]/gu, "")
    .trim();
}

function stripHtml(value) {
  return String(value || "").replace(/<[^>]+>/g, "");
}

function formatDateInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const [headers, ...dataRows] = rows;
  return dataRows
    .filter(values => values.some(Boolean))
    .map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}
