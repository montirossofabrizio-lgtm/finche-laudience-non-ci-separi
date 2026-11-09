import crypto from "node:crypto";
import { requireSession } from "../../../lib/auth";
import { getSql } from "../../../lib/db";
import { getActionDefinition, getSceneDefinition } from "../../../lib/content";

export const runtime = "nodejs";

function journalText(def, outcome, fallback) {
  if (typeof outcome.journal === "string") return outcome.journal;
  if (typeof def.journal === "string") return def.journal;
  return fallback;
}

async function logInventoryEvent(sql, { session, playerId = session.player_id, itemId, eventType, storyTime, fromLocation = null, toLocation = null, note = "" }) {
  await sql`
    INSERT INTO inventory_events (id, game_id, player_id, item_id, event_type, scene_id, story_time, from_location, to_location, note)
    VALUES (${crypto.randomUUID()}, ${session.game_id}, ${playerId}, ${itemId}, ${eventType}, ${session.current_scene}, ${storyTime}, ${fromLocation}, ${toLocation}, ${note})
  `;
}

async function resolveInventoryOwner(sql, session, ownerRole) {
  if (!ownerRole || ownerRole === session.role) return session.player_id;
  const rows = await sql`
    SELECT id FROM players
    WHERE game_id = ${session.game_id} AND role = ${ownerRole}
    LIMIT 1
  `;
  return rows[0]?.id || null;
}

async function decisionMapForPlayer(sql, gameId, playerId) {
  const rows = await sql`
    SELECT action_id, value FROM decisions
    WHERE game_id = ${gameId} AND player_id = ${playerId}
  `;
  return Object.fromEntries(rows.map((d) => [d.action_id, d.value]));
}

