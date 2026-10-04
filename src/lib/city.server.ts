import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getSql, type Sql } from "@/lib/db";
import type {
  AgentView,
  BotView,
  BuildingView,
  CitySummary,
  CityView,
  EventView,
  InviteView,
  MemberRole,
  MessageView,
} from "@/lib/city-types";

const STALE_MS = 5 * 1000;
const MAX_HOUSES = 5;
const MAX_ROOMS = 6;
const MAX_AGENTS = 24;
const BEAM_COLORS = ["#7ef0c3", "#f0d48a", "#ffb15a", "#f2a3c7", "#9fd0ff", "#e7f7a1"];

type BotAction = "start" | "stop" | "upload" | "pulse";

type BotRow = {
  id: string;
  city_id: string;
  owner_user_id: string;
  name: string;
  room_slot: number;
  status: string;
  color: string;
  updated_ms: number;
  last_file: string | null;
  city_name: string;
};

function id() {
  return randomUUID();
}

function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function newBotCode() {
  return `ll_${randomBytes(18).toString("base64url")}`;
}

function newInviteCode() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(8);
  let body = "";
  for (let i = 0; i < 8; i += 1) body += alphabet[bytes[i]! % alphabet.length];
  return `line-${body.slice(0, 4)}-${body.slice(4)}`;
}

export function normalizeInvite(raw: string) {
  const compact = raw.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!compact.startsWith("line") || compact.length !== 12) return null;
  const body = compact.slice(4);
  return `line-${body.slice(0, 4)}-${body.slice(4)}`;
}

function cleanLabel(value: unknown, label: string, min: number, max: number) {
  if (typeof value !== "string") throw new Error(`${label} is required.`);
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < min || name.length > max) {
    throw new Error(`${label} must be ${min}–${max} characters.`);
  }
  if (/[\u0000-\u001f]/.test(name)) throw new Error(`${label} has invalid characters.`);
  return name;
}

function cleanHouse(value: unknown, fallback: string) {
  if (typeof value !== "string" || value.trim() === "") return fallback;
  return cleanLabel(value, "House name", 2, 32);
}

function cleanFilename(value: unknown) {
  if (typeof value !== "string") throw new Error("File name is required.");
  const base = value.trim().replace(/\\/g, "/").split("/").pop() ?? "";
  const name = base.replace(/[^\w.\- ()[\]+]/g, "").slice(0, 80);
  if (!name) throw new Error("File name is required.");
  return name;
}

