-- Adds `system_prompt` and `prompt_strategy` columns to `model_aliases`.
--
-- Why: enables virtual model routing via prompt substrate injection
-- (e.g. `mimo-26-jb` -> `mimo-v2.6-flash` with prepended system instructions or `@file:` references).
--
-- Idempotent: safe to run more than once.
ALTER TABLE model_aliases ADD COLUMN IF NOT EXISTS system_prompt TEXT;
ALTER TABLE model_aliases ADD COLUMN IF NOT EXISTS prompt_strategy TEXT DEFAULT 'prepend';
