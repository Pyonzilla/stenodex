# StenoDex V7.07
https://pyonzilla.github.io/stenodex/

Web app for searching, visualizing and practicing Plover's custom stenography dictionaries.

## Features
* Look up entries by translation or by raw steno strokes.
* Visualizer that shows exactly where your fingers go.
* Remap the visualizer to match your physical keyboard (includes support for extra left columns and extra thumb clusters).
* Highlight diagram keys by their configured labels, including custom letters and symbols, while distinguishing identical left- and right-hand keys using stroke-side markers and diagram position.
* Manage up to 5 independent dictionary profiles for multilingual stenographers or switching between theories.
* 44 built-in color themes, including Monke, Blue, and Shrimp, plus a per-profile custom color picker.
* Practice full sentenses using your dictionary as reference, plover clippy tape or material in typey type format, in order, random and pyramid patterns.
* Practice input preserves typed spaces and edits, including one-at-a-time deletion and mobile input fallback for whitespace omitted from input events; tolerates leading spaces emitted by steno machines; keeps partial-word letters when extra spaces are typed after them; keeps the next word selected when backspacing its separator; completes words as soon as they match but advances only after the separating space; treats unexpected spaces as wrong character positions; recognizes Unicode whitespace; validates punctuation spacing; advances cleanly at quote boundaries; scrolls by line only when the active word changes, keeping it near the second visible line while avoiding reflow jumps, stopping when the remaining text fits, and preserving position across virtualized window changes.
* Practice stroke counts include deletion and correction strokes and are attributed to the word active when each stroke begins.
* Ignore Capitalization accepts either letter case without changing the displayed target or typed text; practice input is parsed from the complete text value to handle batched and case-changing keyboard events safely.
* Blind practice hides all untyped words, not only the active word.
* Practice text supports accented and other Unicode letters, punctuation, and symbols.
* Practice quote, timed, quote-count, endless word-count, and daily goals that require both a quote target and a word target. Unrestricted Words draws individual random words from the selected language; Scrambled Words shuffles the words from successive quotes into one continuous exercise, omitting punctuation and numbers.
* Center the practice mode toolbar controls, including word order, target stroke form, and stroke visibility; these controls are hidden for Jeff Phrasing, and estimates reflect the selected practice mode.
* Practice generated numbers with a random digit count from one up to the selected maximum, as numerals, words, or a mix; practice standard English keyboard symbols in generated sequences.
* Choose Endless from the count selector for quote-count, word, number, symbol, Jeff Phrasing, problematic-word, or brief practice; items load in small batches, completed text is removed, and session statistics are retained. Endless quote practice keeps five quotes queued for seamless transitions, and Endless problematic-word and brief practice recycle the session's list snapshot as needed.
* Practice generated Jeff-style simple or full phrases, with text and outlines matching the reference's phrase rules, including special verb forms, restricted there-starter endings, and strokes reserved for other phrases.
* Set daily targets for quotes, words, Jeff phrases, number groups, symbols, problematic words, briefs, and practice sections completed above 95% accuracy; quote practice counts each word, punctuation mark, and numeral toward the word goal, while spelled-out numbers count as number groups only in Numbers mode. Goals display in a two-column grid, and setting a target to zero marks it skipped and complete.
* Use the Daily Practice Goal button to launch the next incomplete goal's mode; above-95% accuracy goals launch quote practice.
* Navigate the main views and search-mode menu with the keyboard; use `/` to focus dictionary search and Escape to close profile options.
* Use thin, theme-aware scrollbars across the page, quote history, and other scrollable panels.
* Count stroke attempts from debounced input snapshots, attributing each stroke to its active target; calculate strokes per word unit so a single stroke entering multiple words is shared across them.
* Calculate practice accuracy from completed words and stroke-limit misses, not temporary in-progress text mismatches; using fewer than or exactly the selected target strokes remains correct.
* Allow intermediate steno translations to be corrected by later strokes without counting them as wrong before the selected stroke limit is reached.
* Quote mode shows results after each quote; daily-goal practice advances to the next quote automatically and continues after the goal is reached.
* Quote-count exercises automatically advance between quotes; press Enter during practice to restart the selected exercise mode with new material.
* Track personal speed milestones from 10 to 250 WPM, with larger milestone steps above 100 WPM.
* Keep track of practice days, quote history, mode records, and individual built-in lesson records.
* Compare 30-day speed, accuracy, stroke efficiency, and daily volume across eight practice categories in a responsive skill chart.
* View per-quote WPM, accuracy, strokes per word, and word count in recent quote history.
* Keep practice totals and averages together on the dashboard, with separate expandable lists for problematic words and briefs.
* Keep mode and test settings plus custom material and steno options above daily-goal and typist-average dashboard insights.
* Keep Search and Practice navigation in the header to make more room for practice text and stroke diagrams.
* Use distinct theme-aware colors for problematic words and briefs during practice; customize, save, and export both colors per profile.
* Use gentle, distinct audio feedback for correct and incorrect typing.
* Speech and blind mode announce each upcoming word or complete phrase as it becomes the active practice item.
* In blind mode, quote-based tests speak each complete quote once when it becomes active, then wait for its completion before announcing the next quote.
* Choose a lesson or practice material in lesson mode, and identify brief and problematic words by color while typing.
* Customize complete per-profile color palettes, including practice feedback and live-stat colors.
* Export and import profile settings, custom colors, practice history, goals, and statistics; older export versions remain supported.
* Keep lessons, their completion statistics, and random/ordered pyramid practice modes available in practice mode; custom material and steno options remain grouped in expandable settings.
* Keep track of your progress over time.
* Keep track of your problematic words and a list of your briefs, that way you can isolate tricky words and finaly learn them.
* Set repetitions, word ranges, maximum words, and include problematic words or your briefs into your practice material.
* Import and export profile settings and practice data (please backup your progress and settings regularly).
* Save custom study material for future use.

* All data parsing and storage is handled locally on your device.



I created this tool mainly so I could check my dictionaries offline straight from my phone, but I have been addying features over time to improve my steno practice sessions.

## Mobile Installation (Offline Use)
This tool is built as a Progressive Web App (PWA). You can install it directly to your phone to use it like a native app, completely offline.

**Android (Chrome):**
1. Open the site in Chrome.
2. Tap the **three-dot menu** in the top right.
3. Select **Add to Home screen** (or **Install app**).

**iOS (Safari):**
1. Open the site in Safari.
2. Tap the **Share icon** at the bottom center.
3. Scroll down and tap **Add to Home Screen**.

Since this tool was built with AI assistance, I can't guarantee it will always work.
