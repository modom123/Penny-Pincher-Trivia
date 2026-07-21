-- Ties AI question-generation spend to actual tournament revenue: a slice of
-- each completed game's house cut (admin_revenue_pool_cents) funds an
-- internal "content budget" that auto-curate-questions spends down. No
-- tournaments played yet = no budget yet = the automatic schedule generates
-- nothing yet; the more real games complete, the more the bank gets filled.
--
-- Note on what this actually is: it does not literally pay Anthropic's
-- invoice per API call - that's normal account billing, paid the usual way.
-- This is an internal accounting gate so the SYSTEM never authorizes more
-- automatic generation than the house has actually earned to cover
-- (est_cost_cents_per_call is a configurable estimate, not a live cost feed -
-- tune it against your real Anthropic invoice after a few runs).
insert into public.platform_config (key, value) values
  ('content_budget_cents', '0'::jsonb),
  ('content_budget_skim_bps', '1000'::jsonb),              -- 10% of a completed game's admin_revenue_pool_cents
  ('content_budget_est_cost_cents_per_call', '10'::jsonb)   -- rough placeholder estimate per Anthropic call
on conflict (key) do nothing;

create or replace function public.fund_content_budget_on_completion()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_skim_bps int;
  v_credit int;
begin
  select coalesce((value #>> '{}')::int, 1000) into v_skim_bps
  from public.platform_config where key = 'content_budget_skim_bps';
  v_skim_bps := coalesce(v_skim_bps, 1000);

  v_credit := round(new.admin_revenue_pool_cents * v_skim_bps / 10000.0);
  if v_credit > 0 then
    update public.platform_config
      set value = to_jsonb(coalesce((value #>> '{}')::int, 0) + v_credit), updated_at = now()
      where key = 'content_budget_cents';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_games_fund_content_budget on public.games;
create trigger trg_games_fund_content_budget
  after update of status on public.games
  for each row
  when (new.status = 'completed' and old.status is distinct from 'completed')
  execute function public.fund_content_budget_on_completion();

-- Trigger-only implementation detail (returns trigger, can't be invoked
-- directly anyway) - revoke the RPC surface Postgres grants by default.
revoke execute on function public.fund_content_budget_on_completion() from public, anon, authenticated;

-- Staff-facing: current budget + settings, for the Command Center Auto-Curate card.
create or replace function public.content_budget_status()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_budget int; v_skim int; v_cost int;
begin
  if not public.is_staff(array['admin','support','content_editor']) then
    raise exception 'Forbidden: staff access required';
  end if;
  select coalesce((value #>> '{}')::int, 0) into v_budget from public.platform_config where key = 'content_budget_cents';
  select coalesce((value #>> '{}')::int, 1000) into v_skim from public.platform_config where key = 'content_budget_skim_bps';
  select coalesce((value #>> '{}')::int, 10) into v_cost from public.platform_config where key = 'content_budget_est_cost_cents_per_call';
  return jsonb_build_object(
    'budgetCents', coalesce(v_budget, 0),
    'skimBps', coalesce(v_skim, 1000),
    'estCostCentsPerCall', coalesce(v_cost, 10),
    'affordableCalls', floor(coalesce(v_budget, 0)::numeric / greatest(coalesce(v_cost, 10), 1))
  );
end;
$$;
revoke execute on function public.content_budget_status() from public, anon;
grant execute on function public.content_budget_status() to authenticated;

create or replace function public.admin_update_content_budget_settings(p_skim_bps int, p_est_cost_cents_per_call int)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_staff(array['admin']) then
    raise exception 'Forbidden: staff access required';
  end if;
  if p_skim_bps is not null then
    update public.platform_config set value = to_jsonb(greatest(least(p_skim_bps, 10000), 0)), updated_at = now()
    where key = 'content_budget_skim_bps';
  end if;
  if p_est_cost_cents_per_call is not null then
    update public.platform_config set value = to_jsonb(greatest(p_est_cost_cents_per_call, 1)), updated_at = now()
    where key = 'content_budget_est_cost_cents_per_call';
  end if;
  perform public.log_admin_action('update_content_budget_settings', null, null,
    jsonb_build_object('skimBps', p_skim_bps, 'estCostCentsPerCall', p_est_cost_cents_per_call));
end;
$$;
revoke execute on function public.admin_update_content_budget_settings(int, int) from public, anon;
grant execute on function public.admin_update_content_budget_settings(int, int) to authenticated;

-- Service-role: atomically debit the budget after a curation run spends calls.
create or replace function public.debit_content_budget(p_cents int)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  v_new int;
begin
  update public.platform_config
    set value = to_jsonb(greatest(coalesce((value #>> '{}')::int, 0) - greatest(p_cents, 0), 0)), updated_at = now()
    where key = 'content_budget_cents'
    returning (value #>> '{}')::int into v_new;
  return v_new;
end;
$$;
revoke execute on function public.debit_content_budget(int) from public, anon, authenticated;
grant execute on function public.debit_content_budget(int) to service_role;
