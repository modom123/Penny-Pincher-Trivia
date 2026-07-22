insert into public.subjects (slug, name, domain, sort_order) values
  ('spelling', 'Spelling', 'Language & Words', 1011),
  ('measurements', 'Measurements', 'Mathematics & Logic', 1012),
  ('building-materials', 'Building Materials', 'Art & Architecture', 1013)
on conflict (slug) do nothing;
