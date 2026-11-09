import crypto from "node:crypto";
import { requireSession } from "../../../lib/auth";
import { getSql } from "../../../lib/db";
import { getSceneView, routeForScene } from "../../../lib/content";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const session = await requireSession(request);
    if (!session) return Response.json({ error: "Sessione non valida" }, { status: 401 });
    const sql = getSql();

    const [allDecisions, shared, sceneRows] = await Promise.all([
      sql`SELECT p.role, d.action_id, d.value FROM decisions d JOIN players p ON p.id = d.player_id WHERE d.game_id = ${session.game_id}`,
      sql`SELECT action_id, value FROM shared_decisions WHERE game_id = ${session.game_id}`,
      sql`SELECT title, body FROM scene_content WHERE scene_id = ${session.current_scene} AND role = ${session.role} AND published = true LIMIT 1`
    ]);
    const byRole = { CHIARA: {}, LUCIO: {} };
    for (const d of allDecisions) byRole[d.role][d.action_id] = d.value;
    const sharedMap = Object.fromEntries(shared.map((d) => [d.action_id, d.value]));

    const sceneView = getSceneView(session.current_scene, session.role, byRole[session.role], sharedMap, byRole, sceneRows[0] || null);
    if ((sceneView?.unresolvedChoiceCount || 0) > 0) {
      return Response.json({ error: "Prima completa la scelta che hai davanti." }, { status: 409 });
    }

    // Blocca l'avanzamento anche quando il BODY è fermo su un [[WAIT:...]].
    // È una guardia server-side: protegge da stato client obsoleto, race di rete
    // o chiamate dirette all'endpoint /api/advance.
    if (sceneView?.waitingForPartnerChoice) {
      return Response.json(
        { error: "Aspetta che anche l'altro libro registri la propria scelta." },
        { status: 409 }
      );
    }

    const route = routeForScene(session.current_scene, byRole, sharedMap);
    if (route?.waitingForPartner) return Response.json({ error: "Aspetta che anche l'altro libro completi la scelta." }, { status: 409 });
    if (route?.blocked) return Response.json({ error: route.message || "Prima completate la scelta della scena." }, { status: 409 });
    if (!route?.next) return Response.json({ error: "La scena successiva non è ancora caricata." }, { status: 409 });

    // Passive physical continuity: by the opening of S12 Lucio's wedding jacket is in Room 412.
    // If the cigar was conserved, the tube is still inside that jacket.
    if (
      session.current_scene === "S11" &&
      route.next === "S12" &&
      session.role === "LUCIO" &&
      byRole.LUCIO?.["SC-017"] === "KEPT"
    ) {
      const cigarRows = await sql`
        SELECT location FROM inventory
        WHERE game_id = ${session.game_id}
          AND player_id = ${session.player_id}
          AND item_id = 'cuban_cigar'
        LIMIT 1
      `;
      const oldLocation = cigarRows[0]?.location || null;
      const newLocation = "Tasca interna della giacca · Camera 412";
      if (oldLocation && oldLocation !== newLocation) {
        await sql`
          UPDATE inventory
          SET location = ${newLocation}, updated_scene = 'S12'
          WHERE game_id = ${session.game_id}
            AND player_id = ${session.player_id}
            AND item_id = 'cuban_cigar'
        `;
        await sql`
          INSERT INTO inventory_events
            (id, game_id, player_id, item_id, event_type, scene_id, story_time, from_location, to_location, note)
          VALUES
            (${crypto.randomUUID()}, ${session.game_id}, ${session.player_id}, 'cuban_cigar', 'MOVE', 'S12',
             'Sabato · 10:38', ${oldLocation}, ${newLocation},
             'La giacca della sera precedente è rimasta in Camera 412; il tubo è ancora nella tasca interna.')
        `;
      }
    }

    await sql`UPDATE players SET current_scene = ${route.next} WHERE id = ${session.player_id}`;
    await sql`
      INSERT INTO progress_events (id, game_id, player_id, role, scene_id, event_type)
      VALUES (${crypto.randomUUID()}, ${session.game_id}, ${session.player_id}, ${session.role}, ${route.next}, 'ENTER_SCENE')
    `;
    await sql`UPDATE games SET updated_at = now() WHERE id = ${session.game_id}`;
    return Response.json({ ok: true, next: route.next });
  } catch (error) {
    return Response.json({ error: error.message || "Errore server" }, { status: 500 });
  }
}
