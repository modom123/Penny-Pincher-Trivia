-- Round timer: make 10s the standard question time limit (was 12s).
--
-- start_round reads each round's timer from the question row
-- (coalesce(game_rounds.time_limit_override_seconds, questions.time_limit_seconds)),
-- so this both lowers the default for newly created questions and migrates the
-- existing bank off the old 12s default. Overtime overrides are untouched.

alter table public.questions alter column time_limit_seconds set default 10;

-- Migrate rows still on the previous default; leaves any intentional custom
-- value in place.
update public.questions set time_limit_seconds = 10 where time_limit_seconds = 12;
