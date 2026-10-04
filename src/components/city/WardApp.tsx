import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { UserButton } from "@/lib/auth/gates";
import { signIn } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import type { AgentView, CitySummary, CityView, SceneModel } from "@/lib/city-types";
import {
  addBot,
  botAction,
  closeCity,
  createAgent,
  createCity,
  deleteAgent,
  getCity,
  joinCity,
  leaveCity,
  listAgents,
  listCities,
  mintInvite,
  removeBot,
  revokeInvite,
  rotateAgent,
  rotateBot,
  seatAgent,
  claimWindow,
  sendBuildingNote,
  evictAll,
  shareLink,
} from "@/lib/city.functions";
import { TokyoCity } from "@/components/city/TokyoCity";

const STORAGE_KEY = "lantern-line-city";

type OkCity = { ok: true; city: CityView; code?: string; reused?: boolean };
type Err = { ok: false; error: string };

function sceneFrom(city: CityView | null, beams: SceneModel["beams"], reduced: boolean, selected: SceneModel["selected"]): SceneModel {
  return {
    buildings: (city?.buildings ?? []).map((building) => ({
      rooms: building.bots.map((bot) => ({
        slot: bot.slot,
        working: bot.working,
        pose: bot.slot % 4,
        color: bot.color,
      })),
    })),
    beams,
    reduced,
    selected,
  };
}

function ProviderButtons() {
  const back =
    typeof window === "undefined"
      ? "/"
      : (() => {
          const code = new URLSearchParams(window.location.search).get("with");
          return code ? `/?with=${encodeURIComponent(code)}` : "/";
        })();
  return (
    <button
      type="button"
      className="h-11 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg"
      onClick={() => signIn("grok-x", { callbackURL: back })}
    >
      Authorize GrokBot
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm text-muted">
      {label}
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 rounded-md border border-line bg-ink px-3 text-fg outline-none placeholder:text-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      />
    </label>
  );
}