function asNumber(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function workingNow(status: string, updatedMs: number) {
  return status === "working" && Date.now() - updatedMs < STALE_MS;
}

async function loadRoster(sql: Sql, userId: string): Promise<AgentView[]> {
  const rows = await sql<{
    id: string;
    name: string;
    color: string;
    token_plain: string;
    city_id: string | null;
    city_name: string | null;
    room_slot: number | null;
  }>`
    select a.id, a.name, a.color, a.token_plain,
      b.city_id, c.name as city_name, b.room_slot
    from agents a
    left join bots b on b.agent_id = a.id
    left join cities c on c.id = b.city_id
    where a.owner_user_id = ${userId}
    order by a.created_at asc, c.name asc
  `;
  const byId = new Map<string, AgentView>();
  for (const row of rows) {
    let agent = byId.get(row.id);
    if (!agent) {
      agent = { id: row.id, name: row.name, color: row.color, code: row.token_plain, rooms: [] };
      byId.set(row.id, agent);
    }
    if (row.city_id && row.city_name && row.room_slot != null) {
      agent.rooms.push({ cityId: row.city_id, cityName: row.city_name, slot: row.room_slot });
    }
  }
  return [...byId.values()];
}

async function loadCity(sql: Sql, userId: string, cityId: string): Promise<CityView | null> {
  const gate = await sql<{ role: string }>`
    select role from city_members where city_id = ${cityId} and user_id = ${userId}
  `;
  const role = gate[0]?.role;
  if (role !== "owner" && role !== "guest") return null;

  const cities = await sql<{ id: string; name: string }>`
    select id, name from cities where id = ${cityId}
  `;
  const city = cities[0];
  if (!city) return null;

  const members = await sql<{
    user_id: string;
    role: string;
    building_name: string;
    building_key: string | null;
    room_slot: number | null;
  }>`
    select user_id, role, building_name, building_key, room_slot
    from city_members
    where city_id = ${cityId}
    order by joined_at asc
  `;

  const botRows = await sql<{
    id: string;
    agent_id: string;
    owner_user_id: string;
    name: string;
    room_slot: number;
    status: string;
    updated_ms: unknown;
    last_file: string | null;
    color: string;
    token_plain: string | null;
  }>`
    select b.id, b.agent_id, b.owner_user_id, a.name, b.room_slot, b.status,
      (extract(epoch from b.updated_at) * 1000)::bigint as updated_ms,
      b.last_file, a.color,
      case when b.owner_user_id = ${userId} then a.token_plain else null end as token_plain
    from bots b
    join agents a on a.id = b.agent_id
    where b.city_id = ${cityId}
    order by b.room_slot asc
  `;

  const eventRows = await sql<{
    id: string;
    bot_id: string;
    bot_name: string;
    kind: string;
    filename: string | null;
    color: string;
    at: unknown;
  }>`
    select id, bot_id, bot_name, kind, filename, color,
      (extract(epoch from created_at) * 1000)::bigint as at
    from city_events
    where city_id = ${cityId}
    order by created_at desc
    limit 30
  `;

  const inviteRows =
    role === "owner"
      ? await sql<{ id: string; code_plain: string }>`
          select id, code_plain from invites
          where city_id = ${cityId} and created_by = ${userId} and redeemed_by is null
          order by created_at desc
          limit 12
        `
      : [];

  const lockedKey =
    members.find((member) => member.role === "owner" && member.building_key)?.building_key ??
    members.find((member) => member.building_key)?.building_key ??
    "";

  const messageRows = lockedKey
    ? await sql<{ id: string; user_id: string; author_name: string; body: string; at: unknown }>`
        select id, user_id, author_name, body,
          (extract(epoch from created_at) * 1000)::bigint as at
        from building_messages
        where city_id = ${cityId} and building_key = ${lockedKey}
        order by created_at desc
        limit 40
      `
    : [];

  const buildings: BuildingView[] = members.map((member) => {
    const memberRole: MemberRole = member.role === "owner" ? "owner" : "guest";
    const bots: BotView[] = botRows
      .filter((bot) => bot.owner_user_id === member.user_id)
      .map((bot) => ({
        id: bot.id,
        agentId: bot.agent_id,
        name: bot.name,
        slot: bot.room_slot,
        working: workingNow(bot.status, asNumber(bot.updated_ms)),
        lastFile: bot.last_file,
        color: bot.color,
        code: bot.token_plain,
      }));
    return {
      id: member.user_id,
      house: member.building_name,
      role: memberRole,
      yours: member.user_id === userId,
      key: member.building_key,
      room: member.room_slot,
      bots,
    };
  });

  const events: EventView[] = eventRows
    .filter((row) => row.kind === "start" || row.kind === "stop" || row.kind === "upload")
    .map((row) => ({
      id: row.id,
      botId: row.bot_id,
      botName: row.bot_name,
      kind: row.kind as EventView["kind"],
      filename: row.filename,
      color: row.color,
      at: asNumber(row.at),
    }));

  const invites: InviteView[] = inviteRows.map((row) => ({ id: row.id, code: row.code_plain }));
  const messages: MessageView[] = messageRows
    .map((row) => ({
      id: row.id,
      userId: row.user_id,
      author: row.author_name,
      body: row.body,
      at: asNumber(row.at),
    }))
    .reverse();
  const roster = await loadRoster(sql, userId);

  return { id: city.id, name: city.name, role, buildings, events, messages, invites, roster };
}

export async function listCitiesFor(userId: string): Promise<CitySummary[]> {
  const sql = await getSql();
  const rows = await sql<{ id: string; name: string; role: string; building_name: string }>`
    select c.id, c.name, m.role, m.building_name
    from city_members m
    join cities c on c.id = m.city_id
    where m.user_id = ${userId}
    order by m.joined_at desc
  `;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    role: row.role === "owner" ? "owner" : "guest",
    house: row.building_name,
  }));
}

export async function createCityFor(userId: string, nameRaw: unknown, houseRaw: unknown) {
  const name = cleanLabel(nameRaw, "Project name", 2, 40);
  const house = cleanHouse(houseRaw, "Front house");
  const sql = await getSql();
  const cityId = id();
  await sql`
    with created as (
      insert into cities (id, owner_user_id, name) values (${cityId}, ${userId}, ${name})
      returning id
    )
    insert into city_members (city_id, user_id, role, building_name)
    select id, ${userId}, 'owner', ${house} from created
  `;
  const city = await loadCity(sql, userId, cityId);
  if (!city) return { ok: false as const, error: "Could not open the new project." };
  return { ok: true as const, city };
}

