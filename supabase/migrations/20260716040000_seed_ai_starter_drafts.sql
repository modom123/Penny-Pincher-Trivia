-- AI-generated starter questions across the requested subjects, inserted as
-- review-ready DRAFTS (pending_review, generated_by = 'ai'). This is a concrete
-- sample of what the Trivia Alchemist generator produces at scale -- staff approve
-- them in the command center (promote_question_draft) and they enter the live pool
-- that games draw from. category = subject; difficulty_level is spread 1..100.
--
-- These are AI-authored with well-established answers; a human spot-check before
-- real-money play is still the safety step. Guarded so re-running won't duplicate.

insert into public.question_drafts
  (question_text, options, correct_option, difficulty_level, category, generated_by, status)
select v.q, v.opts, v.correct, v.lvl, v.cat, 'ai', 'pending_review'
from (values
  -- Geography
  ('Which is the largest hot desert in the world?', '{"A":"Gobi","B":"Sahara","C":"Kalahari","D":"Mojave"}'::jsonb, 'B', 25, 'Geography'),
  ('Mount Kilimanjaro, the highest mountain in Africa, lies in which country?', '{"A":"Kenya","B":"Ethiopia","C":"Uganda","D":"Tanzania"}'::jsonb, 'D', 40, 'Geography'),
  ('Which river is the longest in the world (traditional measure)?', '{"A":"Nile","B":"Yangtze","C":"Amazon","D":"Mississippi"}'::jsonb, 'A', 35, 'Geography'),
  -- Sports
  ('How many players from one team are on the court in standard basketball?', '{"A":"Five","B":"Six","C":"Seven","D":"Nine"}'::jsonb, 'A', 10, 'Sports'),
  ('How often are the Summer Olympic Games normally held?', '{"A":"Every year","B":"Every 2 years","C":"Every 5 years","D":"Every 4 years"}'::jsonb, 'D', 15, 'Sports'),
  ('In tennis, what term describes a score of zero?', '{"A":"Love","B":"Nil","C":"Duck","D":"Blank"}'::jsonb, 'A', 30, 'Sports'),
  -- Wars
  ('The 1944 D-Day landings took place on the beaches of which region?', '{"A":"Flanders","B":"Brittany","C":"Provence","D":"Normandy"}'::jsonb, 'D', 45, 'Wars'),
  ('The Hundred Years War was fought mainly between England and which country?', '{"A":"Spain","B":"France","C":"Scotland","D":"Germany"}'::jsonb, 'B', 40, 'Wars'),
  -- Ancient Civilizations
  ('The Hanging Gardens were said to be in which ancient city?', '{"A":"Babylon","B":"Athens","C":"Memphis","D":"Carthage"}'::jsonb, 'A', 45, 'Ancient Civilizations'),
  ('Which ancient civilization built the mountain city of Machu Picchu?', '{"A":"Maya","B":"Aztec","C":"Olmec","D":"Inca"}'::jsonb, 'D', 35, 'Ancient Civilizations'),
  -- Math
  ('What is 7 times 8?', '{"A":"56","B":"54","C":"48","D":"64"}'::jsonb, 'A', 12, 'Math'),
  ('How many degrees are in a right angle?', '{"A":"45","B":"60","C":"180","D":"90"}'::jsonb, 'D', 8, 'Math'),
  ('What do you call a number divisible only by 1 and itself?', '{"A":"Prime","B":"Even","C":"Square","D":"Rational"}'::jsonb, 'A', 22, 'Math'),
  -- Stem Cells
  ('Stem cells are notable for their ability to develop into many different what?', '{"A":"Minerals","B":"Viruses","C":"Proteins","D":"Cell types"}'::jsonb, 'D', 55, 'Stem Cells'),
  ('Embryonic stem cells are called "pluripotent", meaning they can become?', '{"A":"Only blood cells","B":"Only skin cells","C":"Almost any cell type","D":"No other cells"}'::jsonb, 'C', 68, 'Stem Cells'),
  -- The Romans
  ('Who was the first Roman emperor?', '{"A":"Julius Caesar","B":"Augustus","C":"Nero","D":"Constantine"}'::jsonb, 'B', 45, 'The Romans'),
  ('Which Roman structure was used for gladiator contests?', '{"A":"The Pantheon","B":"The Forum","C":"The Colosseum","D":"Circus Maximus"}'::jsonb, 'C', 20, 'The Romans'),
  -- Greece
  ('Who was the Greek goddess of wisdom?', '{"A":"Hera","B":"Athena","C":"Aphrodite","D":"Artemis"}'::jsonb, 'B', 30, 'Greece'),
  ('Which Greek city-state was famed for its warriors and the stand at Thermopylae?', '{"A":"Athens","B":"Corinth","C":"Sparta","D":"Thebes"}'::jsonb, 'C', 35, 'Greece'),
  -- World Cities ("every city in the world")
  ('In which country is the city of Cairo?', '{"A":"Libya","B":"Morocco","C":"Jordan","D":"Egypt"}'::jsonb, 'D', 15, 'World Cities'),
  ('Buenos Aires is the capital of which country?', '{"A":"Chile","B":"Brazil","C":"Uruguay","D":"Argentina"}'::jsonb, 'D', 25, 'World Cities'),
  ('The city of Mumbai is located in which country?', '{"A":"Pakistan","B":"India","C":"Bangladesh","D":"Sri Lanka"}'::jsonb, 'B', 20, 'World Cities'),
  -- World Politics
  ('How many permanent members does the UN Security Council have?', '{"A":"Seven","B":"Five","C":"Ten","D":"Fifteen"}'::jsonb, 'B', 45, 'World Politics'),
  ('Most European Union member states share which common currency?', '{"A":"Pound","B":"Franc","C":"Euro","D":"Mark"}'::jsonb, 'C', 20, 'World Politics'),
  -- Animals
  ('What is the largest species of big cat?', '{"A":"Lion","B":"Jaguar","C":"Tiger","D":"Leopard"}'::jsonb, 'C', 30, 'Animals'),
  ('Which animal is the fastest over a short sprint on land?', '{"A":"Lion","B":"Cheetah","C":"Pronghorn","D":"Horse"}'::jsonb, 'B', 15, 'Animals'),
  ('A group of lions is known as a what?', '{"A":"Pack","B":"Pride","C":"Herd","D":"Flock"}'::jsonb, 'B', 20, 'Animals'),
  -- Dinosaurs
  ('In which period did Tyrannosaurus rex live?', '{"A":"Jurassic","B":"Triassic","C":"Late Cretaceous","D":"Permian"}'::jsonb, 'C', 45, 'Dinosaurs'),
  ('The name "Triceratops" refers to a face with how many horns?', '{"A":"Three","B":"Two","C":"One","D":"Four"}'::jsonb, 'A', 40, 'Dinosaurs'),
  ('Which plant-eating dinosaur had large bony plates along its back?', '{"A":"Velociraptor","B":"Pterodactyl","C":"Stegosaurus","D":"Allosaurus"}'::jsonb, 'C', 30, 'Dinosaurs'),
  -- Food
  ('Which spice, harvested from a crocus flower, is the most expensive by weight?', '{"A":"Saffron","B":"Cinnamon","C":"Nutmeg","D":"Paprika"}'::jsonb, 'A', 40, 'Food'),
  ('The dish sushi originated in which country?', '{"A":"China","B":"Thailand","C":"Korea","D":"Japan"}'::jsonb, 'D', 15, 'Food'),
  ('What is the main ingredient in traditional guacamole?', '{"A":"Avocado","B":"Pea","C":"Zucchini","D":"Cucumber"}'::jsonb, 'A', 10, 'Food'),
  -- Hunting
  ('What is the practice of hunting with trained birds of prey called?', '{"A":"Angling","B":"Trapping","C":"Coursing","D":"Falconry"}'::jsonb, 'D', 45, 'Hunting'),
  ('In hunting terms, what is a young deer called?', '{"A":"Fawn","B":"Cub","C":"Calf","D":"Kit"}'::jsonb, 'A', 25, 'Hunting'),
  ('What is typically legally required before hunting game in most U.S. states?', '{"A":"A hunting license","B":"A passport","C":"A boating permit","D":"A fishing rod"}'::jsonb, 'A', 15, 'Hunting'),
  -- Automobiles
  ('Which company produces the Mustang car model?', '{"A":"Chevrolet","B":"Ford","C":"Dodge","D":"Toyota"}'::jsonb, 'B', 20, 'Automobiles'),
  ('In cars, what does the abbreviation "EV" stand for?', '{"A":"Extra Value","B":"Electric Vehicle","C":"Engine Volume","D":"Exhaust Valve"}'::jsonb, 'B', 15, 'Automobiles'),
  ('On a car, the RPM gauge measures the revolutions per minute of what?', '{"A":"The wheels","B":"The fan","C":"The engine","D":"The steering"}'::jsonb, 'C', 30, 'Automobiles'),
  -- Trains
  ('What is the name of the high-speed bullet train network in Japan?', '{"A":"Maglev","B":"TGV","C":"Shinkansen","D":"Acela"}'::jsonb, 'C', 40, 'Trains'),
  ('A steam locomotive is powered by burning fuel to boil water into what?', '{"A":"Hydrogen","B":"Oil","C":"Gas","D":"Steam"}'::jsonb, 'D', 25, 'Trains'),
  ('A railway track is traditionally made of two parallel what?', '{"A":"Cables","B":"Beams","C":"Rails","D":"Pipes"}'::jsonb, 'C', 8, 'Trains'),
  -- Skyscrapers
  ('The Burj Khalifa, the tallest building in the world, is located in which city?', '{"A":"Shanghai","B":"Dubai","C":"New York","D":"Kuala Lumpur"}'::jsonb, 'B', 30, 'Skyscrapers'),
  ('The Empire State Building is located in which U.S. city?', '{"A":"Chicago","B":"Los Angeles","C":"Boston","D":"New York City"}'::jsonb, 'D', 15, 'Skyscrapers'),
  ('Which invention was essential to making tall skyscrapers practical for people?', '{"A":"The escalator","B":"The revolving door","C":"The elevator","D":"Air conditioning"}'::jsonb, 'C', 40, 'Skyscrapers'),
  -- Stocks
  ('Owning a share of a company means you own what?', '{"A":"An insurance policy","B":"A loan to the company","C":"The company debt","D":"A small part of the company"}'::jsonb, 'D', 30, 'Stocks'),
  ('On which New York street is the famous stock exchange located?', '{"A":"Main Street","B":"Bay Street","C":"Wall Street","D":"Broad Way"}'::jsonb, 'C', 20, 'Stocks'),
  ('A stock market in which prices are generally rising is called a what?', '{"A":"Short market","B":"Bear market","C":"Flat market","D":"Bull market"}'::jsonb, 'D', 40, 'Stocks'),
  -- Bonds
  ('A bond is essentially which of the following?', '{"A":"An ownership share","B":"A loan to a company or government","C":"A foreign currency","D":"A type of stock option"}'::jsonb, 'B', 45, 'Bonds'),
  ('The regular interest payment made by a bond is commonly called the?', '{"A":"Dividend","B":"Coupon","C":"Premium","D":"Margin"}'::jsonb, 'B', 55, 'Bonds'),
  ('U.S. Treasury bonds are backed by which entity?', '{"A":"The U.S. government","B":"A private bank","C":"The stock market","D":"A foreign country"}'::jsonb, 'A', 35, 'Bonds'),
  -- Forex
  ('Forex trading primarily involves buying and selling what?', '{"A":"Currencies","B":"Stocks","C":"Real estate","D":"Commodities"}'::jsonb, 'A', 40, 'Forex'),
  ('Which currency pair represents the Euro against the U.S. Dollar?', '{"A":"GBP/USD","B":"USD/JPY","C":"EUR/USD","D":"USD/CHF"}'::jsonb, 'C', 50, 'Forex'),
  ('In forex, one currency is exchanged for another at an exchange what?', '{"A":"Rate","B":"Fee","C":"Bond","D":"Share"}'::jsonb, 'A', 25, 'Forex')
) as v(q, opts, correct, lvl, cat)
where not exists (
  select 1 from public.question_drafts d where d.question_text = v.q
);