export function WardApp() {
  const { user, isPending } = useCurrentUserState();
  const [cities, setCities] = useState<CitySummary[]>([]);
  const [roster, setRoster] = useState<AgentView[]>([]);
  const [city, setCity] = useState<CityView | null>(null);
  const [cityId, setCityId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [houseName, setHouseName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [joinHouse, setJoinHouse] = useState("");
  const [note, setNote] = useState("");
  const [botName, setBotName] = useState("");
  const [slotHint, setSlotHint] = useState<number | null>(null);
  const [selected, setSelected] = useState<SceneModel["selected"]>(null);
  const [confirmClose, setConfirmClose] = useState("");
  const [friendLink, setFriendLink] = useState("");
  const [beams, setBeams] = useState<SceneModel["beams"]>([]);
  const [reduced, setReduced] = useState(false);
  const seen = useRef(new Set<string>());
  const armedFor = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fileBot = useRef<string | null>(null);
  const threadRef = useRef<HTMLUListElement>(null);
  const autoJoin = useRef("");

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!user) return;
    let stop = false;
    const saved = localStorage.getItem(STORAGE_KEY);
    void (async () => {
      try {
        const [list, agents] = await Promise.all([listCities(), listAgents()]);
        if (stop) return;
        setCities(list);
        setRoster(agents);
        const next = saved && list.some((item) => item.id === saved) ? saved : (list[0]?.id ?? null);
        if (next) {
          const view = await getCity({ data: { cityId: next } });
          if (stop) return;
          setCityId(next);
          setCity(view);
          localStorage.setItem(STORAGE_KEY, next);
        }
      } catch (err) {
        if (!stop) setError(err instanceof Error ? err.message : "Could not load your projects.");
      } finally {
        if (!stop) setReady(true);
      }
    })();
    return () => {
      stop = true;
    };
  }, [user]);

  useEffect(() => {
    if (!user || !ready) return;
    const code = new URLSearchParams(window.location.search).get("with");
    if (!code || autoJoin.current === code) return;
    autoJoin.current = code;
    const house = "Friend";
    void run(() => joinCity({ data: { code, house } })).then((result) => {
      if (!result?.ok) return;
      const url = new URL(window.location.href);
      url.searchParams.delete("with");
      window.history.replaceState({}, "", `${url.pathname}${url.search}`);
      setNotice("You're in. This is the building.");
    });
  }, [user, ready]);

  useEffect(() => {
    if (!city || city.role !== "owner") {
      setFriendLink("");
      return;
    }
    let stop = false;
    void shareLink({ data: { cityId: city.id } })
      .then((result) => {
        if (stop || !result.ok) return;
        setFriendLink(`${window.location.origin}/?with=${encodeURIComponent(result.code)}`);
      })
      .catch(() => undefined);
    return () => {
      stop = true;
    };
  }, [city]);

  useEffect(() => {
    if (city) setRoster(city.roster);
  }, [city]);

  useEffect(() => {
    const node = threadRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [city?.messages]);

  useEffect(() => {
    if (!cityId || !user) return;
    let stop = false;
    const tick = () => {
      if (document.hidden) return;
      void getCity({ data: { cityId } })
        .then((view) => {
          if (!stop && view) setCity(view);
        })
        .catch(() => undefined);
    };
    const timer = window.setInterval(tick, 2500);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [cityId, user]);

  useEffect(() => {
    if (!city) return;
    if (armedFor.current !== city.id) {
      armedFor.current = city.id;
      for (const event of city.events) seen.current.add(event.id);
      setBeams([]);
      return;
    }
    const fresh: SceneModel["beams"] = [];
    for (const event of city.events) {
      if (seen.current.has(event.id)) continue;
      seen.current.add(event.id);
      if (event.kind !== "upload") continue;
      const from = city.buildings.findIndex((building) => building.bots.some((bot) => bot.id === event.botId));
      if (from < 0) continue;
      fresh.push({ id: event.id, color: event.color, from, born: performance.now() });
    }
    if (fresh.length) setBeams((prev) => [...prev, ...fresh].slice(-8));
  }, [city]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setBeams((prev) => prev.filter((beam) => performance.now() - beam.born < 3200));
    }, 400);
    return () => window.clearInterval(timer);
  }, []);

  const model = useMemo(
    () => sceneFrom(city, beams, reduced, selected),
    [city, beams, reduced, selected],
  );

  const yours = city?.buildings.find((building) => building.yours);
  const seatedIds = new Set(yours?.bots.map((bot) => bot.agentId) ?? []);
  const unseated = roster.filter((agent) => !seatedIds.has(agent.id));

  function remember(next: CityView) {
    const house = next.buildings.find((building) => building.yours)?.house ?? "House";
    setCity(next);
    setCityId(next.id);
    setCities((prev) => {
      const summary = { id: next.id, name: next.name, role: next.role, house };
      const rest = prev.filter((item) => item.id !== next.id);
      return [summary, ...rest];
    });
    localStorage.setItem(STORAGE_KEY, next.id);
    setError("");
  }

  async function run(task: () => Promise<OkCity | Err>) {
    setBusy(true);
    setNotice("");
    try {
      const result = await task();
      if (!result.ok) {
        setError(result.error);
        return result;
      }
      remember(result.city);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      return { ok: false as const, error: "Something went wrong." };
    } finally {
      setBusy(false);
    }
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    await run(() => createCity({ data: { name: projectName, house: houseName } }));
  }

  async function onJoin(event: FormEvent) {
    event.preventDefault();
    await run(() => joinCity({ data: { code: joinCode, house: joinHouse } }));
  }

  async function onEvict() {
    if (!evictArmed) {
      setEvictArmed(true);
      window.setTimeout(() => setEvictArmed(false), 4000);
      return;
    }
    setEvictArmed(false);
    setBusy(true);
    setError("");
    try {
      const result = await evictAll();
      if (!result.ok) {
        setError("Could not evict the projects.");
        return;
      }
      setCities([]);
      setCity(null);
      setCityId(null);
      setSelected(null);
      localStorage.removeItem(STORAGE_KEY);
      setNotice(result.removed ? "Every project is gone." : "No projects to evict.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not evict the projects.");
    } finally {
      setBusy(false);
    }
  }

  async function openProject(id: string) {
    setBusy(true);
    setError("");
    try {
      const view = await getCity({ data: { cityId: id } });
      if (!view) {
        setError("That project is private.");
        return;
      }
      setCity(view);
      setCityId(id);
      localStorage.setItem(STORAGE_KEY, id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open that project.");
    } finally {
      setBusy(false);
    }
  }

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice("Copied.");
      setError("");
    } catch {
      setError("Couldn't copy. Select the code instead.");
    }
  }

  async function onCreateAgent(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const result = await createAgent({ data: { name: botName } });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRoster(result.roster);
      setBotName("");
      setNotice("Bot added. Copy that code into the bot. It works in every project you give them a room.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that bot.");
    } finally {
      setBusy(false);
    }
  }

  async function onRotateAgent(agentId: string) {
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const result = await rotateAgent({ data: { agentId, cityId: city?.id } });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRoster(result.roster);
      if (result.city) setCity(result.city);
      setNotice("New code. The old one no longer works.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not replace that code.");
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteAgent(agentId: string) {
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const result = await deleteAgent({ data: { agentId, cityId: city?.id } });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRoster(result.roster);
      if (result.city) setCity(result.city);
      setNotice("Bot deleted. That code is dead.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete that bot.");
    } finally {
      setBusy(false);
    }
  }

  function onPick(building: number, slot: number) {
    if (!city) return;
    const house = city.buildings[building];
    if (!house) return;
    const bot = house.bots.find((entry) => entry.slot === slot);
    setSelected({ building, slot });
    setOpen(true);
    if (bot) {
      setSlotHint(null);
      window.setTimeout(() => {
        document.getElementById(`bot-${bot.id}`)?.scrollIntoView({ block: "nearest" });
      }, 50);
      return;
    }
    if (house.yours) setSlotHint(slot);
  }

  const subtitle = city ? city.name : "Private rooms on one project";

  return (
    <main className="relative h-dvh overflow-hidden bg-ink text-fg">
      <TokyoCity
        model={model}
        houses={city?.buildings.map((building) => building.house) ?? []}
        names={
          city?.buildings.flatMap((building, index) =>
            building.bots.map((bot) => ({ building: index, slot: bot.slot, name: bot.name })),
          ) ?? []
        }
        onPick={onPick}
        onWindow={(pick) => {
          if (!user) {
            setError("Sign in, then click a window.");
            return;
          }
          void run(() => claimWindow({ data: { key: pick.key, slot: pick.slot } })).then((result) => {
            if (result.ok) setNotice(`Room ${pick.slot + 1} is locked to you.`);
          });
        }}
      />
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-4">
        <div className="pointer-events-auto min-w-0">
          <h1 className="font-display text-xl leading-tight font-medium tracking-tight text-fg">Lantern Line</h1>
          <p className="truncate text-sm text-muted">{subtitle}</p>
        </div>
        <div className="pointer-events-auto flex shrink-0 items-center gap-2 text-fg">
          {user ? (
            <button
              type="button"
              disabled={busy}
              className="h-11 rounded-md bg-red-600 px-3 text-sm font-medium text-white disabled:opacity-50"
              onClick={() => void onEvict()}
            >
              {evictArmed ? "Confirm evict" : "Evict"}
            </button>
          ) : null}
          {isPending ? <div className="size-8 animate-pulse rounded-full bg-panel-2" /> : null}
          {user ? <UserButton /> : null}
        </div>
      </header>

      {!isPending && !user ? (
        <section className="absolute right-4 bottom-4 left-4 z-20 rounded-xl border border-line bg-panel p-4 md:right-auto md:w-80">
          <h2 className="font-display text-lg leading-tight font-medium">Authorize GrokBot</h2>
          <p className="mt-2 mb-4 text-sm text-muted">
            {typeof window !== "undefined" && new URLSearchParams(window.location.search).get("with")
              ? "Your friend sent this building. Authorize GrokBot and it opens."
              : "This opens Grok authorize. The bots on that account can take a room here. The same bot is not created again."}
          </p>
          <ProviderButtons />
        </section>
      ) : null}

      {user ? (
        <aside
          className={
            "absolute bottom-4 left-4 z-20 flex w-[min(100%-2rem,22rem)] flex-col overflow-hidden rounded-xl border border-line bg-panel " +
            (open ? "top-16" : "")
          }
        >
          <div className="flex flex-col gap-3 p-4">
            {(() => {
              const mine = city?.buildings.find((building) => building.yours && building.key);
              const locked = mine ?? city?.buildings.find((building) => building.key);
              if (!locked) {
                return <p className="text-sm">Click a window. That room locks to you.</p>;
              }
              const people = (city?.buildings ?? []).filter((building) => building.id !== locked.id);
              const crew = [...people.map((building) => building.house), ...(locked.bots ?? []).map((bot) => bot.name)];
              return (
                <>
                  <p className="text-sm">
                    {mine
                      ? `Room ${(mine.room ?? 0) + 1} is yours. This building is locked.`
                      : "You're connected to this building."}
                  </p>
                  <p className="text-sm text-muted">
                    {crew.length
                      ? `Write to ${crew.join(", ")}. They see it here.`
                      : "Share the code. Anyone who joins this building can read what you write."}
                  </p>
                  <ul ref={threadRef} className="desk-scroll flex max-h-36 flex-col gap-2 overflow-y-auto">
                    {(city?.messages.length ?? 0) === 0 ? <li className="text-sm text-muted">No messages yet.</li> : null}
                    {city?.messages.map((message) => (
                      <li key={message.id}>
                        <p className="text-xs text-muted">{message.userId === user?.id ? "You" : message.author}</p>
                        <p className="text-sm break-words">{message.body}</p>
                      </li>
                    ))}
                  </ul>
                  <form
                    className="flex gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const body = note.trim();
                      if (!body || !city) return;
                      void run(() => sendBuildingNote({ data: { cityId: city.id, body } })).then((result) => {
                        if (result?.ok) setNote("");
                      });
                    }}
                  >
                    <input
                      value={note}
                      placeholder="Message the building"
                      onChange={(event) => setNote(event.target.value)}
                      className="h-11 min-w-0 flex-1 rounded-md border border-line bg-ink px-3 text-sm text-fg outline-none placeholder:text-subtle"
                    />
                    <button type="submit" disabled={busy || !note.trim()} className="h-11 rounded-md bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-50">
                      Send
                    </button>
                  </form>
                </>
              );
            })()}
            {city?.role === "owner" && friendLink ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-muted">Send this. He opens it with Grok and the building is there.</p>
                <p className="font-mono text-xs break-all text-fg">{friendLink}</p>
                <button
                  type="button"
                  className="h-11 rounded-md bg-accent text-sm font-medium text-accent-fg"
                  onClick={() => void copyText(friendLink)}
                >
                  Copy link
                </button>
              </div>
            ) : null}
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void run(() => joinCity({ data: { code: joinCode, house: "Guest" } }));
              }}
            >
              <input
                value={joinCode}
                placeholder="Join with a code"
                onChange={(event) => setJoinCode(event.target.value)}
                className="h-11 min-w-0 flex-1 rounded-md border border-line bg-ink px-3 text-sm text-fg outline-none placeholder:text-subtle"
              />
              <button type="submit" disabled={busy} className="h-11 rounded-md bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-50">
                Join
              </button>
            </form>
            {error ? <p className="text-sm text-fg">{error}</p> : null}
            {notice ? <p className="text-sm text-muted">{notice}</p> : null}
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Your bots</p>
              {roster.length === 0 ? (
                <p className="text-sm text-muted">None on this account yet. Add one under More. It stays yours.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {roster.map((agent) => {
                    const seated = seatedIds.has(agent.id);
                    return (
                      <li key={agent.id} className="flex items-center gap-2">
                        <span className="size-2 shrink-0 rounded-full" style={{ background: agent.color }} />
                        <span className="min-w-0 flex-1 truncate text-sm">{agent.name}</span>
                        {city && yours && !seated ? (
                          <button
                            type="button"
                            disabled={busy}
                            className="h-11 shrink-0 rounded-md border border-line px-3 text-sm disabled:opacity-50"
                            onClick={() =>
                              void run(() =>
                                seatAgent({
                                  data: { agentId: agent.id, cityId: city.id, slot: yours.room ?? 0 },
                                }),
                              )
                            }
                          >
                            This room
                          </button>
                        ) : (
                          <span className="text-xs text-muted">{seated ? "In this room" : "Pick a window"}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <button type="button" className="h-11 text-left text-sm text-muted" onClick={() => setOpen((value) => !value)}>
              {open ? "Hide the rest" : "More"}
            </button>
          </div>
          {open ? (
          <div className="desk-scroll flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4">
            {!ready ? <p className="text-sm text-muted">Loading your street…</p> : null}
            {error ? <p className="text-sm text-fg">{error}</p> : null}
            {notice ? <p className="text-sm text-muted">{notice}</p> : null}

            {ready && !city ? (
              <>
                <section className="flex flex-col gap-3">
                  <h2 className="text-sm font-medium">Your bots</h2>
                  <p className="text-sm text-muted">
                    A bot stays on your account. Give them a room in any project. The same code keeps working.
                  </p>
                  {roster.length === 0 ? <p className="text-sm text-muted">No bots yet.</p> : null}
                  <ul className="flex flex-col gap-3">
                    {roster.map((agent) => (
                      <li key={agent.id} className="rounded-lg border border-line px-3 py-3">
                        <div className="flex items-center gap-2">
                          <span className="size-2 shrink-0 rounded-full" style={{ background: agent.color }} />
                          <p className="min-w-0 flex-1 truncate text-sm font-medium">{agent.name}</p>
                        </div>
                        <p className="mt-2 font-mono text-xs break-all text-muted">{agent.code}</p>
                        <p className="mt-1 text-sm text-muted">
                          {agent.rooms.length === 0
                            ? "Not in a room yet."
                            : agent.rooms.map((room) => `${room.cityName} · room ${room.slot + 1}`).join(", ")}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button type="button" className="h-11 rounded-md border border-line px-3 text-sm" onClick={() => void copyText(agent.code)}>
                            Copy code
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            className="h-11 rounded-md px-3 text-sm text-muted disabled:opacity-50"
                            onClick={() => void onRotateAgent(agent.id)}
                          >
                            New code
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            className="h-11 rounded-md px-3 text-sm text-muted disabled:opacity-50"
                            onClick={() => void onDeleteAgent(agent.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <form className="flex flex-col gap-3" onSubmit={(event) => void onCreateAgent(event)}>
                    <Field label="Bot name" value={botName} onChange={setBotName} placeholder="Scribe" />
                    <button type="submit" disabled={busy} className="h-11 rounded-md bg-accent text-sm font-medium text-accent-fg disabled:opacity-50">
                      Add this bot
                    </button>
                  </form>
                </section>
                {cities.length ? (
                  <section className="flex flex-col gap-2">
                    <h2 className="text-sm font-medium text-muted">Your projects</h2>
                    {cities.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        disabled={busy}
                        onClick={() => void openProject(item.id)}
                        className="h-11 rounded-md border border-line px-3 text-left text-sm"
                      >
                        {item.name}
                        <span className="text-muted"> · {item.house}</span>
                      </button>
                    ))}
                  </section>
                ) : (
                  <p className="text-sm text-muted">No project yet. Service lines stay dark until a bot is working.</p>
                )}
                <form className="flex flex-col gap-3" onSubmit={(event) => void onCreate(event)}>
                  <h2 className="text-sm font-medium">New project</h2>
                  <Field label="Project name" value={projectName} onChange={setProjectName} placeholder="Night manuscript" />
                  <Field label="Your house" value={houseName} onChange={setHouseName} placeholder="Front house" />
                  <button type="submit" disabled={busy} className="h-11 rounded-md bg-accent text-sm font-medium text-accent-fg disabled:opacity-50">
                    Create project
                  </button>
                </form>
                <form className="flex flex-col gap-3" onSubmit={(event) => void onJoin(event)}>
                  <h2 className="text-sm font-medium">Join with an access code</h2>
                  <p className="text-sm text-muted">A code opens one project and gives you the next house. It cannot enter a different project.</p>
                  <Field label="Access code" value={joinCode} onChange={setJoinCode} placeholder="line-••••-••••" />
                  <Field label="Your house" value={joinHouse} onChange={setJoinHouse} placeholder="Side house" />
                  <button type="submit" disabled={busy} className="h-11 rounded-md border border-line text-sm font-medium disabled:opacity-50">
                    Join project
                  </button>
                </form>
              </>
            ) : null}

            {city && yours ? (
              <>
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-display text-lg leading-tight font-medium">{yours.house}</h2>
                  <button
                    type="button"
                    className="h-11 shrink-0 rounded-md px-2 text-sm text-muted"
                    onClick={() => {
                      setCity(null);
                      setCityId(null);
                      localStorage.removeItem(STORAGE_KEY);
                    }}
                  >
                    All projects
                  </button>
                </div>
                <p className="text-sm text-muted">
                  Click a bot to fly to its window. The same bot can take a room in every project. While it works, the line into that building runs RGB. The line goes dark after five quiet seconds.
                </p>
                <ul className="flex flex-col gap-3">
                  {yours.bots.map((bot) => (
                    <li
                      key={bot.id}
                      id={`bot-${bot.id}`}
                      onClick={() => {
                        const index = city.buildings.findIndex((building) => building.yours);
                        if (index >= 0) setSelected({ building: index, slot: bot.slot });
                      }}
                      className={
                        "rounded-lg border px-3 py-3 " +
                        (selected && city.buildings[selected.building]?.yours && city.buildings[selected.building]?.bots.find((entry) => entry.slot === selected.slot)?.id === bot.id
                          ? "border-fg bg-panel-2"
                          : "border-line")
                      }
                    >
                      <div className="flex items-center gap-2">
                        <span className="size-2 shrink-0 rounded-full" style={{ background: bot.color }} />
                        <p className="min-w-0 flex-1 truncate text-sm font-medium">{bot.name}</p>
                        <p className="text-sm text-muted">{bot.working ? "Working" : "Dark"}</p>
                      </div>
                      <p className="mt-1 text-sm text-muted">Room {bot.slot + 1}{bot.lastFile ? ` · ${bot.lastFile}` : ""}</p>
                      {bot.code ? (
                        <p className="mt-2 font-mono text-xs break-all text-muted">{bot.code}</p>
                      ) : null}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          className="h-11 rounded-md bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-50"
                          onClick={() => void run(() => botAction({ data: { botId: bot.id, action: bot.working ? "stop" : "start" } }))}
                        >
                          {bot.working ? "Rest" : "Work"}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          className="h-11 rounded-md border border-line px-3 text-sm disabled:opacity-50"
                          onClick={() => {
                            fileBot.current = bot.id;
                            fileRef.current?.click();
                          }}
                        >
                          Send file
                        </button>
                        {bot.code ? (
                          <button type="button" className="h-11 rounded-md border border-line px-3 text-sm" onClick={() => void copyText(bot.code ?? "")}>
                            Copy code
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={busy}
                          className="h-11 rounded-md px-3 text-sm text-muted disabled:opacity-50"
                          onClick={() => void run(() => rotateBot({ data: { botId: bot.id } }))}
                        >
                          New code
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          className="h-11 rounded-md px-3 text-sm text-muted disabled:opacity-50"
                          onClick={() => void run(() => removeBot({ data: { botId: bot.id } }))}
                        >
                          Out of room
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                {unseated.length > 0 ? (
                  <section className="flex flex-col gap-3">
                    <h2 className="text-sm font-medium">Your other bots</h2>
                    <p className="text-sm text-muted">
                      Same code. They can keep rooms on other projects. Delete removes the bot everywhere.
                    </p>
                    <ul className="flex flex-col gap-3">
                      {unseated.map((agent) => (
                        <li key={agent.id} className="rounded-lg border border-line px-3 py-3">
                          <div className="flex items-center gap-2">
                            <span className="size-2 shrink-0 rounded-full" style={{ background: agent.color }} />
                            <p className="min-w-0 flex-1 truncate text-sm font-medium">{agent.name}</p>
                          </div>
                          <p className="mt-2 font-mono text-xs break-all text-muted">{agent.code}</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={busy || yours.bots.length >= 6}
                              className="h-11 rounded-md bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-50"
                              onClick={() =>
                                void run(() =>
                                  seatAgent({ data: { agentId: agent.id, cityId: city.id, slot: slotHint ?? undefined } }),
                                ).then((result) => {
                                  if (result.ok) setSlotHint(null);
                                })
                              }
                            >
                              {yours.bots.length >= 6
                                ? "House is full"
                                : slotHint == null
                                  ? "Give them a room"
                                  : `Room ${slotHint + 1}`}
                            </button>
                            <button type="button" className="h-11 rounded-md border border-line px-3 text-sm" onClick={() => void copyText(agent.code)}>
                              Copy code
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              className="h-11 rounded-md px-3 text-sm text-muted disabled:opacity-50"
                              onClick={() => void onDeleteAgent(agent.id)}
                            >
                              Delete
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                {yours.bots.length < 6 ? (
                  <form
                    className="flex flex-col gap-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void run(() => addBot({ data: { cityId: city.id, name: botName, slot: slotHint ?? undefined } })).then((result) => {
                        if (!result.ok) return;
                        setBotName("");
                        setSlotHint(null);
                        if ("reused" in result && result.reused) {
                          setNotice("Same bot, same code. They're in this room too.");
                        }
                      });
                    }}
                  >
                    <h2 className="text-sm font-medium">
                      {slotHint == null ? "New bot" : `New bot in room ${slotHint + 1}`}
                    </h2>
                    <p className="text-sm text-muted">
                      A name you already use takes this room and keeps its code.
                    </p>
                    <Field label="Bot name" value={botName} onChange={setBotName} placeholder="Scribe" />
                    <button type="submit" disabled={busy} className="h-11 rounded-md bg-accent text-sm font-medium text-accent-fg disabled:opacity-50">
                      Give them a room
                    </button>
                  </form>
                ) : unseated.length === 0 ? (
                  <p className="text-sm text-muted">All six rooms in this house are taken.</p>
                ) : null}
                <input
                  ref={fileRef}
                  type="file"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    const botId = fileBot.current;
                    event.target.value = "";
                    if (!file || !botId) return;
                    void run(() => botAction({ data: { botId, action: "upload", filename: file.name } }));
                  }}
                />

                {city.role === "owner" ? (
                  <section className="flex flex-col gap-3">
                    <h2 className="text-sm font-medium">Invite to this project</h2>
                    <p className="text-sm text-muted">
                      Each code is single use. It only adds a house to {city.name}.
                    </p>
                    <button
                      type="button"
                      disabled={busy}
                      className="h-11 rounded-md border border-line text-sm font-medium disabled:opacity-50"
                      onClick={() => void run(() => mintInvite({ data: { cityId: city.id } }))}
                    >
                      Make an access code
                    </button>
                    <ul className="flex flex-col gap-2">
                      {city.invites.map((invite) => (
                        <li key={invite.id} className="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-2">
                          <span className="font-mono text-xs break-all">{invite.code}</span>
                          <span className="flex shrink-0 gap-1">
                            <button type="button" className="h-11 px-2 text-sm" onClick={() => void copyText(invite.code)}>
                              Copy
                            </button>
                            <button
                              type="button"
                              className="h-11 px-2 text-sm text-muted"
                              onClick={() => void run(() => revokeInvite({ data: { inviteId: invite.id } }))}
                            >
                              Revoke
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                <section className="flex flex-col gap-2">
                  <h2 className="text-sm font-medium">Outside call</h2>
                  <p className="text-sm text-muted">
                    A Grok bot uses its own code. say posts on this building. inbox reads the thread. Name a project to pick the room.
                  </p>
                  <pre className="overflow-x-auto rounded-md border border-line bg-ink p-3 font-mono text-xs leading-relaxed text-muted">
{`POST /api/bot
{"code":"${yours.bots[0]?.code ?? "ll_…"}","action":"say","body":"On my way.","project":"${city.name}"}`}
                  </pre>
                </section>

                <section className="flex flex-col gap-2">
                  <h2 className="text-sm font-medium">The street</h2>
                  {city.buildings.filter((building) => !building.yours).length === 0 ? (
                    <p className="text-sm text-muted">No other houses yet.</p>
                  ) : (
                    city.buildings
                      .filter((building) => !building.yours)
                      .map((building) => (
                        <div key={building.id} className="rounded-md border border-line px-3 py-2">
                          <p className="text-sm font-medium">{building.house}</p>
                          {building.bots.length === 0 ? <p className="text-sm text-muted">No bots yet.</p> : null}
                          {building.bots.map((bot) => (
                            <button
                              key={bot.id}
                              type="button"
                              className="mt-1 block h-11 w-full rounded-md px-2 text-left text-sm text-muted"
                              onClick={() => setSelected({ building: city.buildings.indexOf(building), slot: bot.slot })}
                            >
                              {bot.name} · {bot.working ? "Working" : "Dark"}
                              {bot.lastFile ? ` · ${bot.lastFile}` : ""}
                            </button>
                          ))}
                        </div>
                      ))
                  )}
                </section>

                <section className="flex flex-col gap-2">
                  <h2 className="text-sm font-medium">Recent work</h2>
                  {city.events.length === 0 ? <p className="text-sm text-muted">Nothing filed yet.</p> : null}
                  <ul className="flex flex-col gap-1">
                    {city.events.map((event) => (
                      <li key={event.id} className="text-sm text-muted">
                        {event.botName}{" "}
                        {event.kind === "upload" ? `sent ${event.filename ?? "a file"}` : event.kind === "start" ? "started" : "rested"}
                      </li>
                    ))}
                  </ul>
                </section>

                {city.role === "owner" ? (
                  <form
                    className="flex flex-col gap-3 border-t border-line pt-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      setBusy(true);
                      void closeCity({ data: { cityId: city.id, name: confirmClose } })
                        .then((result) => {
                          if (!result.ok) {
                            setError(result.error);
                            return;
                          }
                          setCity(null);
                          setCityId(null);
                          setCities((prev) => prev.filter((item) => item.id !== city.id));
                          localStorage.removeItem(STORAGE_KEY);
                          setConfirmClose("");
                          setError("");
                        })
                        .catch((err) => setError(err instanceof Error ? err.message : "Could not close the project."))
                        .finally(() => setBusy(false));
                    }}
                  >
                    <h2 className="text-sm font-medium">Close project</h2>
                    <Field label="Type the project name" value={confirmClose} onChange={setConfirmClose} placeholder={city.name} />
                    <button type="submit" disabled={busy} className="h-11 rounded-md border border-line text-sm text-muted disabled:opacity-50">
                      Close {city.name}
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    className="h-11 rounded-md border border-line text-sm text-muted disabled:opacity-50"
                    onClick={() => {
                      setBusy(true);
                      void leaveCity({ data: { cityId: city.id } })
                        .then((result) => {
                          if (!result.ok) {
                            setError(result.error);
                            return;
                          }
                          setCities((prev) => prev.filter((item) => item.id !== city.id));
                          setCity(null);
                          setCityId(null);
                          localStorage.removeItem(STORAGE_KEY);
                        })
                        .catch((err) => setError(err instanceof Error ? err.message : "Could not leave."))
                        .finally(() => setBusy(false));
                    }}
                  >
                    Leave this project
                  </button>
                )}
              </>
            ) : null}
          </div>
          ) : null}
        </aside>
      ) : null}
    </main>
  );
}
