-- Requested topics. Baseball, Football (both Association and American), The
-- FIFA World Cup, and Dinosaurs already existed in the subject taxonomy -
-- skipped here to avoid duplicates. Painters, Movies (a general catch-all
-- alongside the many specific Film & Cinema subtopics already seeded), and
-- Billboard Hot 100 (the chart's actual name - there's no "Top 100") are new.
insert into public.subjects (slug, name, domain, sort_order) values
  ('painters', 'Painters', 'Art & Architecture', 1007),
  ('movies', 'Movies', 'Film & Cinema', 1008),
  ('billboard-hot-100', 'Billboard Hot 100', 'Music', 1009)
on conflict (slug) do nothing;
