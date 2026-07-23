-- 7-state launch allowlist (docs/LAUNCH-PLAN-7-STATES.md, Phase 3 set).
--
-- Reseeds allowed_states from the earlier 5-state engineering default
-- (TX, CA, NY, OH, PA) to the 7-state launch set: CA, TX, OH, PA, MA, NJ, VA.
--
-- NY is REMOVED from the default: legal/01-state-restrictions.md flags it as a
-- registration/bonding regime, historically contentious for DFS-style products.
-- It moves to a later, counsel-led wave. MA, NJ, VA are added as commonly-included
-- skill-contest states.
--
-- This remains an ENGINEERING DEFAULT, not a legal clearance. No state is live
-- until counsel confirms it in writing (Phase 1 exit gate); staff narrow the list
-- for the Phase-2 soft launch (TX, CA) and edit it any time from the Command
-- Center Compliance page (admin_update_allowed_states) with no app release.

insert into public.platform_config (key, value)
values ('allowed_states', '["CA","TX","OH","PA","MA","NJ","VA"]'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();
