export type MemberRole = "owner" | "guest";

export type CitySummary = {
  id: string;
  name: string;
  role: MemberRole;
  house: string;
};

export type BotView = {
  id: string;
  agentId: string;
  name: string;
  slot: number;
  working: boolean;
  lastFile: string | null;
  color: string;
  code: string | null;
};

export type AgentRoom = {
  cityId: string;
  cityName: string;
  slot: number;
};

export type AgentView = {
  id: string;
  name: string;
  color: string;
  code: string;
  rooms: AgentRoom[];
};

export type BuildingView = {
  id: string;
  house: string;
  role: MemberRole;
  yours: boolean;
  key: string | null;
  room: number | null;
  bots: BotView[];
};

export type EventView = {
  id: string;
  botId: string;
  botName: string;
  kind: "start" | "stop" | "upload";
  filename: string | null;
  color: string;
  at: number;
};

export type MessageView = {
  id: string;
  userId: string;
  author: string;
  body: string;
  at: number;
};

export type CityView = {
  id: string;
  name: string;
  role: MemberRole;
  buildings: BuildingView[];
  events: EventView[];
  messages: MessageView[];
  invites: InviteView[];
  roster: AgentView[];
};

export type SceneRoom = {
  slot: number;
  working: boolean;
  pose: number;
  color: string;
};

export type SceneBuilding = {
  rooms: SceneRoom[];
};

export type SceneBeam = {
  id: string;
  color: string;
  from: number;
  born: number;
};

export type SceneModel = {
  buildings: SceneBuilding[];
  beams: SceneBeam[];
  reduced: boolean;
  selected: { building: number; slot: number } | null;
};
