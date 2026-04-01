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
DROP TABLE IF EXISTS public.notes          CASCADE;  -- notes first (FK to note_groups)
DROP TABLE IF EXISTS public.note_groups    CASCADE;
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
--  NOTE_GROUPS  (named groups of notes with their own pin/priority/reminder)
--  Must be created BEFORE notes because notes.group_id references this table.
-- ============================================================
CREATE TABLE public.note_groups (
  id                       UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  title                    TEXT        NOT NULL DEFAULT '',
  color                    TEXT        NOT NULL DEFAULT 'none',
  is_pinned                BOOLEAN     NOT NULL DEFAULT FALSE,
  priority                 TEXT        NOT NULL DEFAULT 'none'
                                       CHECK (priority IN ('none','low','medium','high')),
  -- One-time reminder
  alert_at                 TIMESTAMPTZ,
  -- Repeating reminder
  reminder_interval_value  INTEGER,
  reminder_interval_unit   TEXT        CHECK (reminder_interval_unit IN ('minutes','hours','days')),
  -- Native notification identifier
  notification_id          TEXT,
  -- Display order (lower = appears higher in list)
  sort_order               INTEGER     NOT NULL DEFAULT 0,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
  is_completed             BOOLEAN     NOT NULL DEFAULT FALSE,
  priority                 TEXT        NOT NULL DEFAULT 'none'
                                       CHECK (priority IN ('none','low','medium','high')),
  -- Display order (lower = appears higher in list)
  sort_order               INTEGER     NOT NULL DEFAULT 0,
  -- Group membership: NULL means ungrouped; SET NULL on group delete
  group_id                 UUID        REFERENCES public.note_groups(id) ON DELETE SET NULL,
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

CREATE TRIGGER trg_note_groups_updated_at
  BEFORE UPDATE ON public.note_groups
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
CREATE INDEX idx_notes_alert_at       ON public.notes(alert_at);
CREATE INDEX idx_notes_group_id       ON public.notes(group_id);
CREATE INDEX idx_notes_sort_order     ON public.notes(sort_order);
CREATE INDEX idx_note_groups_sort     ON public.note_groups(sort_order);
CREATE INDEX idx_todos_due            ON public.todos(due_date);


-- ============================================================
--  ROW LEVEL SECURITY — open policies (single-user, no login)
--  The anon key can read and write all tables freely.
-- ============================================================
ALTER TABLE public.settings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.months         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.items          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.savings_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.note_groups    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.todos          ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon full access" ON public.settings       FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon full access" ON public.months         FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon full access" ON public.items          FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon full access" ON public.savings_ledger FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon full access" ON public.notes          FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon full access" ON public.note_groups    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon full access" ON public.todos          FOR ALL USING (true) WITH CHECK (true);


-- ============================================================
--  Done! Verify with:
--  SELECT table_name FROM information_schema.tables
--  WHERE table_schema = 'public' ORDER BY table_name;
-- ============================================================


-- ============================================================
--  ALTER STATEMENTS FOR EXISTING DATABASES
--  (Run these if you already have data and cannot DROP+recreate)
--  Safe to run multiple times thanks to IF NOT EXISTS.
-- ============================================================

-- Step 1: Create the note_groups table (new — did not exist before)
CREATE TABLE IF NOT EXISTS public.note_groups (
  id                       UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  title                    TEXT        NOT NULL DEFAULT '',
  color                    TEXT        NOT NULL DEFAULT 'none',
  is_pinned                BOOLEAN     NOT NULL DEFAULT FALSE,
  priority                 TEXT        NOT NULL DEFAULT 'none'
                                       CHECK (priority IN ('none','low','medium','high')),
  alert_at                 TIMESTAMPTZ,
  reminder_interval_value  INTEGER,
  reminder_interval_unit   TEXT        CHECK (reminder_interval_unit IN ('minutes','hours','days')),
  notification_id          TEXT,
  sort_order               INTEGER     NOT NULL DEFAULT 0,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Step 2: Add new columns to the existing notes table
ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS is_completed             BOOLEAN  NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS priority                 TEXT     NOT NULL DEFAULT 'none'
                                                             CHECK (priority IN ('none','low','medium','high')),
  ADD COLUMN IF NOT EXISTS sort_order               INTEGER  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS group_id                 UUID     REFERENCES public.note_groups(id) ON DELETE SET NULL;

-- Step 3: Add triggers, indexes, and RLS for the new table
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_note_groups_updated_at') THEN
    CREATE TRIGGER trg_note_groups_updated_at
      BEFORE UPDATE ON public.note_groups
      FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notes_group_id    ON public.notes(group_id);
CREATE INDEX IF NOT EXISTS idx_notes_sort_order  ON public.notes(sort_order);
CREATE INDEX IF NOT EXISTS idx_note_groups_sort  ON public.note_groups(sort_order);

ALTER TABLE public.note_groups ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'note_groups' AND policyname = 'anon full access'
  ) THEN
    CREATE POLICY "anon full access" ON public.note_groups FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
-- ============================================================
--  End of ALTER section
-- ============================================================
