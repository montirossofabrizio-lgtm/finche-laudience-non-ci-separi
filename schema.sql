CREATE TABLE IF NOT EXISTS games (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS players (
  id uuid PRIMARY KEY,
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('CHIARA','LUCIO')),
  token_hash text NOT NULL,
  recovery_hash text NOT NULL,
  current_scene text NOT NULL DEFAULT 'PROLOGO',
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(game_id, role)
);

CREATE TABLE IF NOT EXISTS decisions (
  id uuid PRIMARY KEY,
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  action_id text NOT NULL,
  value text NOT NULL,
  scene_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(game_id, player_id, action_id)
);

CREATE TABLE IF NOT EXISTS shared_decisions (
  id uuid PRIMARY KEY,
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  action_id text NOT NULL,
  value text NOT NULL,
  scene_id text,
  decided_by_player_id uuid REFERENCES players(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(game_id, action_id)
);

CREATE TABLE IF NOT EXISTS inventory (
  id uuid PRIMARY KEY,
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  item_id text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  location text,
  acquired_scene text,
  updated_scene text,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(game_id, player_id, item_id)
);

CREATE TABLE IF NOT EXISTS inventory_events (
  id uuid PRIMARY KEY,
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  item_id text NOT NULL,
  event_type text NOT NULL,
  scene_id text,
  story_time text,
  from_location text,
  to_location text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id uuid PRIMARY KEY,
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  entry_id text,
  title text NOT NULL,
  body text NOT NULL,
  scene_id text,
  story_time text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS progress_events (
  id uuid PRIMARY KEY,
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  role text NOT NULL,
  scene_id text NOT NULL,
  event_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scene_content (
  id bigserial PRIMARY KEY,
  scene_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('CHIARA','LUCIO')),
  title text NOT NULL,
  body text NOT NULL,
  published boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(scene_id, role)
);

CREATE INDEX IF NOT EXISTS idx_decisions_game ON decisions(game_id);
CREATE INDEX IF NOT EXISTS idx_progress_game ON progress_events(game_id);
CREATE INDEX IF NOT EXISTS idx_journal_player ON journal_entries(player_id, created_at);
