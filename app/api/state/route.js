import { requireSession } from "../../../lib/auth";
import { getSql } from "../../../lib/db";
import { getSceneView, routeForScene } from "../../../lib/content";

export const runtime = "nodejs";

export async function GET(request) {
  try {
    const session = await requireSession(request);
    if (!session) return Response.json({ error: "Sessione non valida" }, { status: 401 });

    const sql = getSql();
    const [ownDecisions, allDecisions, shared, inventory, inventoryEvents, journal, players, sceneRows] = await Promise.all([
      sql`SELECT action_id, value, scene_id, created_at FROM decisions WHERE game_id = ${session.game_id} AND player_id = ${session.player_id}`,
      sql`SELECT p.role, d.action_id, d.value, d.scene_id, d.created_at FROM decisions d JOIN players p ON p.id = d.player_id WHERE d.game_id = ${session.game_id}`,
      sql`SELECT action_id, value, scene_id, created_at FROM shared_decisions WHERE game_id = ${session.game_id}`,
      sql`SELECT item_id, name, description, location, acquired_scene, updated_scene, acquired_at FROM inventory WHERE game_id = ${session.game_id} AND player_id = ${session.player_id} ORDER BY acquired_at DESC`,
      sql`SELECT item_id, event_type, scene_id, story_time, from_location, to_location, note, created_at FROM inventory_events WHERE game_id = ${session.game_id} AND player_id = ${session.player_id} ORDER BY created_at ASC`,
      sql`SELECT title, body, scene_id, story_time, created_at FROM journal_entries WHERE game_id = ${session.game_id} AND player_id = ${session.player_id} ORDER BY created_at DESC LIMIT 150`,
      sql`SELECT role, current_scene, joined_at FROM players WHERE game_id = ${session.game_id} ORDER BY joined_at`,
      sql`SELECT title, body FROM scene_content WHERE scene_id = ${session.current_scene} AND role = ${session.role} AND published = true LIMIT 1`
    ]);

    const ownMap = Object.fromEntries(ownDecisions.map((d) => [d.action_id, d.value]));
    const sharedMap = Object.fromEntries(shared.map((d) => [d.action_id, d.value]));
    const byRole = { CHIARA: {}, LUCIO: {} };
    for (const d of allDecisions) byRole[d.role][d.action_id] = d.value;

    const contentOverride = sceneRows[0] || null;
    const scene = getSceneView(session.current_scene, session.role, ownMap, sharedMap, byRole, contentOverride);
    if (!scene) return Response.json({ error: `Scena ${session.current_scene} non configurata` }, { status: 500 });

    const route = routeForScene(session.current_scene, byRole, sharedMap);
    const routeView = {
      canAdvance: Boolean(route?.next) && scene.unresolvedChoiceCount === 0 && !scene.waitingForPartnerChoice,
      waitingForPartner: Boolean(route?.waitingForPartner) || Boolean(scene.waitingForPartnerChoice),
      blocked: Boolean(route?.blocked) || (scene.unresolvedChoiceCount > 0 && !route?.waitingForPartner) || Boolean(scene.waitingForPartnerChoice),
      locked: Boolean(route?.locked),
      message: scene.waitingForPartnerChoice
        ? "Aspetta che anche l’altro libro registri la propria scelta."
        : (scene.unresolvedChoiceCount > 0
          ? "Prima completa la scelta che hai davanti."
          : (route?.message || null))
    };

    const itemHistory = {};
    for (const event of inventoryEvents) {
      (itemHistory[event.item_id] ||= []).push(event);
    }

    return Response.json({
      game: {
        code: session.code,
        partnerConnected: players.length >= 2,
        updatedAt: session.updated_at,
        players: players.map((p) => ({ role: p.role, currentScene: p.current_scene }))
      },
      player: { role: session.role, currentScene: session.current_scene },
      scene,
      route: routeView,
      inventory: inventory.map((i) => ({ ...i, history: itemHistory[i.item_id] || [] })),
      journal
    });
  } catch (error) {
    return Response.json({ error: error.message || "Errore server" }, { status: 500 });
  }
}