export async function joinCityFor(userId: string, codeRaw: unknown, houseRaw: unknown) {
  if (typeof codeRaw !== "string") return { ok: false as const, error: "Access code is required." };
  const canonical = normalizeInvite(codeRaw);
  if (!canonical) return { ok: false as const, error: "That access code doesn't look right." };
  let house: string;
  try {
    house = cleanHouse(houseRaw, "Side house");
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "House name is invalid." };
  }
  const sql = await getSql();
  const hash = hashSecret(canonical);
  const found = await sql<{ city_id: string; redeemed_by: string | null; reusable: boolean }>`
    select city_id, redeemed_by, coalesce(reusable, false) as reusable
    from invites where code_hash = ${hash}
  `;
  if (!found[0]) return { ok: false as const, error: "That access code doesn't match a project." };
  const cityId = found[0].city_id;
  const already = await sql`
    select 1 as ok from city_members where city_id = ${cityId} and user_id = ${userId}
  `;
  if (already.length) {
    const city = await loadCity(sql, userId, cityId);
    if (!city) return { ok: false as const, error: "Could not open the building." };
    return { ok: true as const, city, reused: true };
  }
  const counts = await sql<{ n: number }>`
    select count(*)::int as n from city_members where city_id = ${cityId}
  `;
  if (asNumber(counts[0]?.n) >= MAX_HOUSES) {
    return { ok: false as const, error: "That project street is full." };
  }
  if (found[0].reusable) {
    await sql`
      insert into city_members (city_id, user_id, role, building_name)
      values (${cityId}, ${userId}, 'guest', ${house})
    `;
  } else if (found[0].redeemed_by) {
    return { ok: false as const, error: "That access code has already been used." };
  } else {
    const claimed = await sql`
      update invites
      set redeemed_by = ${userId}, redeemed_at = now()
      where code_hash = ${hash} and redeemed_by is null
      returning city_id
    `;
    if (!claimed.length) return { ok: false as const, error: "That access code has already been used." };
    await sql`
      insert into city_members (city_id, user_id, role, building_name)
      values (${cityId}, ${userId}, 'guest', ${house})
    `;
  }
  const city = await loadCity(sql, userId, cityId);
  if (!city) return { ok: false as const, error: "Joined, but the project could not be opened." };
  return { ok: true as const, city };
}

export async function getCityFor(userId: string, cityId: string) {
  if (!cityId) return null;
  const sql = await getSql();
  return loadCity(sql, userId, cityId);
}

export async function mintInviteFor(userId: string, cityId: string) {
  const sql = await getSql();
  const owned = await sql`
    select 1 as ok from city_members
    where city_id = ${cityId} and user_id = ${userId} and role = 'owner'
  `;
  if (!owned.length) return { ok: false as const, error: "Only the project owner can make access codes." };
  const counts = await sql<{ n: number }>`
    select count(*)::int as n from city_members where city_id = ${cityId}
  `;
  if (asNumber(counts[0]?.n) >= MAX_HOUSES) {
    return { ok: false as const, error: "This street already has five houses." };
  }
  const open = await sql<{ n: number }>`
    select count(*)::int as n from invites
    where city_id = ${cityId} and redeemed_by is null
  `;
  if (asNumber(open[0]?.n) >= 8) {
    return { ok: false as const, error: "Revoke an unused code before making another." };
  }
  const code = newInviteCode();
  await sql`
    insert into invites (id, city_id, code_hash, code_plain, created_by)
    values (${id()}, ${cityId}, ${hashSecret(code)}, ${code}, ${userId})
  `;
  const city = await loadCity(sql, userId, cityId);
  if (!city) return { ok: false as const, error: "Could not refresh the project." };
  return { ok: true as const, city, code };
}

export async function shareLinkFor(userId: string, cityId: string) {
  if (!cityId) return { ok: false as const, error: "Pick a building first." };
  const sql = await getSql();
  const owned = await sql`
    select 1 as ok from city_members
    where city_id = ${cityId} and user_id = ${userId} and role = 'owner'
  `;
  if (!owned.length) return { ok: false as const, error: "Only you can send this building." };
  const reusable = await sql<{ code_plain: string }>`
    select code_plain from invites
    where city_id = ${cityId} and created_by = ${userId} and reusable = true
    order by created_at asc
    limit 1
  `;
  if (reusable[0]) return { ok: true as const, code: reusable[0].code_plain };
  const open = await sql<{ id: string; code_plain: string }>`
    select id, code_plain from invites
    where city_id = ${cityId} and created_by = ${userId} and redeemed_by is null
    order by created_at asc
    limit 1
  `;
  if (open[0]) {
    await sql`update invites set reusable = true where id = ${open[0].id}`;
    return { ok: true as const, code: open[0].code_plain };
  }
  const code = newInviteCode();
  await sql`
    insert into invites (id, city_id, code_hash, code_plain, created_by, reusable)
    values (${id()}, ${cityId}, ${hashSecret(code)}, ${code}, ${userId}, true)
  `;
  return { ok: true as const, code };
}