export async function POST(request) {
  try {
    const session = await requireSession(request);
    if (!session) return Response.json({ error: "Sessione non valida" }, { status: 401 });

    const { actionId, option } = await request.json();
    const def = getActionDefinition(session.current_scene, actionId);
    if (!def || !(def.roles || ["CHIARA","LUCIO"]).includes(session.role)) {
      return Response.json({ error: "Azione non disponibile per questo libro" }, { status: 403 });
    }
    const outcome = def.options?.find((o) => o.value === option);
    if (!outcome) return Response.json({ error: "Opzione non valida" }, { status: 400 });

    const sql = getSql();
    const sceneDef = getSceneDefinition(session.current_scene);
    const storyTime = outcome.storyTime || def.storyTime || sceneDef?.time || null;
    const scope = def.scope || "individual";

    if (scope === "shared") {
      const existing = await sql`SELECT value FROM shared_decisions WHERE game_id = ${session.game_id} AND action_id = ${actionId} LIMIT 1`;
      if (existing[0]) return Response.json({ error: "Questa scelta condivisa è già stata salvata" }, { status: 409 });
      await sql`
        INSERT INTO shared_decisions (id, game_id, action_id, value, scene_id, decided_by_player_id)
        VALUES (${crypto.randomUUID()}, ${session.game_id}, ${actionId}, ${option}, ${session.current_scene}, ${session.player_id})
      `;
    } else {
      const existing = await sql`
        SELECT id FROM decisions
        WHERE game_id = ${session.game_id} AND player_id = ${session.player_id} AND action_id = ${actionId}
        LIMIT 1
      `;
      if (existing[0]) return Response.json({ error: "Questa scelta è già stata salvata" }, { status: 409 });
      await sql`
        INSERT INTO decisions (id, game_id, player_id, action_id, value, scene_id)
        VALUES (${crypto.randomUUID()}, ${session.game_id}, ${session.player_id}, ${actionId}, ${option}, ${session.current_scene})
      `;
    }

    let addedItem = null;

    if (outcome.inventory) {
      const item = outcome.inventory;
      const oldRows = await sql`
        SELECT location FROM inventory
        WHERE game_id = ${session.game_id} AND player_id = ${session.player_id} AND item_id = ${item.itemId}
        LIMIT 1
      `;
      const oldLocation = oldRows[0]?.location || null;
      await sql`
        INSERT INTO inventory (id, game_id, player_id, item_id, name, description, location, acquired_scene, updated_scene)
        VALUES (${crypto.randomUUID()}, ${session.game_id}, ${session.player_id}, ${item.itemId}, ${item.name}, ${item.description || ""}, ${item.location}, ${session.current_scene}, ${session.current_scene})
        ON CONFLICT (game_id, player_id, item_id)
        DO UPDATE SET location = EXCLUDED.location, name = EXCLUDED.name, description = EXCLUDED.description, updated_scene = EXCLUDED.updated_scene
      `;
      await logInventoryEvent(sql, {
        session,
        itemId: item.itemId,
        eventType: oldLocation ? "MOVE" : "ACQUIRE",
        storyTime,
        fromLocation: oldLocation,
        toLocation: item.location,
        note: item.eventNote || (oldLocation ? "Posizione aggiornata da una scelta." : "Oggetto entrato nell'inventario.")
      });
      addedItem = item;
    }

    const decisionCache = new Map();

    async function getTargetContext(ownerRole) {
      const playerId = await resolveInventoryOwner(sql, session, ownerRole);
      if (!playerId) return null;
      if (!decisionCache.has(playerId)) {
        decisionCache.set(playerId, await decisionMapForPlayer(sql, session.game_id, playerId));
      }
      return { playerId, decisions: decisionCache.get(playerId) };
    }

    if (outcome.inventoryMoves?.length) {
      for (const move of outcome.inventoryMoves) {
        const ctx = await getTargetContext(move.ownerRole);
        if (!ctx) continue;
        if (move.onlyIfDecision) {
          const [aid, val] = move.onlyIfDecision;
          if (ctx.decisions[aid] !== val) continue;
        }
        const oldRows = await sql`
          SELECT location FROM inventory
          WHERE game_id = ${session.game_id} AND player_id = ${ctx.playerId} AND item_id = ${move.itemId}
          LIMIT 1
        `;
        if (!oldRows[0]) continue;
        const oldLocation = oldRows[0].location;
        if (oldLocation === move.location) continue;
        await sql`
          UPDATE inventory SET location = ${move.location}, updated_scene = ${session.current_scene}
          WHERE game_id = ${session.game_id} AND player_id = ${ctx.playerId} AND item_id = ${move.itemId}
        `;
        await logInventoryEvent(sql, {
          session,
          playerId: ctx.playerId,
          itemId: move.itemId,
          eventType: "MOVE",
          storyTime: move.storyTime || storyTime,
          fromLocation: oldLocation,
          toLocation: move.location,
          note: move.eventNote || "Oggetto spostato con il suo contenitore/stato fisico."
        });
      }
    }

    if (outcome.inventoryRemovals?.length) {
      for (const removal of outcome.inventoryRemovals) {
        const ctx = await getTargetContext(removal.ownerRole);
        if (!ctx) continue;
        if (removal.onlyIfDecision) {
          const [aid, val] = removal.onlyIfDecision;
          if (ctx.decisions[aid] !== val) continue;
        }
        const oldRows = await sql`
          SELECT location FROM inventory
          WHERE game_id = ${session.game_id} AND player_id = ${ctx.playerId} AND item_id = ${removal.itemId}
          LIMIT 1
        `;
        if (!oldRows[0]) continue;
        const oldLocation = oldRows[0].location;
        await logInventoryEvent(sql, {
          session,
          playerId: ctx.playerId,
          itemId: removal.itemId,
          eventType: "REMOVE",
          storyTime: removal.storyTime || storyTime,
          fromLocation: oldLocation,
          toLocation: removal.toLocation || null,
          note: removal.eventNote || "Oggetto consegnato/restituito e rimosso dall'inventario corrente."
        });
        await sql`
          DELETE FROM inventory
          WHERE game_id = ${session.game_id} AND player_id = ${ctx.playerId} AND item_id = ${removal.itemId}
        `;
      }
    }

    const label = outcome.label || option;
    if (def.saveToJournal !== false) {
      const title = def.journalTitle || `SCENA ${sceneDef?.code || session.current_scene} · ${actionId}`;
      const body = journalText(def, outcome, label);
      if (scope === "shared") {
        const players = await sql`SELECT id FROM players WHERE game_id = ${session.game_id}`;
        for (const p of players) {
          await sql`
            INSERT INTO journal_entries (id, game_id, player_id, entry_id, title, body, scene_id, story_time)
            VALUES (${crypto.randomUUID()}, ${session.game_id}, ${p.id}, ${actionId}, ${title}, ${body}, ${session.current_scene}, ${storyTime})
          `;
        }
      } else {
        await sql`
          INSERT INTO journal_entries (id, game_id, player_id, entry_id, title, body, scene_id, story_time)
          VALUES (${crypto.randomUUID()}, ${session.game_id}, ${session.player_id}, ${actionId}, ${title}, ${body}, ${session.current_scene}, ${storyTime})
        `;
      }
    }

    await sql`UPDATE games SET updated_at = now() WHERE id = ${session.game_id}`;
    return Response.json({ ok: true, summary: label, addedItem });
  } catch (error) {
    return Response.json({ error: error.message || "Errore server" }, { status: 500 });
  }
}
