import { STORY } from "../content/story";

export const ROLES = ["CHIARA", "LUCIO"];

export function getSceneDefinition(sceneId) {
  return STORY[sceneId] || null;
}

export function getActionDefinition(sceneId, actionId) {
  const scene = getSceneDefinition(sceneId);
  return scene?.choices?.find((c) => c.id === actionId) || null;
}

function optionLabel(def, value) {
  return def?.options?.find((o) => o.value === value)?.label || value || null;
}

function getDecisionValue(kind, actionId, role, ownMap, sharedMap, byRole) {
  if (kind === "OWN") return ownMap[actionId];
  if (kind === "SHARED") return sharedMap[actionId];
  if (kind === "CHIARA" || kind === "LUCIO") return byRole?.[kind]?.[actionId];
  if (kind === "OTHER") {
    const other = role === "CHIARA" ? "LUCIO" : "CHIARA";
    return byRole?.[other]?.[actionId];
  }
  return undefined;
}

function isConditionTrue(kind, actionId, expected, role, ownMap, sharedMap, byRole) {
  return getDecisionValue(kind, actionId, role, ownMap, sharedMap, byRole) === expected;
}

function isChoiceVisible(def, role, ownMap, sharedMap, byRole) {
  const cond = def?.showIf;
  if (!cond) return true;
  const kind = String(cond.kind || "OWN").toUpperCase();
  const actual = getDecisionValue(kind, cond.actionId, role, ownMap, sharedMap, byRole);
  if (Array.isArray(cond.values)) return cond.values.includes(actual);
  return actual === cond.value;
}

function paragraphsFromText(text) {
  return String(text || "")
    .split(/\n\s*\n/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

// Markup support inside scene_content.body:
// [[CHOICE:FAA-001]]                   -> renders the choice here and gates following text until resolved
// [[IF:OWN:FAA-001=VALUE]]             -> conditional content
// [[IF:SHARED:FAA-001=VALUE]]          -> shared conditional content
// [[IF:CHIARA:FAA-001=VALUE]]          -> specific player's state
// [[IF:LUCIO:FAA-002=VALUE]]
// [[IF:OTHER:FAA-002=VALUE]]
// [[ELSE]] / [[ENDIF]]
// [[SYNC]]                              -> places the sync word exactly here
// [[DIVIDER]]                           -> visual divider
// [[MEMORY:Testo da lasciare come memoria reale]]
// [[WAIT:OTHER:FAA-002]]               -> ferma il testo finché l'altra persona non ha salvato quella scelta
function parseNarrativeBody({ body, scene, role, ownMap, sharedMap, byRole }) {
  const lines = String(body || "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  const stack = [];
  let textBuffer = [];
  let haltedByChoice = false;
  let waitingForPartnerChoice = false;
  const renderedChoiceIds = new Set();

  const active = () => stack.every((x) => x.active);
  const flushText = () => {
    if (!active() || textBuffer.length === 0) { textBuffer = []; return; }
    const text = textBuffer.join("\n").trim();
    textBuffer = [];
    if (!text) return;
    const paragraphs = paragraphsFromText(text);
    if (paragraphs.length) blocks.push({ type: "text", paragraphs });
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    const ifMatch = line.match(/^\[\[IF:(OWN|SHARED|CHIARA|LUCIO|OTHER):([^=\]]+)=([^\]]+)\]\]$/i);
    if (ifMatch) {
      flushText();
      const [, rawKind, rawActionId, rawExpected] = ifMatch;
      const kind = rawKind.toUpperCase();
      const actionId = rawActionId.trim();
      const expected = rawExpected.trim();
      const parentActive = active();
      const truth = parentActive && isConditionTrue(kind, actionId, expected, role, ownMap, sharedMap, byRole);
      stack.push({ parentActive, truth, active: truth, elseUsed: false });
      continue;
    }
    if (/^\[\[ELSE\]\]$/i.test(line)) {
      flushText();
      const top = stack[stack.length - 1];
      if (top && !top.elseUsed) {
        top.elseUsed = true;
        top.active = top.parentActive && !top.truth;
      }
      continue;
    }
    if (/^\[\[ENDIF\]\]$/i.test(line)) {
      flushText();
      stack.pop();
      continue;
    }

    if (!active()) continue;

    const waitMatch = line.match(/^\[\[WAIT:(OWN|SHARED|CHIARA|LUCIO|OTHER):([^\]]+)\]\]$/i);
    if (waitMatch) {
      flushText();
      const [, rawKind, rawActionId] = waitMatch;
      const kind = rawKind.toUpperCase();
      const actionId = rawActionId.trim();
      const value = getDecisionValue(kind, actionId, role, ownMap, sharedMap, byRole);
      if (!value) {
        blocks.push({
          type: "wait",
          actionId,
          text: kind === "OTHER"
            ? "Aspetta che anche l’altra persona registri la propria scelta."
            : "Aspetta che la scelta necessaria venga registrata."
        });
        waitingForPartnerChoice = true;
        haltedByChoice = true;
        break;
      }
      continue;
    }

    const choiceMatch = line.match(/^\[\[CHOICE:([^\]]+)\]\]$/i);
    if (choiceMatch) {
      flushText();
      const actionId = choiceMatch[1].trim();
      const def = scene.choices?.find((c) => c.id === actionId);
      if (!def || !(def.roles || ROLES).includes(role)) continue;
      renderedChoiceIds.add(actionId);
      if (!isChoiceVisible(def, role, ownMap, sharedMap, byRole)) continue;
      const selected = (def.scope || "individual") === "shared" ? sharedMap[actionId] : ownMap[actionId];
      blocks.push({
        type: "choice",
        id: def.id,
        scope: def.scope || "individual",
        prompt: def.prompt,
        selected: selected || null,
        selectedLabel: selected ? optionLabel(def, selected) : null,
        saveToJournal: def.saveToJournal !== false,
        options: selected ? [] : (def.options || []).map((o) => ({ value: o.value, label: o.label }))
      });
      if (!selected && def.gate !== false) {
        haltedByChoice = true;
        break;
      }
      continue;
    }

    if (/^\[\[SYNC\]\]$/i.test(line)) {
      flushText();
      if (scene.syncWord) blocks.push({ type: "sync", word: scene.syncWord });
      continue;
    }
    if (/^\[\[DIVIDER\]\]$/i.test(line)) {
      flushText();
      blocks.push({ type: "divider" });
      continue;
    }
    const memoryMatch = line.match(/^\[\[MEMORY:(.*)\]\]$/i);
    if (memoryMatch) {
      flushText();
      blocks.push({ type: "memory", text: memoryMatch[1].trim() });
      continue;
    }

    textBuffer.push(rawLine);
  }
  flushText();

  // Safety fallback: any role-relevant choices without an inline marker are appended.
  // This prevents a migrated scene from silently losing a decision.
  if (!haltedByChoice) {
    for (const def of (scene.choices || []).filter((c) => (c.roles || ROLES).includes(role) && isChoiceVisible(c, role, ownMap, sharedMap, byRole))) {
      if (renderedChoiceIds.has(def.id)) continue;
      const selected = (def.scope || "individual") === "shared" ? sharedMap[def.id] : ownMap[def.id];
      blocks.push({
        type: "choice",
        id: def.id,
        scope: def.scope || "individual",
        prompt: def.prompt,
        selected: selected || null,
        selectedLabel: selected ? optionLabel(def, selected) : null,
        saveToJournal: def.saveToJournal !== false,
        options: selected ? [] : (def.options || []).map((o) => ({ value: o.value, label: o.label }))
      });
      if (!selected && def.gate !== false) {
        haltedByChoice = true;
        break;
      }
    }
  }

  const hasSyncBlock = blocks.some((b) => b.type === "sync");
  if (!haltedByChoice && scene.syncWord && !hasSyncBlock) blocks.push({ type: "sync", word: scene.syncWord });

  const unresolved = blocks.filter((b) => b.type === "choice" && !b.selected).length;
  return { blocks, unresolved, haltedByChoice, waitingForPartnerChoice };
}