export async function revokeInviteFor(userId: string, inviteId: string) {
  const sql = await getSql();
  const rows = await sql<{ city_id: string }>`
    delete from invites
    where id = ${inviteId} and created_by = ${userId} and redeemed_by is null
    returning city_id
  `;
  const cityId = rows[0]?.city_id;
  if (!cityId) return { ok: false as const, error: "That code is already used or not yours." };
  const city = await loadCity(sql, userId, cityId);
  if (!city) return { ok: false as const, error: "Could not refresh the project." };
  return { ok: true as const, city };
}

async function findOwnedBot(sql: Sql, userId: string, botId: string) {
  const rows = await sql<BotRow>`
    select b.id, b.city_id, b.owner_user_id, a.name, b.room_slot, b.status, a.color,
      (extract(epoch from b.updated_at) * 1000)::bigint as updated_ms,
      b.last_file, c.name as city_name
    from bots b
    join agents a on a.id = b.agent_id
    join cities c on c.id = b.city_id
    where b.id = ${botId} and b.owner_user_id = ${userId}
  `;
  const row = rows[0];
  if (!row) return null;
  return { ...row, updated_ms: asNumber(row.updated_ms) };
}

async function placementsForAgent(sql: Sql, agentId: string) {
  const rows = await sql<BotRow>`
    select b.id, b.city_id, b.owner_user_id, a.name, b.room_slot, b.status, a.color,
      (extract(epoch from b.updated_at) * 1000)::bigint as updated_ms,
      b.last_file, c.name as city_name
    from bots b
    join agents a on a.id = b.agent_id
    join cities c on c.id = b.city_id
    where b.agent_id = ${agentId}
  `;
  return rows.map((row) => ({ ...row, updated_ms: asNumber(row.updated_ms) }));
}

async function applyAction(sql: Sql, bot: BotRow & { updated_ms: number }, action: BotAction, filename: string | null) {
  const wasWorking = workingNow(bot.status, bot.updated_ms);
  if (action === "pulse" && wasWorking && Date.now() - bot.updated_ms < 400) {
    return { light: "on" as const, beam: false };
  }
  if (action === "stop") {
    await sql`update bots set status = 'idle', updated_at = now() where id = ${bot.id}`;
    if (wasWorking) {
      await sql`
        insert into city_events (id, city_id, bot_id, bot_name, owner_user_id, kind, filename, color)
        values (${id()}, ${bot.city_id}, ${bot.id}, ${bot.name}, ${bot.owner_user_id}, 'stop', null, ${bot.color})
      `;
    }
    return { light: "off" as const, beam: false };
  }
  const nextFile = action === "upload" ? filename : bot.last_file;
  await sql`
    update bots
    set status = 'working', updated_at = now(), last_file = ${nextFile}
    where id = ${bot.id}
  `;
  const kind = action === "upload" ? "upload" : "start";
  const shouldLog = action === "upload" || !wasWorking;
  if (shouldLog) {
    await sql`
      insert into city_events (id, city_id, bot_id, bot_name, owner_user_id, kind, filename, color)
      values (
        ${id()}, ${bot.city_id}, ${bot.id}, ${bot.name}, ${bot.owner_user_id},
        ${kind}, ${action === "upload" ? filename : null}, ${bot.color}
      )
    `;
  }
  return { light: "on" as const, beam: action === "upload" };
}

function pickSlot(used: Set<number>, slotRaw: unknown) {
  let slot = typeof slotRaw === "number" && slotRaw >= 0 && slotRaw < MAX_ROOMS ? Math.floor(slotRaw) : -1;
  if (slot < 0 || used.has(slot)) {
    slot = -1;
    for (let i = 0; i < MAX_ROOMS; i += 1) {
      if (!used.has(i)) {
        slot = i;
        break;
      }
    }
  }
  return slot;
}

