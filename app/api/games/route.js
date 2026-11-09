import crypto from "node:crypto";
import { getSql } from "../../../lib/db";
import { hashToken, makeGameCode, makeRecoveryKey, makeToken } from "../../../lib/auth";
import { ROLES } from "../../../lib/content";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const { role } = await request.json();
    if (!ROLES.includes(role)) return Response.json({ error: "Ruolo non valido" }, { status: 400 });

    const sql = getSql();
    const token = makeToken();
    const recoveryKey = makeRecoveryKey();
    const tokenHash = hashToken(token);
    const recoveryHash = hashToken(recoveryKey);

    for (let i = 0; i < 8; i++) {
      const code = makeGameCode();
      const gameId = crypto.randomUUID();
      try {
        await sql`INSERT INTO games (id, code) VALUES (${gameId}, ${code})`;
        const playerId = crypto.randomUUID();
        await sql`
          INSERT INTO players (id, game_id, role, token_hash, recovery_hash, current_scene)
          VALUES (${playerId}, ${gameId}, ${role}, ${tokenHash}, ${recoveryHash}, 'PROLOGO')
        `;
        await sql`
          INSERT INTO progress_events (id, game_id, player_id, role, scene_id, event_type)
          VALUES (${crypto.randomUUID()}, ${gameId}, ${playerId}, ${role}, 'PROLOGO', 'ENTER_SCENE')
        `;
        return Response.json({ code, role, token, recoveryKey });
      } catch (error) {
        if (String(error).includes("games_code_key")) continue;
        throw error;
      }
    }
    return Response.json({ error: "Impossibile creare un codice partita" }, { status: 500 });
  } catch (error) {
    return Response.json({ error: error.message || "Errore server" }, { status: 500 });
  }
}
