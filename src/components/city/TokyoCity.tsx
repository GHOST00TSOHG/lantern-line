import { useEffect, useRef, useState } from "react";
import type { SceneModel } from "@/lib/city-types";
import { NightCity } from "@/components/city/NightCity";

type Api = {
  focus: (building: number, slot?: number) => void;
  street: () => void;
  setWork: (jobs: { working: boolean; slot?: number }[]) => void;
  setLines: (people: { key: string }[]) => void;
  destroy: () => void;
};

export type WindowPick = { key: string; slot: number; x: number; y: number; z: number };

export function TokyoCity({
  model,
  houses,
  names,
  onPick,
  onWindow,
}: {
  model: SceneModel;
  houses: string[];
  names: { building: number; slot: number; name: string }[];
  onPick: (building: number, slot: number) => void;
  onWindow?: (pick: WindowPick) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const modelRef = useRef(model);
  const onWindowRef = useRef(onWindow);
  const [mode, setMode] = useState<"tokyo" | "fallback">("tokyo");
  const [note, setNote] = useState("");
  modelRef.current = model;
  onWindowRef.current = onWindow;

  useEffect(() => {
    const node = host.current as (HTMLDivElement & { __onWindow?: (pick: WindowPick) => void }) | null;
    if (!node) return;
    node.__onWindow = (pick: WindowPick) => {
      onWindowRef.current?.(pick);
    };
    const gate = { dead: false };
    let handle: Api | null = null;
    void import("@/tokyo/boot.js")
      .then((mod) => {
        if (gate.dead) return null;
        return mod.mountTokyo(node, gate);
      })
      .then((mounted) => {
        if (!mounted || gate.dead) {
          mounted?.destroy();
          return;
        }
        handle = mounted;
        api.current = mounted;
        const current = modelRef.current;
        mounted.setWork(current.buildings.map((building) => {
          const room = building.rooms.find((item) => item.working);
          return { working: Boolean(room), slot: room?.slot ?? 0 };
        }));
        mounted.setLines(current.buildings.flatMap((building) => (building.key ? [{ key: building.key }] : [])));
      })
      .catch((err) => {
        if (gate.dead) return;
        setMode("fallback");
        setNote(err instanceof Error ? err.message : "The Tokyo city could not open.");
      });
    return () => {
      gate.dead = true;
      handle?.destroy();
      if (api.current === handle) api.current = null;
    };
  }, []);

  useEffect(() => {
    api.current?.setWork(model.buildings.map((building) => {
      const room = building.rooms.find((item) => item.working);
      return { working: Boolean(room), slot: room?.slot ?? 0 };
    }));
  }, [model]);

  useEffect(() => {
    api.current?.setLines(model.buildings.flatMap((building) => (building.key ? [{ key: building.key }] : [])));
  }, [model]);

  useEffect(() => {
    if (!model.selected) return;
    api.current?.focus(model.selected.building, model.selected.slot);
  }, [model.selected]);

  const selectedHouse = model.selected ? model.buildings[model.selected.building] : null;
  const selectedRoom = selectedHouse?.rooms.find((room) => room.slot === model.selected?.slot);
  const workingIndex = model.buildings.findIndex((building) => building.rooms.some((room) => room.working));
  const shownIndex = model.selected?.building ?? (workingIndex >= 0 ? workingIndex : -1);
  const shownHouse = houses[shownIndex] ?? "";
  const shownRoom =
    model.selected && selectedRoom
      ? selectedRoom
      : model.buildings[shownIndex]?.rooms.find((room) => room.working);
  const botName = names.find((entry) => entry.building === shownIndex && entry.slot === shownRoom?.slot)?.name;
  const working = Boolean(shownRoom?.working);

  if (mode === "fallback") {
    return (
      <>
        <NightCity model={model} onPick={onPick} />
        {note ? <p className="absolute bottom-4 left-4 z-20 max-w-sm text-sm text-muted">{note}</p> : null}
      </>
    );
  }

  return (
    <div className="absolute inset-0">
      <div ref={host} className="absolute inset-0" />
      {shownHouse ? (
      <aside
        className={
          "absolute top-20 right-4 z-20 w-56 rounded-xl border bg-panel/90 p-3 backdrop-blur-sm " +
          (working ? "rgb-live" : "border-line")
        }
      >
        <p className="text-xs tracking-wide text-muted">{working ? "Working window" : "Window"}</p>
        <p className="mt-1 font-display text-lg leading-tight">{shownHouse}</p>
        <p className="mt-1 text-sm text-muted">
          {botName ? `${botName}. ` : ""}Click a window to open the room. Click another building to switch.
        </p>
      </aside>
      ) : null}
    </div>
  );
}