async function seatOwnedAgent(
  sql: Sql,
  userId: string,
  agent: { id: string; name: string; color: string },
  cityId: string,
  slotRaw: unknown,
) {
  const member = await sql`
    select 1 as ok from city_members where city_id = ${cityId} and user_id = ${userId}
  `;
  if (!member.length) return { ok: false as const, error: "You don't have a house on this project." };
  const existing = await sql<{ room_slot: number; agent_id: string }>`
    select room_slot, agent_id from bots where city_id = ${cityId} and owner_user_id = ${userId}
  `;
  if (existing.some((row) => row.agent_id === agent.id)) {
    return { ok: false as const, error: "That bot is already in this house." };
  }
  if (existing.length >= MAX_ROOMS) return { ok: false as const, error: "This house already has six rooms." };
  const slot = pickSlot(new Set(existing.map((row) => row.room_slot)), slotRaw);
  if (slot < 0) return { ok: false as const, error: "This house already has six rooms." };
  await sql`
    insert into bots (id, city_id, owner_user_id, name, room_slot, color, agent_id)
    values (${id()}, ${cityId}, ${userId}, ${agent.name}, ${slot}, ${agent.color}, ${agent.id})
  `;
  const city = await loadCity(sql, userId, cityId);
  if (!city) return { ok: false as const, error: "Could not refresh the project." };
  return { ok: true as const, city };
}

async function findOwnedAgent(sql: Sql, userId: string, agentId: string) {
  const rows = await sql<{ id: string; name: string; color: string; token_plain: string }>`
    select id, name, color, token_plain from agents
    where id = ${agentId} and owner_user_id = ${userId}
  `;
  return rows[0] ?? null;
}

export async function listAgentsFor(userId: string) {
  const sql = await getSql();
  return loadRoster(sql, userId);
}

export async function createAgentFor(userId: string, nameRaw: unknown) {
  let name: string;
  try {
    name = cleanLabel(nameRaw, "Bot name", 2, 24);
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Bot name is invalid." };
  }
  const sql = await getSql();
  const taken = await sql`
    select 1 as ok from agents where owner_user_id = ${userId} and lower(name) = lower(${name})
  `;
  if (taken.length) {
    return { ok: false as const, error: "You already have that bot. Put them in a room instead of making a new one." };
  }
  const count = await sql<{ n: number }>`
    select count(*)::int as n from agents where owner_user_id = ${userId}
  `;
  if (asNumber(count[0]?.n) >= MAX_AGENTS) {
    return { ok: false as const, error: "You already have 24 bots." };
  }
  const code = newBotCode();
  const color = BEAM_COLORS[asNumber(count[0]?.n) % BEAM_COLORS.length] ?? BEAM_COLORS[0];
  await sql`
    insert into agents (id, owner_user_id, name, token_hash, token_plain, color)
    values (${id()}, ${userId}, ${name}, ${hashSecret(code)}, ${code}, ${color})
  `;
  return { ok: true as const, roster: await loadRoster(sql, userId), code };
}

export async function seatAgentFor(userId: string, agentId: string, cityId: string, slotRaw: unknown) {
  if (!agentId || !cityId) return { ok: false as const, error: "Pick a bot and a project." };
  const sql = await getSql();
  const agent = await findOwnedAgent(sql, userId, agentId);
  if (!agent) return { ok: false as const, error: "That bot isn't yours." };
  return seatOwnedAgent(sql, userId, agent, cityId, slotRaw);
}

export async function addBotFor(userId: string, cityId: string, nameRaw: unknown, slotRaw: unknown) {
  let name: string;
  try {
    name = cleanLabel(nameRaw, "Bot name", 2, 24);
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Bot name is invalid." };
  }
  const sql = await getSql();
  const existing = await sql<{ id: string; name: string; color: string }>`
    select id, name, color from agents
    where owner_user_id = ${userId} and lower(name) = lower(${name})
  `;
  const found = existing[0];
  if (found) {
    const seated = await seatOwnedAgent(sql, userId, found, cityId, slotRaw);
    if (!seated.ok) return seated;
    return { ok: true as const, city: seated.city, reused: true as const };
  }
  const count = await sql<{ n: number }>`
    select count(*)::int as n from agents where owner_user_id = ${userId}
  `;
  if (asNumber(count[0]?.n) >= MAX_AGENTS) {
    return { ok: false as const, error: "You already have 24 bots." };
  }
  const code = newBotCode();
  const agent = {
    id: id(),
    name,
    color: BEAM_COLORS[asNumber(count[0]?.n) % BEAM_COLORS.length] ?? BEAM_COLORS[0],
  };
  await sql`
    insert into agents (id, owner_user_id, name, token_hash, token_plain, color)
    values (${agent.id}, ${userId}, ${agent.name}, ${hashSecret(code)}, ${code}, ${agent.color})
  `;
  const seated = await seatOwnedAgent(sql, userId, agent, cityId, slotRaw);
  if (!seated.ok) {
    await sql`delete from agents where id = ${agent.id} and owner_user_id = ${userId}`;
    return seated;
  }
  return { ok: true as const, city: seated.city, code, reused: false as const };
}

