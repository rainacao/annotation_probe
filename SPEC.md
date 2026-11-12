# VLAT Graph Viewing Study

This repository runs a reVISit study that presents the 12 VLAT graph images in a fixed sequence, collects a required short-text response for each graph, and saves optional pointer annotations over each graph.

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
- `src/public/annotation-probe/AnnotationTrial.tsx` renders the graph with a transparent pointer-drawing layer and a 24 px drawable margin around each image; normalized stroke points are saved as the hidden `annotation` response and tracked with ReVISit provenance.
- Each image is loaded directly from the ReVISit `library-assets` GitHub repository; the PNG files are not copied into this repository.
- Change each component's `parameters.imageUrl` to another image URL or a file under `public/` to use different stimuli. The component's `path` points to the React component, not the image.
- Replace the generic short-text prompt with the real question and response type/options for your study. No VLAT question wording or answer key is included in this response-only graph sequence.
- Replace `study-contact@example.org` with a contact address before recruiting participants.

The source image URLs follow the VLAT image references used by the [ReVISit VLAT library](https://github.com/revisit-studies/study/blob/main/public/libraries/vlat/config.json). See the [VLAT publication](https://www.bckwon.com/publication/vlat/) for the instrument reference and use terms.

## Framework

The app is based on the [ReVISit study template](https://github.com/revisit-studies/template), licensed under the BSD 3-Clause License in `LICENSE`. The ReVISit framework source lives in `src/`; the app entry point is `index.html`.
