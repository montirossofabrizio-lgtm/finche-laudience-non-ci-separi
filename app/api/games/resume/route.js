import { getSql } from "../../../../lib/db";
import { hashToken, makeToken } from "../../../../lib/auth";
import { ROLES } from "../../../../lib/content";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const { code: rawCode, role, recoveryKey: rawRecoveryKey } = await request.json();
    const code = String(rawCode || "").trim().toUpperCase();
    const recoveryKey = String(rawRecoveryKey || "").trim().toUpperCase();
    if (!code || !ROLES.includes(role) || !recoveryKey) {
      return Response.json({ error: "Codice, libro e chiave di ripresa sono obbligatori" }, { status: 400 });
    }

    const sql = getSql();
    const recoveryHash = hashToken(recoveryKey);
    const rows = await sql`
      SELECT p.id, p.game_id
      FROM players p
      JOIN games g ON g.id = p.game_id
      WHERE g.code = ${code} AND p.role = ${role} AND p.recovery_hash = ${recoveryHash}
      LIMIT 1
    `;
    if (!rows[0]) return Response.json({ error: "Dati di ripresa non validi" }, { status: 404 });

    const token = makeToken();
    const tokenHash = hashToken(token);
    await sql`UPDATE players SET token_hash = ${tokenHash} WHERE id = ${rows[0].id}`;
    await sql`UPDATE games SET updated_at = now() WHERE id = ${rows[0].game_id}`;
    return Response.json({ code, role, token, recoveryKey });
  } catch (error) {
    return Response.json({ error: error.message || "Errore server" }, { status: 500 });
  }
}