export async function userBotActionFor(
  userId: string,
  botId: string,
  actionRaw: unknown,
  filenameRaw: unknown,
) {
  const action = typeof actionRaw === "string" ? actionRaw : "";
  if (action !== "start" && action !== "stop" && action !== "upload") {
    return { ok: false as const, error: "Unsupported action." };
  }
  let filename: string | null = null;
  if (action === "upload") {
    try {
      filename = cleanFilename(filenameRaw);
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : "File name is invalid." };
    }
  }
  const sql = await getSql();
  const bot = await findOwnedBot(sql, userId, botId);
  if (!bot) return { ok: false as const, error: "That room is not yours." };
  await applyAction(sql, bot, action, filename);
  const city = await loadCity(sql, userId, bot.city_id);
  if (!city) return { ok: false as const, error: "Could not refresh the project." };
  return { ok: true as const, city };
}

async function writeNewCode(sql: Sql, userId: string, agentId: string) {
  const code = newBotCode();
  const rows = await sql`
    update agents
    set token_hash = ${hashSecret(code)}, token_plain = ${code}
    where id = ${agentId} and owner_user_id = ${userId}
    returning id
  `;
  return rows.length ? code : null;
}

export async function rotateBotFor(userId: string, botId: string) {
  const sql = await getSql();
  const rows = await sql<{ agent_id: string; city_id: string }>`
    select agent_id, city_id from bots where id = ${botId} and owner_user_id = ${userId}
  `;
  const found = rows[0];
  if (!found) return { ok: false as const, error: "That room is not yours." };
  const code = await writeNewCode(sql, userId, found.agent_id);
  if (!code) return { ok: false as const, error: "That bot isn't yours." };
  const city = await loadCity(sql, userId, found.city_id);
  if (!city) return { ok: false as const, error: "Could not refresh the project." };
  return { ok: true as const, city, code };
}

export async function rotateAgentFor(userId: string, agentId: string, cityId: string) {
  const sql = await getSql();
  const code = await writeNewCode(sql, userId, agentId);
  if (!code) return { ok: false as const, error: "That bot isn't yours." };
  const roster = await loadRoster(sql, userId);
  const city = cityId ? await loadCity(sql, userId, cityId) : null;
  return { ok: true as const, roster, code, city };
}

export async function removeBotFor(userId: string, botId: string) {
  const sql = await getSql();
  const rows = await sql<{ city_id: string }>`
    delete from bots where id = ${botId} and owner_user_id = ${userId} returning city_id
  `;
  const cityId = rows[0]?.city_id;
  if (!cityId) return { ok: false as const, error: "That room is not yours." };
  const city = await loadCity(sql, userId, cityId);
  if (!city) return { ok: false as const, error: "Could not refresh the project." };
  return { ok: true as const, city };
}

export async function deleteAgentFor(userId: string, agentId: string, cityId: string) {
  const sql = await getSql();
  const rows = await sql`
    delete from agents where id = ${agentId} and owner_user_id = ${userId} returning id
  `;
  if (!rows.length) return { ok: false as const, error: "That bot isn't yours." };
  const roster = await loadRoster(sql, userId);
  const city = cityId ? await loadCity(sql, userId, cityId) : null;
  return { ok: true as const, roster, city };
}

export async function evictAllFor(userId: string) {
  const sql = await getSql();
  const owned = await sql<{ id: string }>`
    delete from cities where owner_user_id = ${userId} returning id
  `;
  const guests = await sql<{ city_id: string }>`
    delete from city_members
    where user_id = ${userId} and role = 'guest'
    returning city_id
  `;
  for (const row of guests) {
    await sql`
      delete from bots where city_id = ${row.city_id} and owner_user_id = ${userId}
    `;
  }
  return { ok: true as const, removed: owned.length + guests.length };
}

export async function closeCityFor(userId: string, cityId: string, confirmRaw: unknown) {
  let confirm: string;
  try {
    confirm = cleanLabel(confirmRaw, "Project name", 2, 40);
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Project name is invalid." };
  }
  const sql = await getSql();
  const rows = await sql`
    delete from cities where id = ${cityId} and owner_user_id = ${userId} and name = ${confirm}
    returning id
  `;
  if (!rows.length) return { ok: false as const, error: "Type the project name exactly to close it." };
  return { ok: true as const };
}

