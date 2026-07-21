-- Requested topics for question curation. Fishing and Automobiles already
-- existed in the 1000-subject seed (Games/Hobbies and Transportation
-- domains respectively) - skipped here to avoid duplicates. The rest are new.
insert into public.subjects (slug, name, domain, sort_order) values
  ('super-bowl', 'Super Bowl', 'Sports', 1001),
  ('world-series', 'World Series', 'Sports', 1002),
  ('kentucky-derby', 'Kentucky Derby', 'Sports', 1003),
  ('camping', 'Camping', 'Games, Hobbies & Curiosities', 1004),
  ('math-problems', 'Math Problems', 'Mathematics & Logic', 1005),
  ('animals', 'Animals', 'Animals & Wildlife', 1006)
on conflict (slug) do nothing;