export function getSceneView(sceneId, role, ownMap = {}, sharedMap = {}, byRole = { CHIARA: {}, LUCIO: {} }, contentOverride = null) {
  const scene = getSceneDefinition(sceneId);
  if (!scene) return null;
  const roleDef = scene.roles?.[role];
  if (!roleDef) return null;

  const body = contentOverride?.body ?? roleDef.body ?? "";
  const title = contentOverride?.title || roleDef.title;
  const parsed = parseNarrativeBody({ body, scene, role, ownMap, sharedMap, byRole });
  const hasExplicitMemory = String(body || "").includes("[[MEMORY:");
  if (!hasExplicitMemory && scene.memoryNotes?.length && !parsed.haltedByChoice) {
    for (const note of scene.memoryNotes) parsed.blocks.push({ type: "memory", text: note });
  }

  return {
    code: scene.code,
    sceneId,
    eyebrow: scene.lockedAfter ? "FINE" : "FINCHÉ L’AUDIENCE NON CI SEPARI",
    title,
    time: scene.time,
    location: scene.location,
    blocks: parsed.blocks,
    unresolvedChoiceCount: parsed.unresolved,
    haltedByChoice: parsed.haltedByChoice,
    waitingForPartnerChoice: parsed.waitingForPartnerChoice,
    lockedAfter: Boolean(scene.lockedAfter),
    contentSource: contentOverride ? "database" : "fallback"
  };
}

export function routeForScene(sceneId, decisionByRole = {}, sharedMap = {}) {
  const scene = getSceneDefinition(sceneId);
  if (!scene) return null;

  // FAA usa una route lineare: le scelte cambiano la narrazione,
  // non l'ID della scena successiva.
  // I WAIT tra i due POV restano gestiti dal parser dei BODY.
  if (!scene.next) return { locked: true };
  return { next: scene.next };
}