export async function leaveCityFor(userId: string, cityId: string) {
  const sql = await getSql();
  const rows = await sql`
    delete from city_members
    where city_id = ${cityId} and user_id = ${userId} and role = 'guest'
    returning city_id
  `;
  if (!rows.length) return { ok: false as const, error: "Owners close the project instead of leaving it." };
  await sql`delete from bots where city_id = ${cityId} and owner_user_id = ${userId}`;
  return { ok: true as const };
}

function projectMatches(cityName: string, cityId: string, project: unknown) {
  if (project == null || project === "") return true;
  if (typeof project !== "string") return false;
  const value = project.trim().toLowerCase();
  if (!value) return true;
  return value === cityName.trim().toLowerCase() || value === cityId.toLowerCase();
}

export async function pulseBot(raw: {
  code?: unknown;
  action?: unknown;
  filename?: unknown;
  project?: unknown;
  body?: unknown;
}) {
  const code = typeof raw.code === "string" ? raw.code.trim() : "";
  if (!/^ll_[A-Za-z0-9_-]{16,80}$/.test(code)) {
    return { ok: false as const, status: 401, error: "Unknown bot code." };
  }
  const actionName = typeof raw.action === "string" ? raw.action.trim().toLowerCase() : "";
  if (!["start", "stop", "upload", "pulse", "say", "inbox"].includes(actionName)) {
    return { ok: false as const, status: 400, error: "Action must be start, stop, upload, pulse, say, or inbox." };
  }
  let filename: string | null = null;
  if (actionName === "upload") {
    try {
      filename = cleanFilename(raw.filename);
    } catch (error) {
      return {
        ok: false as const,
        status: 400,
        error: error instanceof Error ? error.message : "File name is invalid.",
      };
    }
  }
  const sql = await getSql();
  const agents = await sql<{ id: string; name: string }>`
    select id, name from agents where token_hash = ${hashSecret(code)}
  `;
  const agent = agents[0];
  if (!agent) return { ok: false as const, status: 401, error: "Unknown bot code." };
  const placements = (await placementsForAgent(sql, agent.id)).filter((row) =>
    projectMatches(row.city_name, row.city_id, raw.project),
  );
  if (!placements.length) {
    const named = typeof raw.project === "string" && raw.project.trim() !== "";
    return {
      ok: false as const,
      status: named ? 403 : 409,
      error: named
        ? "That bot has no room on that project."
        : "This bot isn't in a room yet.",
    };
  }
  if (actionName === "say" || actionName === "inbox") {
    const placement = placements[0]!;
    const locked = await sql<{ building_key: string }>`
      select building_key from city_members
      where city_id = ${placement.city_id} and building_key is not null
      order by case when role = 'owner' then 0 else 1 end, joined_at asc
      limit 1
    `;
    const key = locked[0]?.building_key;
    if (!key) return { ok: false as const, status: 409, error: "Claim a window before the bot can write." };
    if (actionName === "say") {
      const body = typeof raw.body === "string" ? raw.body.trim().slice(0, 500) : "";
      if (!body) return { ok: false as const, status: 400, error: "Write a message first." };
      await sql`
        insert into building_messages (id, city_id, building_key, user_id, author_name, body)
        values (${id()}, ${placement.city_id}, ${key}, ${placement.owner_user_id}, ${placement.name}, ${body})
      `;
    }
    const thread = await sql<{ id: string; author_name: string; body: string; at: unknown }>`
      select id, author_name, body, (extract(epoch from created_at) * 1000)::bigint as at
      from building_messages
      where city_id = ${placement.city_id} and building_key = ${key}
      order by created_at desc
      limit 40
    `;
    const rooms = placements.map((row) => ({ project: row.city_name, room: row.room_slot + 1 }));
    return {
      ok: true as const,
      status: 200,
      bot: agent.name,
      room: rooms[0]!.room,
      project: rooms[0]!.project,
      rooms,
      light: "off" as const,
      beam: false,
      messages: thread
        .map((row) => ({ id: row.id, author: row.author_name, body: row.body, at: asNumber(row.at) }))
        .reverse(),
    };
  }
  let light: "on" | "off" = "off";
  let beam = false;
  const lightAction: BotAction =
    actionName === "stop" || actionName === "upload" || actionName === "pulse" ? actionName : "start";
  for (const placement of placements) {
    const result = await applyAction(sql, placement, lightAction, filename);
    light = result.light;
    beam = beam || result.beam;
  }
  const rooms = placements.map((row) => ({ project: row.city_name, room: row.room_slot + 1 }));
  return {
    ok: true as const,
    status: 200,
    bot: agent.name,
    room: rooms[0]!.room,
    project: rooms[0]!.project,
    rooms,
    light,
    beam,
  };
}

