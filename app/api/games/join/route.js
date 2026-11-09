import crypto from "node:crypto";
import { getSql } from "../../../../lib/db";
import { hashToken, makeRecoveryKey, makeToken } from "../../../../lib/auth";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const { code: rawCode } = await request.json();
    const code = String(rawCode || "").trim().toUpperCase();
    if (!code) return Response.json({ error: "Inserisci il codice partita" }, { status: 400 });

    const sql = getSql();
    const games = await sql`SELECT id, code FROM games WHERE code = ${code} LIMIT 1`;
    if (!games[0]) return Response.json({ error: "Partita non trovata" }, { status: 404 });

    const players = await sql`SELECT role FROM players WHERE game_id = ${games[0].id} ORDER BY joined_at`;
    if (players.length >= 2) return Response.json({ error: "La partita ha già due lettori" }, { status: 409 });

    const occupied = new Set(players.map((p) => p.role));
    const role = occupied.has("CHIARA") ? "LUCIO" : "CHIARA";
    const token = makeToken();
    const recoveryKey = makeRecoveryKey();
    const tokenHash = hashToken(token);
    const recoveryHash = hashToken(recoveryKey);
    const playerId = crypto.randomUUID();

    await sql`
      INSERT INTO players (id, game_id, role, token_hash, recovery_hash, current_scene)
      VALUES (${playerId}, ${games[0].id}, ${role}, ${tokenHash}, ${recoveryHash}, 'PROLOGO')
    `;
    await sql`
      INSERT INTO progress_events (id, game_id, player_id, role, scene_id, event_type)
      VALUES (${crypto.randomUUID()}, ${games[0].id}, ${playerId}, ${role}, 'PROLOGO', 'ENTER_SCENE')
    `;
    await sql`UPDATE games SET updated_at = now() WHERE id = ${games[0].id}`;

    return Response.json({ code, role, token, recoveryKey });
  } catch (error) {
    return Response.json({ error: error.message || "Errore server" }, { status: 500 });
  }
}
