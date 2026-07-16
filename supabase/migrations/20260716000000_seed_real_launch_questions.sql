-- Replace the 100 placeholder trivia rows with real, difficulty-scaled content.
--
-- WHY: live games are built by public.create_game(), which fills rounds 1..100 by
-- picking one question per difficulty_level (1..100) from public.questions. Until
-- now that pool was the seed from 20260706090500 -- literal "Option A for round N"
-- placeholders -- so every auto-scheduled tournament served fake questions. That is
-- the #1 real-money launch blocker.
--
-- WHAT: this overwrites each placeholder row IN PLACE (keyed on difficulty_level and
-- matching the placeholder text), so:
--   * question_id is preserved -> no FK breakage with historical game_rounds.
--   * only rows still carrying the placeholder text are touched -> any question a
--     staff member already hand-authored via the command center is left untouched.
--   * re-running is a no-op (the placeholder text no longer matches after the first
--     apply), and on a fresh DB it runs after the placeholder seed and upgrades it.
--
-- SAFETY / REVIEW: these questions are AI-authored general-knowledge trivia with
-- deliberately unambiguous, well-established answers, difficulty rising from ~3rd
-- grade (round 1) to expert (round 100). They are a real starting bank, NOT a
-- substitute for the human fact-check the platform's safety model calls for. Before
-- real-money play, staff should still spot-review them on the command center's
-- Question Bank page (each is editable there). To grow cross-game variety, add more
-- rows per difficulty_level (create_game picks one at random per level) or run the
-- Trivia Alchemist generator, review, and promote.