export async function claimWindowFor(userId: string, keyRaw: unknown, slotRaw: unknown) {
  const key = typeof keyRaw === "string" && /^[\w:.,-]{3,80}$/.test(keyRaw) ? keyRaw : "";
  if (!key) return { ok: false as const, error: "That window is not a room." };
  const slot = Math.max(0, Math.min(11, Math.floor(Number(slotRaw) || 0)));
  const sql = await getSql();
  const taken = await sql<{ user_id: string; city_id: string }>`
    select user_id, city_id from city_members where building_key = ${key}
  `;
  if (taken[0] && taken[0].user_id !== userId) {
    return { ok: false as const, error: "That building is locked. Join it with a code." };
  }
  const mine = await sql<{ city_id: string; building_key: string | null; role: string }>`
    select city_id, building_key, role from city_members
    where user_id = ${userId}
    order by joined_at desc
  `;
  const owned = mine.find((row) => row.role === "owner");
  if (taken[0]?.user_id === userId) {
    await sql`
      update city_members
      set room_slot = ${slot}, building_name = ${"Room " + (slot + 1)}
      where user_id = ${userId} and building_key = ${key}
    `;
    const city = await loadCity(sql, userId, taken[0].city_id);
    if (!city) return { ok: false as const, error: "Could not open your building." };
    return { ok: true as const, city };
  }
  if (owned?.building_key && owned.building_key !== key) {
    return { ok: false as const, error: "Your building is locked. Pick another window on that building." };
  }
  if (!owned && mine.length) {
    return { ok: false as const, error: "You joined with a code. This building stays locked." };
  }
  const label = `Room ${slot + 1}`;
  let cityId = owned?.city_id ?? "";
  if (!cityId) {
    cityId = id();
    await sql`
      with created as (
        insert into cities (id, owner_user_id, name) values (${cityId}, ${userId}, ${"My building"})
        returning id
      )
      insert into city_members (city_id, user_id, role, building_name, building_key, room_slot)
      select id, ${userId}, 'owner', ${label}, ${key}, ${slot} from created
    `;
  } else {
    await sql`
      update city_members
      set building_key = ${key}, room_slot = ${slot}, building_name = ${label}
      where city_id = ${cityId} and user_id = ${userId}
    `;
  }
  const open = await sql`
    select 1 as ok from invites where city_id = ${cityId} and redeemed_by is null
  `;
  if (!open.length) {
    const code = newInviteCode();
    await sql`
      insert into invites (id, city_id, code_hash, code_plain, created_by, reusable)
      values (${id()}, ${cityId}, ${hashSecret(code)}, ${code}, ${userId}, true)
    `;
  }
  const city = await loadCity(sql, userId, cityId);
  if (!city) return { ok: false as const, error: "Could not open your building." };
  return { ok: true as const, city };
}

export async function sendBuildingNoteFor(userId: string, cityIdRaw: unknown, bodyRaw: unknown) {
  const cityId = typeof cityIdRaw === "string" ? cityIdRaw : "";
  const body = typeof bodyRaw === "string" ? bodyRaw.trim().slice(0, 500) : "";
  if (!cityId) return { ok: false as const, error: "Pick a building first." };
  if (!body) return { ok: false as const, error: "Write a message first." };
  const sql = await getSql();
  const member = await sql<{ role: string }>`
    select role from city_members where city_id = ${cityId} and user_id = ${userId}
  `;
  if (!member[0]) return { ok: false as const, error: "You are not on this building." };
  const locked = await sql<{ building_key: string }>`
    select building_key from city_members
    where city_id = ${cityId} and building_key is not null
    order by case when role = 'owner' then 0 else 1 end, joined_at asc
    limit 1
  `;
  const key = locked[0]?.building_key;
  if (!key) return { ok: false as const, error: "Claim a window before you write." };
  const names = await sql<{ name: string | null }>`
    select name from "user" where id = ${userId}
  `;
  const author = (names[0]?.name || "Someone").slice(0, 80);
  await sql`
    insert into building_messages (id, city_id, building_key, user_id, author_name, body)
    values (${id()}, ${cityId}, ${key}, ${userId}, ${author}, ${body})
  `;
  const city = await loadCity(sql, userId, cityId);
  if (!city) return { ok: false as const, error: "Could not load the thread." };
  return { ok: true as const, city };
}
