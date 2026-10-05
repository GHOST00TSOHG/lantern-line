import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { projectRoot } from "./with-app-env.mjs";

const root = projectRoot();

async function apply(pg, name) {
  await pg.exec(readFileSync(join(root, "migrations", name), "utf8"));
}

test("account bots keep one code and can sit in more than one project", async () => {
  const pg = new PGlite();
  await apply(pg, "0002_lantern.sql");
  await pg.exec(`
    insert into cities (id, owner_user_id, name) values
      ('c1', 'user', 'Night manuscript'),
      ('c2', 'user', 'Second street');
    insert into city_members (city_id, user_id, role, building_name) values
      ('c1', 'user', 'owner', 'Front house'),
      ('c2', 'user', 'owner', 'Front house');
    insert into bots (
      id, city_id, owner_user_id, name, room_slot, token_hash, token_plain, color
    ) values
      ('b1', 'c1', 'user', 'Scribe', 0, 'hash-1', 'll_one', '#7ef0c3'),
      ('b2', 'c2', 'user', 'Scribe', 1, 'hash-2', 'll_two', '#f0d48a');
  `);
  await apply(pg, "0003_agents.sql");

  const agents = await pg.query("select id, name, token_plain from agents order by created_at, id");
  assert.equal(agents.rows.length, 2);
  assert.equal(agents.rows[0].token_plain, "ll_one");
  assert.notEqual(agents.rows[0].name.toLowerCase(), agents.rows[1].name.toLowerCase());

  const rooms = await pg.query("select id, agent_id, token_plain from bots order by id");
  assert.equal(rooms.rows[0].agent_id, "b1");
  assert.equal(rooms.rows[0].token_plain, null);
  assert.equal(rooms.rows[1].token_plain, null);

  const scribe = agents.rows[0];
  await pg.query(
    `insert into bots (id, city_id, owner_user_id, name, room_slot, color, agent_id)
     values ('b3', 'c2', 'user', $1, 0, '#7ef0c3', $2)`,
    [scribe.name, scribe.id],
  );
  const lit = await pg.query(
    `select c.name as project, b.room_slot
     from agents a
     join bots b on b.agent_id = a.id
     join cities c on c.id = b.city_id
     where a.token_hash = 'hash-1'
     order by c.name`,
  );
  assert.deepEqual(
    lit.rows.map((row) => row.project),
    ["Night manuscript", "Second street"],
  );
});
