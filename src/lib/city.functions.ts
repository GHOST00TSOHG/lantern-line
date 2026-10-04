import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { AgentView, CitySummary, CityView } from "@/lib/city-types";

function cityIdOf(input: unknown) {
  if (!input || typeof input !== "object" || !("cityId" in input)) return "";
  const cityId = (input as { cityId?: unknown }).cityId;
  return typeof cityId === "string" ? cityId : "";
}

export const listCities = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<CitySummary[]> => {
    const { listCitiesFor } = await import("./city.server");
    return listCitiesFor(context.userId);
  });

export const createCity = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { name?: string; house?: string }) => input)
  .handler(async ({ context, data }) => {
    const { createCityFor } = await import("./city.server");
    return createCityFor(context.userId, data.name, data.house);
  });

export const joinCity = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code?: string; house?: string }) => input)
  .handler(async ({ context, data }) => {
    const { joinCityFor } = await import("./city.server");
    return joinCityFor(context.userId, data.code, data.house);
  });

export const getCity = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { cityId?: string }) => input)
  .handler(async ({ context, data }): Promise<CityView | null> => {
    const { getCityFor } = await import("./city.server");
    return getCityFor(context.userId, cityIdOf(data));
  });

export const shareLink = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { cityId?: string }) => input)
  .handler(async ({ context, data }) => {
    const { shareLinkFor } = await import("./city.server");
    return shareLinkFor(context.userId, cityIdOf(data));
  });

export const mintInvite = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { cityId?: string }) => input)
  .handler(async ({ context, data }) => {
    const { mintInviteFor } = await import("./city.server");
    return mintInviteFor(context.userId, cityIdOf(data));
  });

export const revokeInvite = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { inviteId?: string }) => input)
  .handler(async ({ context, data }) => {
    const inviteId = typeof data.inviteId === "string" ? data.inviteId : "";
    const { revokeInviteFor } = await import("./city.server");
    return revokeInviteFor(context.userId, inviteId);
  });

export const listAgents = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<AgentView[]> => {
    const { listAgentsFor } = await import("./city.server");
    return listAgentsFor(context.userId);
  });

export const createAgent = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { name?: string }) => input)
  .handler(async ({ context, data }) => {
    const { createAgentFor } = await import("./city.server");
    return createAgentFor(context.userId, data.name);
  });

export const seatAgent = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { agentId?: string; cityId?: string; slot?: number }) => input)
  .handler(async ({ context, data }) => {
    const agentId = typeof data.agentId === "string" ? data.agentId : "";
    const { seatAgentFor } = await import("./city.server");
    return seatAgentFor(context.userId, agentId, cityIdOf(data), data.slot);
  });

export const rotateAgent = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { agentId?: string; cityId?: string }) => input)
  .handler(async ({ context, data }) => {
    const agentId = typeof data.agentId === "string" ? data.agentId : "";
    const { rotateAgentFor } = await import("./city.server");
    return rotateAgentFor(context.userId, agentId, cityIdOf(data));
  });

export const deleteAgent = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { agentId?: string; cityId?: string }) => input)
  .handler(async ({ context, data }) => {
    const agentId = typeof data.agentId === "string" ? data.agentId : "";
    const { deleteAgentFor } = await import("./city.server");
    return deleteAgentFor(context.userId, agentId, cityIdOf(data));
  });

export const addBot = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { cityId?: string; name?: string; slot?: number }) => input)
  .handler(async ({ context, data }) => {
    const { addBotFor } = await import("./city.server");
    return addBotFor(context.userId, cityIdOf(data), data.name, data.slot);
  });

export const botAction = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { botId?: string; action?: string; filename?: string }) => input)
  .handler(async ({ context, data }) => {
    const botId = typeof data.botId === "string" ? data.botId : "";
    const { userBotActionFor } = await import("./city.server");
    return userBotActionFor(context.userId, botId, data.action, data.filename);
  });

export const rotateBot = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { botId?: string }) => input)
  .handler(async ({ context, data }) => {
    const botId = typeof data.botId === "string" ? data.botId : "";
    const { rotateBotFor } = await import("./city.server");
    return rotateBotFor(context.userId, botId);
  });

export const removeBot = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { botId?: string }) => input)
  .handler(async ({ context, data }) => {
    const botId = typeof data.botId === "string" ? data.botId : "";
    const { removeBotFor } = await import("./city.server");
    return removeBotFor(context.userId, botId);
  });

export const claimWindow = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { key?: string; slot?: number }) => input)
  .handler(async ({ context, data }) => {
    const { claimWindowFor } = await import("./city.server");
    return claimWindowFor(context.userId, data.key, data.slot);
  });

export const sendBuildingNote = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { cityId?: string; body?: string }) => input)
  .handler(async ({ context, data }) => {
    const { sendBuildingNoteFor } = await import("./city.server");
    return sendBuildingNoteFor(context.userId, data.cityId, data.body);
  });

export const evictAll = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { evictAllFor } = await import("./city.server");
    return evictAllFor(context.userId);
  });

export const closeCity = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { cityId?: string; name?: string }) => input)
  .handler(async ({ context, data }) => {
    const { closeCityFor } = await import("./city.server");
    return closeCityFor(context.userId, cityIdOf(data), data.name);
  });

export const leaveCity = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { cityId?: string }) => input)
  .handler(async ({ context, data }) => {
    const { leaveCityFor } = await import("./city.server");
    return leaveCityFor(context.userId, cityIdOf(data));
  });
