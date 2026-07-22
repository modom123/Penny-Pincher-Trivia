-- Math Problems already existed (added earlier), and Riddles is already
-- covered by the existing "Puzzles & Riddles" subject - skipped both to
-- avoid duplicates. Inventions is new.
insert into public.subjects (slug, name, domain, sort_order) values
  ('inventions', 'Inventions', 'Science & Nature', 1010)
on conflict (slug) do nothing;
