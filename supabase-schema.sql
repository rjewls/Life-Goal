-- ============================================================
--  Life Advisor — Supabase SQL Schema  (single-user, no auth)
--
--  Paste this ENTIRE file into:
--  Supabase Dashboard → SQL Editor → New Query → Run
--
--  Safe to re-run: DROP IF EXISTS at the top clears old tables.
-- ============================================================

-- ── Enable UUID extension ──────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Drop old tables if re-running ─────────────────────────
DROP TABLE IF EXISTS public.savings_ledger CASCADE;
DROP TABLE IF EXISTS public.items          CASCADE;
DROP TABLE IF EXISTS public.months         CASCADE;
DROP TABLE IF EXISTS public.settings       CASCADE;
DROP TABLE IF EXISTS public.notes          CASCADE;
DROP TABLE IF EXISTS public.todos          CASCADE;


-- ============================================================
--  SETTINGS  (single row, id is always 'default')
-- ============================================================
CREATE TABLE public.settings (
  id               TEXT        PRIMARY KEY DEFAULT 'default',
  default_currency TEXT        NOT NULL DEFAULT 'DZD',
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the single settings row
INSERT INTO public.settings (id, default_currency)
VALUES ('default', 'DZD')
ON CONFLICT (id) DO NOTHING;


-- ============================================================
--  MONTHS  (monthly income records, e.g. "2026-03")
-- ============================================================
CREATE TABLE public.months (
  ym         TEXT        PRIMARY KEY,   -- "YYYY-MM"
  income     NUMERIC     NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
--  ITEMS  (expense and income entries)
-- ============================================================
CREATE TABLE public.items (
  id                   TEXT        PRIMARY KEY,   -- app-generated id (timestamp+random)
  label                TEXT        NOT NULL,
  amount               NUMERIC     NOT NULL DEFAULT 0,
  type                 TEXT        NOT NULL DEFAULT 'expense'
                                   CHECK (type IN ('expense', 'income')),
  date                 DATE,
  month                TEXT        NOT NULL,      -- "YYYY-MM"
  category             TEXT        NOT NULL DEFAULT '',
  notes                TEXT        NOT NULL DEFAULT '',
  currency             TEXT        NOT NULL DEFAULT 'DZD',
  -- recurrence
  is_recurring         BOOLEAN     NOT NULL DEFAULT FALSE,
  recur_every          INTEGER,                   -- every N units (e.g. 2)
  recur_unit           TEXT        CHECK (recur_unit IN ('day','week','month','year')),
  recur_end_type       TEXT        CHECK (recur_end_type IN ('ongoing','duration','date')),
  recur_duration_count INTEGER,                   -- for end_type='duration'
  recur_duration_unit  TEXT        CHECK (recur_duration_unit IN ('day','week','month','year')),
  recur_end_date       DATE,                      -- for end_type='date'
  --
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ
);


-- ============================================================
--  SAVINGS_LEDGER  (all-time savings history)
-- ============================================================
CREATE TABLE public.savings_ledger (
  id         TEXT        PRIMARY KEY,   -- app-generated id
  item_id    TEXT,                      -- NULL for surplus entries
  amount     NUMERIC     NOT NULL,
  currency   TEXT        NOT NULL DEFAULT 'DZD',
  date       DATE,
  month      TEXT,                      -- "YYYY-MM"
  source     TEXT        NOT NULL CHECK (source IN ('savings', 'surplus')),
  label      TEXT        NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
--  NOTES  (personal notes with one-time or repeating reminders)
-- ============================================================
CREATE TABLE public.notes (
  id                       UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  title                    TEXT        NOT NULL,
  content                  TEXT        NOT NULL DEFAULT '',
  -- One-time reminder: fire a notification at this exact moment
  alert_at                 TIMESTAMPTZ,
  -- Repeating reminder: every N [minutes|hours|days]
  reminder_interval_value  INTEGER,
  reminder_interval_unit   TEXT        CHECK (reminder_interval_unit IN ('minutes','hours','days')),
  -- Native notification identifier so we can cancel/replace it
  notification_id          TEXT,
  -- UX helpers
  color                    TEXT        NOT NULL DEFAULT 'none',
  is_pinned                BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
--  TODOS  (personal task list)
--  Ready for the future todos feature
-- ============================================================
CREATE TABLE public.todos (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  title        TEXT        NOT NULL,
  description  TEXT        NOT NULL DEFAULT '',
  is_completed BOOLEAN     NOT NULL DEFAULT FALSE,
  due_date     TIMESTAMPTZ,
  priority     TEXT        NOT NULL DEFAULT 'medium'
                           CHECK (priority IN ('low', 'medium', 'high')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
--  UPDATED_AT auto-update triggers
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_settings_updated_at
  BEFORE UPDATE ON public.settings
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER trg_months_updated_at
  BEFORE UPDATE ON public.months
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER trg_items_updated_at
  BEFORE UPDATE ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER trg_notes_updated_at
  BEFORE UPDATE ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER trg_todos_updated_at
  BEFORE UPDATE ON public.todos
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();


-- ============================================================
--  INDEXES
-- ============================================================
CREATE INDEX idx_items_month       ON public.items(month);
CREATE INDEX idx_items_date        ON public.items(date);
CREATE INDEX idx_savings_month     ON public.savings_ledger(month);
CREATE INDEX idx_notes_alert_at    ON public.notes(alert_at);
CREATE INDEX idx_todos_due         ON public.todos(due_date);


-- ============================================================
--  ROW LEVEL SECURITY — open policies (single-user, no login)
--  The anon key can read and write all tables freely.
-- ============================================================
ALTER TABLE public.settings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.months         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.items          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.savings_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.todos          ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon full access" ON public.settings       FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon full access" ON public.months         FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon full access" ON public.items          FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon full access" ON public.savings_ledger FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon full access" ON public.notes          FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon full access" ON public.todos          FOR ALL USING (true) WITH CHECK (true);


-- ============================================================
--  Done! Verify with:
--  SELECT table_name FROM information_schema.tables
--  WHERE table_schema = 'public' ORDER BY table_name;
-- ============================================================
