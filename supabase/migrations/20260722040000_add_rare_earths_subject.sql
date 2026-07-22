-- Periodic Table, Cooking, and Baking already existed ("The Periodic Table",
-- "Cooking Techniques", "Baking & Pastry"/"Bread & Baking") - skipped to
-- avoid duplicates. Rare Earths (the specific element group) is new.
insert into public.subjects (slug, name, domain, sort_order) values
  ('rare-earth-elements', 'Rare Earth Elements', 'Science & Nature', 1014)
on conflict (slug) do nothing;
