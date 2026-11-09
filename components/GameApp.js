"use client";

import { useEffect, useMemo, useState } from "react";

const SESSION_KEY = "faa_session_v1";
const LEGACY_SESSION_KEY = "faa_session_legacy";
const LOCAL_KEY = "faa_local_demo_v1";

const ROLE_LABELS = { CHIARA: "CONCORRENTE A", LUCIO: "CONCORRENTE B" };
const ROLE_OPTIONS = [
  { id: "CHIARA", label: "CONCORRENTE A", note: "IL PRIMO POSTO IN STUDIO." },
  { id: "LUCIO", label: "CONCORRENTE B", note: "IL SECONDO POSTO IN STUDIO." }
];

function displayRole(role) {
  return ROLE_LABELS[role] || role;
}

const localScenes = {
  CHIARA: { code:"DEMO", eyebrow:"PROVA TECNICA", title:"Microfono acceso", time:"21:00", location:"Studio", blocks:[
    {type:"text", paragraphs:["Questa è soltanto una prova tecnica del motore. Non contiene materiale della storia."]},
    {type:"choice", id:"DEMO_A", scope:"individual", prompt:"Il pulsante funziona?", options:[{value:"SI",label:"SÌ"}]}
  ]},
  LUCIO: { code:"DEMO", eyebrow:"PROVA TECNICA", title:"Microfono acceso", time:"21:00", location:"Studio", blocks:[
    {type:"text", paragraphs:["Questa è soltanto una prova tecnica del motore. Non contiene materiale della storia."]},
    {type:"choice", id:"DEMO_B", scope:"individual", prompt:"Il pulsante funziona?", options:[{value:"SI",label:"SÌ"}]}
  ]}
};

function saveSession(value) { localStorage.setItem(SESSION_KEY, JSON.stringify(value)); }
function loadSession() {
  try {
    const current = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (current) return current;
    const legacy = JSON.parse(localStorage.getItem(LEGACY_SESSION_KEY) || "null");
    if (legacy) { localStorage.setItem(SESSION_KEY, JSON.stringify(legacy)); return legacy; }
  } catch {}
  return null;
}

