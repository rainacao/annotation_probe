# VLAT Graph Viewing Study

This repository runs a reVISit study that presents the 12 VLAT graph images in a fixed sequence, each preceded by a fixation-cross pupil baseline and followed by a NASA-TLX, collects a required short-text response for each graph, and saves optional pointer annotations over each graph.

## Run locally

1. Install Node.js 24.15 or later in the Node.js 24 LTS line (`nvm use` reads `.nvmrc`), and Yarn 1 (classic).
2. Copy `.env.example` to `.env`.
3. Run `yarn install --frozen-lockfile`.
4. Run `yarn serve`, then open `http://localhost:8080`.
5. Select **VLAT Graph Viewing Study** to preview the participant flow.

Use Yarn, not npm, like upstream reVISit. `yarn.lock` is the only lockfile; don't commit a `package-lock.json`.

Responses are stored in the browser's local storage during the study and automatically downloaded as participant JSON when the study is completed. This setup is suitable for local testing; configure a supported cloud storage engine before using a hosted study to collect responses from multiple participants.

## Study configuration

- `public/global.json` registers the study.
- `public/annotation-probe/config.json` defines the graph stimulus components, answer fields, and fixed sequence.
- Trials come from a reVISit factor block, following upstream `demo-stroop-factors`, so `components` is empty. The `graph` factor lists the graph numbers 1–12. The `trials` factor block builds `fixation` → `graph` → `nasa-tlx` from those `baseComponents` for each level, in order, which gives 36 steps. Each level's `{graph: N}` is merged into the base `parameters`: `imageUrl` is the template `…/VLAT{{graph}}.png`, and `durationMs` is set once on the `fixation` base. To change a value for every trial, edit the base component. To change which graphs run, edit `factors.graph`.
- Generated component IDs look like `trials__graph=1__fixation`. They are the keys in the participant data.
- Caveat: the block expands to a flat list, so `"order": "random"` on the factor block would shuffle the individual steps and split a fixation from its graph. To randomize graph order, use a factor expression that keeps each level's steps together (`sample`, or ordered factor levels) rather than block-level `order`.
- `src/public/annotation-probe/FixationBaseline.tsx` is the pupil baseline. It lays out the upcoming graph invisibly, using the same DOM and CSS as the trial, and draws a black fixation cross at that graph's centre. When the trial loads, the graph replaces the cross at the same point. The baseline auto-advances after `parameters.durationMs`, and the hidden `baseline` response records `crossShownAt`, `crossHiddenAt`, and `durationMs`. `public/annotation-probe/fixation.css` hides the Next button only during fixation, so participants can't end the baseline early.
- `public/annotation-probe/study.css` (`uiConfig.stylesheetPath`) makes the header, sidebar, and main area neutral grey `#808080` (sRGB 128, the midpoint between white and black). The Next button sits in the sidebar (`uiConfig.nextButtonLocation`), so the fixation and graph screens have identical layouts.
- `nasa-tlx` is a raw NASA-TLX questionnaire with six required 0–100 sliders in steps of 5, using reVISit's `tlxStyle`. Performance is labelled Perfect → Failure; the other five scales run Very Low → Very High. It shows no sidebar.
- `scripts/smoke-study-flow.mjs` drives fixation → graph → TLX → next fixation in local Chrome while `yarn serve` runs. It prints the cross centre next to the image centre and saves screenshots.
- `src/public/annotation-probe/AnnotationTrial.tsx` renders the graph with a transparent pointer-drawing layer and a 24 px drawable margin around each image (white backdrop; the stage pads top and bottom by the same margin so it is not clipped); normalized stroke points are saved as the hidden `annotation` response and tracked with ReVISit provenance.
- Each image is loaded directly from the ReVISit `library-assets` GitHub repository; the PNG files are not copied into this repository.
- To use different stimuli, change the `imageUrl` template in the `fixation` and `graph` base components to another URL or a file under `public/`. If the new URLs don't share a pattern, make the factor levels objects such as `{"graph": "a", "imageUrl": "…"}`. Note that the URL then becomes part of the generated IDs. A base component's `path` points to the React component, not the image.
- Replace the generic short-text prompt with the real question and response type/options for your study. No VLAT question wording or answer key is included in this response-only graph sequence.
- Replace `study-contact@example.org` with a contact address before recruiting participants.

The source image URLs follow the VLAT image references used by the [ReVISit VLAT library](https://github.com/revisit-studies/study/blob/main/public/libraries/vlat/config.json). See the [VLAT publication](https://www.bckwon.com/publication/vlat/) for the instrument reference and use terms.

## Framework

The app is based on the [ReVISit study template](https://github.com/revisit-studies/template), licensed under the BSD 3-Clause License in `LICENSE`. The ReVISit framework source lives in `src/`; the app entry point is `index.html`.
