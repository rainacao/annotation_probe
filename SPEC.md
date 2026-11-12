# Mini-VLAT Annotation Study

This repository runs a reVISit study that presents the 12 Mini-VLAT items (Pandey & Ottley, 2023) in a fixed sequence, each preceded by a fixation-cross pupil baseline and followed by a NASA-TLX. It collects the Mini-VLAT multiple-choice answer for each chart and saves optional pointer annotations over each chart.

## Run locally

1. Install Node.js 24.15 or later in the Node.js 24 LTS line (`nvm use` reads `.nvmrc`), and Yarn 1 (classic).
2. Copy `.env.example` to `.env`.
3. Run `yarn install --frozen-lockfile`.
4. Run `yarn serve`, then open `http://localhost:8080`.
5. Select **Mini-VLAT Annotation Study** (study id `vlat-graphs`) to preview the participant flow.

Use Yarn, not npm, like upstream reVISit. `yarn.lock` is the only lockfile; don't commit a `package-lock.json`.

Responses are stored in the browser's local storage (`VITE_STORAGE_ENGINE="localStorage"`) during the study and automatically downloaded once as participant JSON when the study is completed.

## Collecting and analyzing data

Data is collected as one participant JSON file per session, from each device.

- **Run on a tablet:** for testing, `yarn serve` on the Mac and open `http://<mac-ip>:8080/vlat-graphs` from a device on the same network (`ipconfig getifaddr en0`). For sessions, `yarn build` and host `dist/` statically, setting `VITE_BASE_PATH` if it is served under a subpath.
- **Get the files:** each session's file is auto-downloaded on the device; on iPad Safari it goes to Files › Downloads. Copy all files into one folder; subfolders per device are fine. reVISit's Analyze & Manage only sees participants stored in that same browser, so it is not used to combine devices.
- **Combine:** `uv run scripts/combine_participants.py <folder> --out <output-folder>` (standard library only). It writes `participants.csv`, `trials.csv` (one row per participant × item: timing, answer, correctness, Skip, fixation baseline including `baseline_actual_ms`, NASA-TLX scales and raw mean, mark counts), `annotation_marks.csv` (one row per mark: start/end, status kept/undone/cleared), and `annotation_points.csv` (one row per point: `t`, image-fraction `x`/`y`, `in_image`, viewport `screen_x`/`screen_y`). Non-participant JSON is skipped with a warning. When one participant appears in several files, the copy with the most answers is kept.
- **QC:** compare `baseline_actual_ms` with `baseline_duration_ms`. Browsers delay timers in background tabs, and two parallel headless test runs once produced a 41.8 s baseline at the same moment (cause not determined; solo runs were 5001–5003 ms).
- **Tests:** `uv run python -m unittest scripts/test_combine_participants.py`. Lint with `uvx ruff check scripts/`; type check with `env -u VIRTUAL_ENV uvx ty check --python "$(uv python find)" scripts/*.py` (the shell's `VIRTUAL_ENV` points at a broken miniconda path).

## Study configuration

- `public/global.json` registers the study.
- `public/annotation-probe/config.json` defines the graph stimulus components, answer fields, and fixed sequence.
- Each Mini-VLAT item `<key>` (for example `treemap`) is a fixed block of `fixation-<key>` → `graph-<key>` → `tlx-<key>`, in the Mini-VLAT library's order. These component IDs are the keys in the participant data.
- Shared settings live once in the `fixation`, `graph`, and `nasa-tlx` `baseComponents`, and reVISit deep-merges them into each component. That covers `durationMs` on `fixation`, plus layout, the answer's `location`/`required`, and the hidden annotation response on `graph`. Each `graph-<key>` holds only that item's content: `parameters.imageUrl`, its `answer` radio (the Mini-VLAT question is the `prompt`, plus `options`), and `correctAnswer`. Items deliberately have no `instruction`, because reVISit renders it as a light box in the sidebar, a bright patch on the grey screen. `fixation-<key>` holds only the same `imageUrl`.
- Why not a factor block: factor levels can only fill strings and `parameters`, not a response's `options` array, and base components can't inherit from other base components. Per-item options therefore need explicit components.
- Item responses must be complete (`id`, `type`, `prompt`, `options`) because reVISit validates components before merging them. The base `answer` keeps `"options": []` for the same reason; an empty base array also guarantees no stale options leak through the index-wise merge.
- To randomize item order, set the top-level `sequence.order` to `latinSquare` (as the upstream Mini-VLAT library does) or `random`. Each item block keeps its three steps together.
- `src/public/annotation-probe/FixationBaseline.tsx` is the pupil baseline. It lays out the upcoming graph invisibly, using the same DOM and CSS as the trial, and draws a black fixation cross at that graph's centre. When the trial loads, the graph replaces the cross at the same point. The baseline auto-advances after `parameters.durationMs`, and the hidden `baseline` response records `crossShownAt`, `crossHiddenAt`, and `durationMs`. `public/annotation-probe/fixation.css` hides the Next button only during fixation, so participants can't end the baseline early.
- `public/annotation-probe/study.css` (`uiConfig.stylesheetPath`) makes the header, sidebar, and main area neutral grey `#808080` (sRGB 128, the midpoint between white and black). The Next button sits in the sidebar (`uiConfig.nextButtonLocation`), so the fixation and graph screens have identical layouts.
- `nasa-tlx` is a raw NASA-TLX questionnaire with six 0–100 sliders in steps of 5, using reVISit's `tlxStyle`. Performance is labelled Good → Poor; the other five scales run Low → High. Each slider has `"default": 0`, so an untouched slider is recorded as 0 and the page can be submitted without clicking; they stay `required`, and the default satisfies that. It shows no sidebar.
- `scripts/smoke-study-flow.mjs` drives fixation → graph → TLX → next fixation in local Chrome while `yarn serve` runs. It prints the cross centre next to the image centre, the time the cross was on screen, and the answer options, and saves screenshots. `scripts/check-stimulus-fit.mjs` walks all 12 items at 1440×900 and 1280×720 and checks that each graph fits inside the stage with its white padding and is centred on the fixation cross. `scripts/check-auto-download.mjs` finishes the study and expects exactly one participant-JSON download. `scripts/check-annotation-events.mjs` draws, undoes, finishes, and prints the saved `annotationEvents`.
- `src/public/annotation-probe/AnnotationTrial.tsx` renders the graph with a transparent pointer-drawing layer and a 24 px drawable margin around each image. The drawable area has a white backdrop. `.annotation-trial` is 70vh tall to match the component's `maxHeight`; the stage takes what is left after the controls row, pads top and bottom by the margin, and caps the image at its content box, so tall charts are never clipped.
- Annotations are saved as the hidden `annotationEvents` response: an append-only log shaped like reVISit `windowEvents`, `[epochMs, action, data]`. `[start, "draw", {end, image: [left, top, width, height], points: [[t, x, y], …]}]` is one mark. `image` is the graph's viewport CSS-px bounds when the mark started. Each point has its own epoch-ms `t`, taken from the pointer event's timestamp (coalesced samples included) on the `Date.now()` clock. `x`/`y` are fractions of the graph image: 0–1 is inside it, and values below 0 or above 1 are in the margin. Screen px = `left + x * width`. `[t, "undo", i]` removes draw event `i`, and `[t, "clear", [i, …]]` removes several. The visible drawing is the replay of this log, so undone marks stay in the data. The same state is tracked with reVISit provenance. Note: reVISit debounces `windowEvents` (100 ms default) and timestamps them when the debounce fires, so a `mousedown` can trail the matching draw `start` by up to ~100 ms; the annotation timestamps are the accurate ones.
- Each image is loaded from the upstream reVISit `public/libraries/mini-vlat/assets/` folder, pinned to commit `0c1cc93`. The PNG files are not copied into this repository.
- To change a stimulus, set `parameters.imageUrl` on both `fixation-<key>` and `graph-<key>`, since the fixation needs it to place the cross. A base component's `path` points to the React component, not the image.
- The Mini-VLAT protocol gives 25 s per item (`nextButtonDisableTime: 25000` in the upstream library). That limit is not applied here; add it to the `graph` base component if you want it.
- Replace `study-contact@example.org` with a contact address before recruiting participants.

Item wording, options, answer keys, and images come from the [reVISit Mini-VLAT library](https://github.com/revisit-studies/study/blob/main/public/libraries/mini-vlat/config.json). Reference: S. Pandey and A. Ottley, "Mini-VLAT: A Short and Effective Measure of Visualization Literacy," Computer Graphics Forum 42(3), 2023, doi:10.1111/cgf.14809; see https://washuvis.github.io/minivlat/ for use terms.

## Framework

The app is based on the [ReVISit study template](https://github.com/revisit-studies/template), licensed under the BSD 3-Clause License in `LICENSE`. The ReVISit framework source lives in `src/`; the app entry point is `index.html`.