export default function GameApp() {
  const [session, setSession] = useState(null);
  const [mode, setMode] = useState("landing");
  const [tab, setTab] = useState("scene");
  const [state, setState] = useState(null);
  const [role, setRole] = useState("CHIARA");
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  useEffect(() => {
    const saved = loadSession();
    if (saved) {
      setSession(saved);
      setMode(saved.local ? "local" : "game");
      if (saved.local) hydrateLocal(saved.role);
    }
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  useEffect(() => {
    if (!session || session.local || mode !== "game") return;
    refreshRemote();
    const timer = setInterval(refreshRemote, 3500);
    return () => clearInterval(timer);
  }, [session?.code, session?.token, mode]);

  const authHeaders = useMemo(() => session && !session.local ? {
    "x-game-code": session.code,
    "authorization": `Bearer ${session.token}`
  } : {}, [session]);

  async function refreshRemote() {
    if (!session || session.local) return;
    try {
      const res = await fetch("/api/state", { headers: authHeaders, cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Errore di sincronizzazione");
      setState(json); setError("");
    } catch (e) { setError(e.message); }
  }

  function hydrateLocal(localRole) {
    const saved = JSON.parse(localStorage.getItem(LOCAL_KEY) || "{}");
    const choice = saved[localRole]?.choice || null;
    const inventory = saved[localRole]?.inventory || [];
    const journal = saved[localRole]?.journal || [];
    const scene = structuredClone(localScenes[localRole]);
    if (choice) {
      scene.blocks = scene.blocks.map((b) => b.type === "choice" ? { ...b, selected: choice, selectedLabel: journal[0]?.body || choice, options: [] } : b);
    }
    setState({
      game: { code: "DEMO", partnerConnected: false, updatedAt: new Date().toISOString(), players: [{ role: localRole, currentScene: "DEMO" }] },
      player: { role: localRole, currentScene: "DEMO" }, scene, inventory, journal,
      route: { locked: true, canAdvance: false }
    });
  }

  async function createGame() {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/games", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Impossibile creare la partita");
      const s = { ...json, local: false }; saveSession(s); setSession(s); setMode("game");
    } catch (e) { setError(e.message + " — puoi comunque aprire la demo locale."); }
    finally { setBusy(false); }
  }

  async function joinGame() {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/games/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: joinCode }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Impossibile entrare");
      const s = { ...json, local: false }; saveSession(s); setSession(s); setMode("game");
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function resumeGame({ code, role: resumeRole, recoveryKey }) {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/games/resume", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, role: resumeRole, recoveryKey })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Impossibile riprendere la partita");
      const s = { ...json, local: false }; saveSession(s); setSession(s); setMode("game");
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  function startLocal(localRole) {
    const s = { role: localRole, code: "DEMO", token: "local", local: true };
    saveSession(s); setSession(s); setMode("local"); hydrateLocal(localRole);
  }

  async function choose(actionId, option) {
    setBusy(true); setError("");
    try {
      if (session.local) {
        const saved = JSON.parse(localStorage.getItem(LOCAL_KEY) || "{}");
        saved[state.player.role] = { choice: option, inventory: [], journal: [{ title: "Test", body: "Scelta tecnica salvata.", scene_id: "DEMO", story_time: "Ora", created_at: new Date().toISOString() }] };
        localStorage.setItem(LOCAL_KEY, JSON.stringify(saved));
        hydrateLocal(state.player.role);
        setToast("Scelta salvata");
      } else {
        const res = await fetch("/api/action", { method: "POST", headers: { "content-type": "application/json", ...authHeaders }, body: JSON.stringify({ actionId, option }) });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Errore nel salvataggio");
        setToast(json.addedItem ? "Scelta salvata · situazione aggiornata" : "Scelta salvata");
        await refreshRemote();
      }
      setTimeout(() => setToast(""), 2300);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function advance() {
    if (session.local || !state?.route?.canAdvance) return;
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/advance", { method: "POST", headers: { ...authHeaders } });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Non puoi ancora proseguire");
      window.scrollTo({ top: 0, behavior: "smooth" });
      await refreshRemote();
      setToast("Partita salvata"); setTimeout(() => setToast(""), 1800);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  function goHome() {
    setMode("landing");
    setTab("scene");
    setError("");
  }

  function continueSavedGame() {
    if (!session) return;
    setError("");
    setMode(session.local ? "local" : "game");
    if (session.local) hydrateLocal(session.role);
  }

  function forgetDevice() {
    const ok = window.confirm(
      "Vuoi davvero dimenticare questa partita su questo dispositivo?\n\n" +
      "La partita resterà salvata sul server, ma per rientrare qui serviranno CODICE PARTITA + CHIAVE DI RIPRESA."
    );
    if (!ok) return;
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(LEGACY_SESSION_KEY);
    setSession(null);
    setState(null);
    setMode("landing");
    setTab("scene");
    setError("");
  }

  if (mode === "landing" || !session) return <Landing role={role} setRole={setRole} joinCode={joinCode} setJoinCode={setJoinCode} createGame={createGame} joinGame={joinGame} resumeGame={resumeGame} startLocal={startLocal} busy={busy} error={error} savedSession={session} continueSavedGame={continueSavedGame} forgetDevice={forgetDevice} />;
  if (!state) return <main className="loading"><div className="sigil">II</div><p>Sincronizzo la partita…</p>{error && <button className="ghost" onClick={goHome}>Torna alla home</button>}</main>;

  return <main className="app-shell">
    <header className="topbar">
      <div><span className="mini">PARTITA</span><strong>{state.game.code}</strong></div>
      <div className="autosave"><span>✓</span> SALVATAGGIO AUTOMATICO</div>
      <div className="role-pill">{displayRole(state.player.role)}</div>
    </header>
    {tab === "scene" && <SceneView state={state} choose={choose} advance={advance} busy={busy} local={session.local} />}
    {tab === "journal" && <Journal entries={state.journal} />}
    {tab === "couple" && <Couple state={state} session={session} goHome={goHome} />}
    {error && <div className="error-toast">{error}</div>}{toast && <div className="success-toast">{toast}</div>}
    <nav className="bottom-nav">
      <NavButton active={tab === "scene"} onClick={() => setTab("scene")} icon="◐" label="SCENA" />
      <NavButton active={tab === "journal"} onClick={() => setTab("journal")} icon="≡" label="CRONACA" count={state.journal.length} />
      <NavButton active={tab === "couple"} onClick={() => setTab("couple")} icon="II" label="NOI" />
    </nav>
  </main>;
}

function Landing({ role, setRole, joinCode, setJoinCode, createGame, joinGame, resumeGame, startLocal, busy, error, savedSession, continueSavedGame, forgetDevice }) {
  const [panel, setPanel] = useState("start");
  const [resumeCode, setResumeCode] = useState("");
  const [resumeRole, setResumeRole] = useState("CHIARA");
  const [recoveryKey, setRecoveryKey] = useState("");

  return <main className="landing acn-landing reality-landing">
    <div className="grain" />

    <section className="reality-keyart" aria-labelledby="reality-home-title">
      <picture>
        <source media="(max-width: 639px)" srcSet="/faa-home-mobile.webp" />
        <img
          src="/faa-home-wide.webp"
          alt=""
          aria-hidden="true"
          className="reality-keyart-image"
          fetchPriority="high"
          draggable="false"
        />
      </picture>
      <div className="reality-keyart-shade" />
      <div className="reality-broadcast-strip" aria-hidden="true">
        <span className="live-dot" />
        <span>ON AIR</span>
        <span className="broadcast-divider">•</span>
        <span>DUE GIOCATORI</span>
        <span className="broadcast-divider">•</span>
        <span>~60 MIN</span>
      </div>
      <h1 id="reality-home-title" className="sr-only">Finché l’audience non ci separi</h1>
    </section>

    <section className="landing-card acn-card reality-control-card">
      {panel === "start" && <>
        <div className="reality-intro">
          <p className="overline">UN REALITY INTERATTIVO PER DUE</p>
          <p className="reality-intro-copy">Due telefoni. Una coppia. Una Produzione senza scrupoli.</p>
          <div className="reality-rule">
            <span>REGOLA N. 1</span>
            <strong>NON LEGGETEVI LO SCHERMO.</strong>
          </div>
        </div>

        {savedSession && !savedSession.local && <div className="saved-game-card reality-saved">
          <span>DIRETTA INTERROTTA</span>
          <div className="saved-game-main">
            <div><small>PARTITA</small><strong>{savedSession.code}</strong></div>
            <div><small>IL TUO POSTO</small><strong>{displayRole(savedSession.role)}</strong></div>
          </div>
          <button className="primary" onClick={continueSavedGame}>TORNA IN DIRETTA</button>
          <p>Su questo dispositivo non serve la chiave di ripresa.</p>
          <button className="forget-device-btn" onClick={forgetDevice}>DIMENTICA QUESTA PARTITA</button>
        </div>}

        {savedSession?.local && <div className="saved-game-card">
          <span>DEMO SALVATA SU QUESTO DISPOSITIVO</span>
          <button className="primary" onClick={continueSavedGame}>RIPRENDI LA DEMO</button>
          <button className="forget-device-btn" onClick={forgetDevice}>DIMENTICA LA DEMO</button>
        </div>}

        <div className="reality-actions">
          <button className={savedSession ? "secondary" : "primary"} onClick={() => setPanel("create")}>
            {savedSession ? "INIZIA UN’ALTRA DIRETTA" : "INIZIA IL REALITY"}
          </button>
          <button className="secondary" onClick={() => setPanel("join")}>HO UN CODICE PARTITA</button>
          <button className="secondary subtle" onClick={() => setPanel("resume")}>RIPRENDI SU UN ALTRO DISPOSITIVO</button>
        </div>

        <p className="reality-disclaimer">La Produzione declina ogni responsabilità per silenzi imbarazzanti, accuse infondate e improvvisi picchi d’audience.</p>
      </>}

      {panel === "create" && <>
        <div className="panel-broadcast-title"><span className="live-dot" /> CASTING</div>
        <p className="section-label">SCEGLI IL TUO POSTO</p>
        <div className="role-grid">
          {ROLE_OPTIONS.map(r => <button key={r.id} className={`role-choice ${role===r.id?"selected":""}`} onClick={()=>setRole(r.id)}><span>{r.label}</span><small>{r.note}</small></button>)}
        </div>
        <p className="hint acn-role-hint">L’altra persona riceverà automaticamente l’altro posto. Non scambiatevi i telefoni.</p>
        <button className="primary" disabled={busy} onClick={createGame}>{busy ? "PREPARO LA DIRETTA…" : "CREA PARTITA"}</button>
        <button className="text-btn" onClick={()=>setPanel("start")}>Torna alla copertina</button>
      </>}

      {panel === "join" && <>
        <div className="panel-broadcast-title"><span className="live-dot" /> ACCESSO STUDIO</div>
        <p className="section-label">CODICE PARTITA</p>
        <input className="code-input" maxLength={6} value={joinCode} onChange={e=>setJoinCode(e.target.value.toUpperCase())} placeholder="7K4M2Q"/>
        <p className="hint">Il posto rimasto libero verrà assegnato automaticamente.</p>
        <button className="primary" disabled={busy || joinCode.length < 4} onClick={joinGame}>{busy ? "TI PORTO IN STUDIO…" : "ENTRA"}</button>
        <button className="text-btn" onClick={()=>setPanel("start")}>Torna alla copertina</button>
      </>}

      {panel === "resume" && <>
        <div className="panel-broadcast-title"><span className="live-dot" /> RIENTRO IN DIRETTA</div>
        <p className="section-label">RIPRENDI IL TUO POSTO</p>
        <input className="code-input" maxLength={6} value={resumeCode} onChange={e=>setResumeCode(e.target.value.toUpperCase())} placeholder="CODICE PARTITA"/>
        <div className="role-grid">
          {ROLE_OPTIONS.map(r=><button key={r.id} className={`role-choice ${resumeRole===r.id?"selected":""}`} onClick={()=>setResumeRole(r.id)}><span>{r.label}</span><small>{r.note}</small></button>)}
        </div>
        <input className="code-input recovery" maxLength={8} value={recoveryKey} onChange={e=>setRecoveryKey(e.target.value.toUpperCase())} placeholder="CHIAVE DI RIPRESA"/>
        <p className="hint">Serve soltanto su un nuovo telefono/browser o dopo aver cancellato i dati locali.</p>
        <button className="primary" disabled={busy || resumeCode.length < 4 || recoveryKey.length < 6} onClick={()=>resumeGame({code:resumeCode,role:resumeRole,recoveryKey})}>RIPRENDI</button>
        <button className="text-btn" onClick={()=>setPanel("start")}>Torna alla copertina</button>
      </>}

      {panel === "demo" && <>
        <p className="section-label">DEMO OFFLINE · NON CANONICA</p>
        <div className="role-grid">
          <button className="role-choice" onClick={()=>startLocal("CHIARA")}>CONCORRENTE A</button>
          <button className="role-choice" onClick={()=>startLocal("LUCIO")}>CONCORRENTE B</button>
        </div>
        <button className="text-btn" onClick={()=>setPanel("start")}>Indietro</button>
      </>}

      {error && <p className="inline-error">{error}</p>}
    </section>

    <footer className="landing-footer reality-footer">
      <span>FINCHÉ L’AUDIENCE NON CI SEPARI</span>
      <small>LA PRODUZIONE STA GIÀ GUARDANDO.</small>
    </footer>
  </main>;
}

function normalizeStoryText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}


function isSpeakerLabel(text) {
  const t = normalizeStoryText(text).replace(/\*\*/g, "");
  return /^(?:Niccolò|Vera|Marta|Mia|Edo|Giada|Mauro|La Produzione|Produzione|Maxischermo|L’altra persona|Tu):$/i.test(t);
}

function normalStoryParagraphClass(text) {
  const t = normalizeStoryText(text);
  if (isSpeakerLabel(t)) return "speaker-label";
  if (/^[«“"]/.test(t)) return "dialogue";
  return "";
}

function renderedStoryParagraph(text, className) {
  if (className === "speaker-label") {
    return normalizeStoryText(text).replace(/:$/, "");
  }
  return text;
}

function isOutsideBriefingHeadline(text) {
  const t = normalizeStoryText(text);
  return /^C[’']È UNA COSA CHE VUOI OGGI\.?$/i.test(t);
}

function isOutsideBriefingBlock(paragraphs) {
  return Array.isArray(paragraphs) && paragraphs.length > 1 && isOutsideBriefingHeadline(paragraphs[0]);
}

function isRuleSetupHeadline(text) {
  return /^UNA SOLA REGOLA\.?$/i.test(normalizeStoryText(text));
}

function isRuleSetupBlock(paragraphs) {
  return Array.isArray(paragraphs) && paragraphs.length > 0 && isRuleSetupHeadline(paragraphs[0]);
}

function isCoupleMomentHeadline(text) {
  const t = normalizeStoryText(text);
  return /^(?:\*\*)?(FUORI ONDA(?:\s*[—-].*)?|POSATE (?:ENTRAMBI )?(?:IL|I) TELEFON(?:O|I))(?:\*\*)?\.?$/i.test(t);
}

function isCouplePrompt(text) {
  const t = normalizeStoryText(text);
  return /^(COME LO SAI\?|PROVA DI CHE COSA\?|UNA COSA CHE ORMAI POTETE SOSTENERE CON UN FATTO\.?|UNA COSA CHE RESTA SOLTANTO COMPATIBILE\.?|CHE COSA RISCHIATE DI (?:FARE A|FAR SUCCEDERE A) UNA PERSONA SE LA PORTA CHE SCEGLIETE È QUELLA SBAGLIATA\?)$/i.test(t);
}

function isCoupleMomentBoundary(text) {
  const t = normalizeStoryText(text);
  return /^(?:[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ]+\s*·\s*)?\d{1,2}:\d{2}(?::\d{2})?\b/.test(t)
    || /^[«“"]/.test(t)
    || /^(?:Sara|Luca|Chiara|Lucio|Armas|Suárez|Mirella|Giorgio|Dorothy|Mattia|Chiaretta|Michele|Enrico|Nicolás|Tomás|Stefano):$/i.test(t);
}

function storyParagraphClasses(paragraphs) {
  if (isOutsideBriefingBlock(paragraphs)) {
    return paragraphs.map((_, index) => {
      if (index === 0) return "outside-briefing-heading";
      if (index === paragraphs.length - 1) return "outside-briefing-mission";
      return "outside-briefing-copy";
    });
  }

  if (isRuleSetupBlock(paragraphs)) {
    return paragraphs.map((_, index) => index === 0 ? "rule-setup-heading" : "rule-setup-copy");
  }

  let inCoupleMoment = false;
  return paragraphs.map((paragraph) => {
    if (isCoupleMomentHeadline(paragraph)) {
      inCoupleMoment = true;
      return "couple-moment";
    }
    if (!inCoupleMoment) return normalStoryParagraphClass(paragraph);
    if (isCoupleMomentBoundary(paragraph)) {
      inCoupleMoment = false;
      return normalStoryParagraphClass(paragraph);
    }
    return isCouplePrompt(paragraph) ? "couple-prompt" : "couple-instruction";
  });
}

function renderInline(text) {
  const parts = String(text || "").split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean);
  return parts.map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={i}>{part.slice(2,-2)}</strong>;
    if (/^\*[^*]+\*$/.test(part)) return <em key={i}>{part.slice(1,-1)}</em>;
    return part;
  });
}

function SceneView({ state, choose, advance, busy, local }) {
  const s = state.scene;
  return <article className="scene-page">
    <div className="scene-head"><p className="eyebrow">{s.eyebrow}</p><div className="scene-code">SCENA {s.code}</div><h2>{s.title}</h2><div className="scene-meta"><span>{s.time}</span><i>•</i><span>{s.location}</span></div></div>
    <div className="story-flow">
      {(s.blocks || []).map((block, i) => {
        if (block.type === "text") { const paragraphClasses = storyParagraphClasses(block.paragraphs); const specialClass = isOutsideBriefingBlock(block.paragraphs) ? " outside-briefing" : isRuleSetupBlock(block.paragraphs) ? " rule-setup" : ""; return <div className={`story-text${specialClass}`} key={i}>{block.paragraphs.map((p,j)=><p className={paragraphClasses[j]} key={j}>{renderInline(renderedStoryParagraph(p, paragraphClasses[j]))}</p>)}</div>; }
        if (block.type === "divider") return <div className="story-divider" key={i}>◇</div>;
        if (block.type === "memory") return <section className="resolved memory-card" key={i}><span>MEMORIA REALE</span><p>{block.text}</p></section>;
        if (block.type === "sync") return <section className="sync-card" key={i}><div className="sync-symbol" aria-hidden="true">◇</div><span>SINCRONIZZATEVI</span><strong>{block.word}</strong><small>Mostratela all’altro solo quando entrambi siete arrivati qui.</small></section>;
        if (block.type === "wait") return <section className="instruction-card wait-card" key={`wait-${block.actionId}-${i}`}><span>ASPETTA L’ALTRA PERSONA</span><p>{block.text}</p><small>La pagina continuerà automaticamente appena l’altra scelta sarà salvata.</small></section>;
        if (block.type === "choice") return block.selected
          ? <section className="resolved" key={block.id}><span>SCELTA SALVATA</span><p>{block.selectedLabel || block.selected}</p></section>
          : <section className="choice-card inline-choice" key={block.id}><div className="choice-mark">{block.scope === "shared" ? "SCELTA INSIEME" : "SCELTA"}</div><h3>{block.prompt}</h3><div className="choice-options">{block.options.map(o=><button key={o.value} disabled={busy} onClick={()=>choose(block.id,o.value)}><span>{o.label}</span><small>SALVA LA SCELTA</small></button>)}</div></section>;
        return null;
      })}
    </div>
    {!local && <section className="continue-card">
      {state.route?.waitingForPartner && <p>Aspetta che anche l’altra persona completi la scelta necessaria.</p>}
      {state.route?.blocked && <p>{state.route.message || "Prima completa la scelta della scena."}</p>}
      {state.route?.locked ? <p>Qui finisce il contenuto già pubblicato. La prossima SCENA non è ancora disponibile.</p> : <button className="primary" disabled={busy || !state.route?.canAdvance} onClick={advance}>CONTINUA</button>}
    </section>}
  </article>;
}

function Inventory({ items }) {
  const [open, setOpen] = useState(null);
  return <section className="utility-page problems-page"><p className="eyebrow">OGGETTI A RISCHIO</p><h2>Cose che potrebbero creare problemi</h2><p className="utility-intro">Qui finiscono soltanto gli oggetti abbastanza innocenti da sembrare irrilevanti e abbastanza pericolosi da rovinare il pranzo. Vedi solo ciò che il tuo punto di vista sa che esiste.</p>{items.length===0 ? <Empty title="Per ora niente di preoccupante." text="Goditelo. Non durerà." /> : <div className="item-list">{items.map(i=><article className="item-card problem-card" key={i.item_id}><div className="item-icon">◇</div><div className="item-main"><h3>{i.name}</h3><p>{i.description}</p><span className="location">DOVE SI TROVA · {i.location}</span>{i.acquired_scene && <span className="acquired">REGISTRATO · {i.acquired_scene}</span>}<button className="history-toggle" onClick={()=>setOpen(open===i.item_id?null:i.item_id)}>{open===i.item_id?"NASCONDI PERCORSO":"VEDI COME CI È FINITO"}</button>{open===i.item_id && <div className="item-history">{(i.history||[]).map((e,idx)=><div key={idx}><b>{e.scene_id || "—"}</b><span>{e.event_type === "ACQUIRE" ? "REGISTRATO" : e.event_type === "MOVE" ? "SPOSTATO" : "USCITO DI SCENA"}</span><p>{e.from_location ? `${e.from_location} → ` : ""}{e.to_location || "non è più qui"}</p>{e.story_time && <small>{e.story_time}</small>}</div>)}</div>}</div></article>)}</div>}</section>;
}

function Journal({ entries }) {
  return <section className="utility-page disaster-page"><p className="eyebrow">QUELLO CHE È GIÀ ANDATO IN ONDA</p><h2>Cronaca della diretta</h2><p className="utility-intro">Qui restano le decisioni che la diretta ha già trasformato in fatti.</p>{entries.length===0 ? <Empty title="Sorprendentemente, ancora niente." text="È presto." /> : <div className="journal-list disaster-list">{entries.map((e,i)=><article key={i}><time>{e.story_time || (e.scene_id ? `SCENA ${e.scene_id}` : "")}</time><h3>{e.title}</h3><p>{e.body}</p><small>{new Date(e.created_at).toLocaleString("it-IT",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})}</small></article>)}</div>}</section>;
}

function Couple({ state, session, goHome }) {
  const [copied, setCopied] = useState(false);
  const copyRecovery = async () => {
    if (!session.recoveryKey) return;
    await navigator.clipboard?.writeText(`${state.game.code} · ${displayRole(state.player.role)} · ${session.recoveryKey}`);
    setCopied(true); setTimeout(()=>setCopied(false),1600);
  };
  const partner = state.game.players?.find((p)=>p.role!==state.player.role);
  return <section className="utility-page couple-page"><p className="eyebrow">LA VOSTRA DIRETTA</p><h2>Dietro le quinte</h2><div className="code-panel"><span>CODICE</span><strong>{state.game.code}</strong><p>{state.game.partnerConnected ? "L’altra persona è collegata." : "In attesa dell’altra persona."}</p><div className={`presence ${state.game.partnerConnected?"online":""}`}>{state.game.partnerConnected?"● CONNESSI":"○ SOLO TU"}</div></div>
    <div className="progress-pair"><div><span>IL TUO POSTO</span><strong>{displayRole(state.player.role)}</strong><small>{state.player.currentScene}</small></div><div><span>L’ALTRO POSTO</span><strong>{partner?.role ? displayRole(partner.role) : "—"}</strong><small>{partner?.currentScene || "non collegato"}</small></div></div>
    {!session.local && <div className="recovery-panel"><span>CHIAVE DI RIPRESA · {displayRole(state.player.role)}</span><strong>{session.recoveryKey || "Creata nelle nuove partite V3"}</strong><p>Su questo dispositivo non ti serve. Conservala solo per cambiare telefono/browser o dopo aver cancellato i dati locali.</p>{session.recoveryKey && <button className="secondary" onClick={copyRecovery}>{copied?"COPIATA":"COPIA CODICE + CHIAVE"}</button>}</div>}
    <div className="save-panel"><span>ULTIMO SALVATAGGIO SERVER</span><strong>{state.game.updatedAt ? new Date(state.game.updatedAt).toLocaleString("it-IT") : "automatico"}</strong><p>Scelte, scena corrente e Cronaca vengono salvati automaticamente.</p></div>
    <div className="philosophy"><p>Non vedrai percentuali di collaborazione, punteggi fiducia o “indizi trovati”.</p><p>Il sistema conserva soltanto ciò che serve a far reagire correttamente la storia.</p></div><button className="secondary home-return" onClick={goHome}>TORNA ALLA HOME</button><p className="home-return-note">La partita resta salvata su questo dispositivo.</p></section>;
}

function NavButton({active,onClick,icon,label,count}) { return <button className={active?"active":""} onClick={onClick}><span className="nav-icon">{icon}</span><span>{label}</span>{count>0&&<b>{count}</b>}</button> }
function Empty({title,text}) { return <div className="empty"><div>◇</div><h3>{title}</h3><p>{text}</p></div> }