with real_q(lvl, qtext, a, b, c, d, correct, cat) as (
  values
  (1, 'How many days are in a week?', 'Five', 'Seven', 'Six', 'Eight', 'B', 'General Knowledge'),
  (2, 'What color do you get by mixing blue and yellow?', 'Green', 'Purple', 'Orange', 'Brown', 'A', 'Science'),
  (3, 'Which animal is commonly known as "man''s best friend"?', 'Cat', 'Dog', 'Horse', 'Rabbit', 'B', 'General Knowledge'),
  (4, 'How many legs does a spider have?', 'Eight', 'Six', 'Ten', 'Four', 'A', 'Science'),
  (5, 'What is 5 + 7?', '10', '11', '12', '13', 'C', 'Math'),
  (6, 'Which planet do we live on?', 'Earth', 'Venus', 'Mars', 'Jupiter', 'A', 'Science'),
  (7, 'What do bees make?', 'Milk', 'Honey', 'Silk', 'Butter', 'B', 'Science'),
  (8, 'How many sides does a triangle have?', 'Two', 'Three', 'Four', 'Five', 'B', 'Math'),
  (9, 'What is the opposite of "hot"?', 'Warm', 'Cold', 'Damp', 'Loud', 'B', 'General Knowledge'),
  (10, 'Which fruit is yellow and curved?', 'Banana', 'Apple', 'Grape', 'Cherry', 'A', 'General Knowledge'),
  (11, 'What is 9 times 3?', '24', '21', '27', '18', 'C', 'Math'),
  (12, 'What gas do humans need to breathe to stay alive?', 'Hydrogen', 'Helium', 'Neon', 'Oxygen', 'D', 'Science'),
  (13, 'How many continents are there on Earth?', 'Five', 'Seven', 'Six', 'Eight', 'B', 'Geography'),
  (14, 'What is the capital of the United States?', 'New York', 'Los Angeles', 'Washington, D.C.', 'Chicago', 'C', 'Geography'),
  (15, 'Which season comes right after winter?', 'Spring', 'Summer', 'Autumn', 'Monsoon', 'A', 'General Knowledge'),
  (16, 'What is the largest land animal alive today?', 'Giraffe', 'African elephant', 'Rhinoceros', 'Hippopotamus', 'B', 'Science'),
  (17, 'What is 100 divided by 4?', '25', '20', '30', '40', 'A', 'Math'),
  (18, 'Which is the largest ocean on Earth?', 'Atlantic', 'Indian', 'Arctic', 'Pacific', 'D', 'Geography'),
  (19, 'How many minutes are in one hour?', '30', '45', '60', '100', 'C', 'General Knowledge'),
  (20, 'What do you call water that has frozen solid?', 'Steam', 'Rain', 'Ice', 'Fog', 'C', 'Science'),
  (21, 'Who wrote the play "Romeo and Juliet"?', 'William Shakespeare', 'Charles Dickens', 'Mark Twain', 'Jane Austen', 'A', 'Literature'),
  (22, 'What is the chemical formula for water?', 'O2', 'H2O', 'CO2', 'NaCl', 'B', 'Science'),
  (23, 'Which country is the native home of the kangaroo?', 'India', 'Brazil', 'Australia', 'Canada', 'C', 'Geography'),
  (24, 'What is 12 times 12?', '124', '154', '122', '144', 'D', 'Math'),
  (25, 'How many colors are traditionally counted in a rainbow?', 'Seven', 'Six', 'Five', 'Nine', 'A', 'Science'),
  (26, 'What is the tallest living animal in the world?', 'Elephant', 'Camel', 'Horse', 'Giraffe', 'D', 'Science'),
  (27, 'Which planet is known as the "Red Planet"?', 'Venus', 'Saturn', 'Jupiter', 'Mars', 'D', 'Science'),
  (28, 'What is the freezing point of water in degrees Celsius?', '0', '10', '32', '100', 'A', 'Science'),
  (29, 'Who painted the "Mona Lisa"?', 'Vincent van Gogh', 'Pablo Picasso', 'Leonardo da Vinci', 'Claude Monet', 'C', 'Pop Culture'),
  (30, 'What is the capital of France?', 'Paris', 'Berlin', 'Madrid', 'London', 'A', 'Geography'),
  (31, 'How many players from one team are on the field in a standard soccer match?', 'Nine', 'Ten', 'Twelve', 'Eleven', 'D', 'Sports'),
  (32, 'What is the largest planet in our solar system?', 'Saturn', 'Neptune', 'Jupiter', 'Earth', 'C', 'Science'),
  (33, 'In which country would you find the Eiffel Tower?', 'Italy', 'France', 'Spain', 'Germany', 'B', 'Geography'),
  (34, 'What is 15 percent of 200?', '20', '30', '40', '15', 'B', 'Math'),
  (35, 'Which metal is liquid at room temperature?', 'Mercury', 'Iron', 'Gold', 'Copper', 'A', 'Science'),
  (36, 'Who was the first President of the United States?', 'Abraham Lincoln', 'Thomas Jefferson', 'John Adams', 'George Washington', 'D', 'History'),
  (37, 'What is the hardest known natural material?', 'Diamond', 'Iron', 'Gold', 'Quartz', 'A', 'Science'),
  (38, 'What language is most widely spoken in Brazil?', 'Portuguese', 'Spanish', 'French', 'English', 'A', 'Geography'),
  (39, 'What is the square root of 81?', '7', '8', '9', '11', 'C', 'Math'),
  (40, 'Which planet is closest to the Sun?', 'Earth', 'Venus', 'Mars', 'Mercury', 'D', 'Science'),
  (41, 'What is the smallest prime number?', '2', '1', '0', '3', 'A', 'Math'),
  (42, 'Who developed the theory of general relativity?', 'Isaac Newton', 'Albert Einstein', 'Galileo Galilei', 'Nikola Tesla', 'B', 'Science'),
  (43, 'What is the capital of Japan?', 'Beijing', 'Tokyo', 'Seoul', 'Bangkok', 'B', 'Geography'),
  (44, 'How many bones are in the adult human body?', '206', '106', '306', '406', 'A', 'Science'),
  (45, 'Which gas makes up the greatest share of Earth''s atmosphere?', 'Oxygen', 'Carbon dioxide', 'Hydrogen', 'Nitrogen', 'D', 'Science'),
  (46, 'Who wrote "Pride and Prejudice"?', 'Charlotte Bronte', 'Mary Shelley', 'Emily Dickinson', 'Jane Austen', 'D', 'Literature'),
  (47, 'What is the official currency of Japan?', 'Yen', 'Won', 'Yuan', 'Ringgit', 'A', 'General Knowledge'),
  (48, 'What is the value of 7 factorial (7!)?', '40320', '720', '5040', '4050', 'C', 'Math'),
  (49, 'In what year did World War II end?', '1943', '1947', '1945', '1950', 'C', 'History'),
  (50, 'What is the chemical symbol for gold?', 'Gd', 'Ag', 'Au', 'Go', 'C', 'Science'),
  (51, 'Which organelle is often called "the powerhouse of the cell"?', 'Nucleus', 'Ribosome', 'Mitochondrion', 'Golgi apparatus', 'C', 'Science'),
  (52, 'Who wrote the novel "1984"?', 'Aldous Huxley', 'H. G. Wells', 'Ray Bradbury', 'George Orwell', 'D', 'Literature'),
  (53, 'What is the capital of Canada?', 'Toronto', 'Ottawa', 'Vancouver', 'Montreal', 'B', 'Geography'),
  (54, 'What is the value of pi rounded to two decimal places?', '3.12', '3.41', '3.16', '3.14', 'D', 'Math'),
  (55, 'Which element has the atomic number 1?', 'Hydrogen', 'Helium', 'Oxygen', 'Carbon', 'A', 'Science'),
  (56, 'In Greek mythology, who is the king of the gods?', 'Poseidon', 'Zeus', 'Hades', 'Apollo', 'B', 'History'),
  (57, 'Which planet has the hottest surface temperature in our solar system?', 'Venus', 'Mercury', 'Mars', 'Jupiter', 'A', 'Science'),
  (58, 'Who composed the Ninth Symphony that includes the "Ode to Joy"?', 'Mozart', 'Beethoven', 'Bach', 'Chopin', 'B', 'Music'),
  (59, 'What is 2 raised to the power of 10?', '512', '1024', '1000', '2048', 'B', 'Math'),
  (60, 'What is the scientific study of living organisms called?', 'Biology', 'Chemistry', 'Geology', 'Physics', 'A', 'Science'),
  (61, 'What is the capital of Australia?', 'Sydney', 'Melbourne', 'Canberra', 'Perth', 'C', 'Geography'),
  (62, 'Which scientist is famously associated with formulating the law of universal gravitation?', 'Newton', 'Einstein', 'Galileo', 'Copernicus', 'A', 'Science'),
  (63, 'What is the chemical symbol for sodium?', 'Na', 'So', 'Sd', 'S', 'A', 'Science'),
  (64, 'In which year did the RMS Titanic sink?', '1905', '1918', '1912', '1923', 'C', 'History'),
  (65, 'What is the largest organ of the human body?', 'Liver', 'Brain', 'Heart', 'Skin', 'D', 'Science'),
  (66, 'Who is the ancient Greek poet traditionally credited with "The Odyssey"?', 'Sophocles', 'Virgil', 'Homer', 'Plato', 'C', 'Literature'),
  (67, 'What is the derivative of x squared with respect to x?', 'x', 'x squared over 2', '2x', '2', 'C', 'Math'),
  (68, 'Which planet is famous for its prominent, visible ring system?', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'B', 'Science'),
  (69, 'What is the capital of Russia?', 'Saint Petersburg', 'Kyiv', 'Minsk', 'Moscow', 'D', 'Geography'),
  (70, 'The speed of light in a vacuum is approximately how fast?', '3,000 km/s', '30,000 km/s', '300,000 km/s', '300 km/s', 'C', 'Science'),
  (71, 'Who painted "The Starry Night"?', 'Claude Monet', 'Pablo Picasso', 'Vincent van Gogh', 'Rembrandt', 'C', 'Pop Culture'),
  (72, 'What is the smallest country in the world by land area?', 'Monaco', 'San Marino', 'Vatican City', 'Nauru', 'C', 'Geography'),
  (73, 'What is the atomic number of carbon?', '4', '12', '8', '6', 'D', 'Science'),
  (74, 'The American Civil War was fought primarily between which two sides?', 'Britain and France', 'East and West', 'North and South', 'Union and Mexico', 'C', 'History'),
  (75, 'What is the sum of the interior angles of a triangle?', '90 degrees', '360 degrees', '270 degrees', '180 degrees', 'D', 'Math'),
  (76, 'What is the most abundant chemical element in the universe?', 'Oxygen', 'Helium', 'Carbon', 'Hydrogen', 'D', 'Science'),
  (77, 'Who wrote the novel "Crime and Punishment"?', 'Leo Tolstoy', 'Fyodor Dostoevsky', 'Anton Chekhov', 'Ivan Turgenev', 'B', 'Literature'),
  (78, 'What is the indefinite integral of 1/x with respect to x?', 'e^x + C', 'x^2/2 + C', '-1/x^2 + C', 'ln|x| + C', 'D', 'Math'),
  (79, 'In which country are the ancient Pyramids of Giza located?', 'Sudan', 'Iraq', 'Mexico', 'Egypt', 'D', 'History'),
  (80, 'Which subatomic particle carries a negative electric charge?', 'Electron', 'Neutron', 'Proton', 'Photon', 'A', 'Science'),
  (81, 'Who formulated the three laws of planetary motion?', 'Copernicus', 'Johannes Kepler', 'Tycho Brahe', 'Galileo', 'B', 'Science'),
  (82, 'What is the capital of South Korea?', 'Pyongyang', 'Osaka', 'Busan', 'Seoul', 'D', 'Geography'),
  (83, 'What is the value of the mathematical constant e, to two decimal places?', '2.52', '2.68', '2.72', '2.81', 'C', 'Math'),
  (84, 'Which blood type is known as the universal red-cell donor?', 'O negative', 'AB positive', 'A positive', 'B negative', 'A', 'Science'),
  (85, 'Who wrote the epic poem "The Divine Comedy"?', 'Petrarch', 'Dante Alighieri', 'Giovanni Boccaccio', 'Niccolo Machiavelli', 'B', 'Literature'),
  (86, 'What is the chemical formula for common table salt?', 'NaCl', 'KCl', 'CaCO3', 'HCl', 'A', 'Science'),
  (87, 'In economics, what does the abbreviation GDP stand for?', 'General Domestic Price', 'Gross Domestic Product', 'Global Data Point', 'Gross Detailed Payment', 'B', 'General Knowledge'),
  (88, 'What is the largest prime number below 20?', '17', '18', '13', '19', 'D', 'Math'),
  (89, 'Who is credited with discovering penicillin in 1928?', 'Louis Pasteur', 'Robert Koch', 'Joseph Lister', 'Alexander Fleming', 'D', 'Science'),
  (90, 'What is the SI base unit of electric current?', 'Volt', 'Ampere', 'Watt', 'Ohm', 'B', 'Science'),
  (91, 'Which ancient philosopher wrote the dialogue "The Republic"?', 'Aristotle', 'Plato', 'Socrates', 'Descartes', 'B', 'History'),
  (92, 'What is the derivative of sin(x) with respect to x?', 'tan(x)', '-cos(x)', '-sin(x)', 'cos(x)', 'D', 'Math'),
  (93, 'Which element is the most electronegative on the periodic table?', 'Oxygen', 'Nitrogen', 'Chlorine', 'Fluorine', 'D', 'Science'),
  (94, 'In what year did the Berlin Wall fall?', '1987', '1991', '1989', '1993', 'C', 'History'),
  (95, 'Avogadro''s number is approximately equal to which value?', '6.02 x 10^23', '3.14 x 10^23', '9.81 x 10^23', '1.60 x 10^19', 'A', 'Science'),
  (96, 'Whose incompleteness theorems proved that any sufficiently powerful formal system contains true statements it cannot prove?', 'Alan Turing', 'Kurt Godel', 'David Hilbert', 'Bertrand Russell', 'B', 'Math'),
  (97, 'What is the chemical symbol for potassium?', 'P', 'K', 'Po', 'Pt', 'B', 'Science'),
  (98, 'Protons and neutrons are each composed of which more fundamental particles?', 'Electrons', 'Photons', 'Quarks', 'Neutrinos', 'C', 'Science'),
  (99, 'What is the indefinite integral of e^x with respect to x?', 'ln(x) + C', 'x*e^x + C', 'e^x + C', 'e^(x+1) + C', 'C', 'Math'),
  (100, 'Einstein''s equation E = mc^2 expresses the equivalence of which two quantities?', 'Pressure and volume', 'Force and acceleration', 'Voltage and current', 'Energy and mass', 'D', 'Science')
)
update public.questions q
set question_text  = r.qtext,
    options        = jsonb_build_object('A', r.a, 'B', r.b, 'C', r.c, 'D', r.d),
    correct_option = r.correct,
    category       = r.cat
from real_q r
where q.difficulty_level = r.lvl
  and q.question_text like '%replace with real content%';
