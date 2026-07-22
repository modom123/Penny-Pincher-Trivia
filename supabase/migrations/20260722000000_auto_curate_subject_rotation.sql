-- Tracks where auto-curate-questions' round-robin subject scan left off, so
-- consecutive runs spread across the whole subject taxonomy instead of every
-- run restarting at the first subject in sort_order (see the edge function
-- for why that starved every subject after the first).
insert into public.platform_config (key, value)
values ('auto_curate_cursor_sort_order', '-1'::jsonb)
on conflict (key) do nothing;
