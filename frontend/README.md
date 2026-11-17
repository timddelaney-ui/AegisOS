# Getting Started with Create React App

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## Job-first field workspace

React 19, CRACO and React Router remain unchanged. Authenticated tools share an
AppShell with Job (`/job`), Live (`/live`), Log (`/log`), Calc (`/calc`) and More
(`/more`). Existing tool URLs remain valid; `/` and `/hub` redirect authenticated
users to Job. Workbook and the 3D viewer are lazy-loaded. Emergency SOPs, the
advisory notice and connection status remain available throughout the workspace.

`src/config/toolRegistry.js` is the single discovery source for titles, routes,
phases, roles, tiers and pinned tools. Existing server permissions still apply.
Operational jobs are **device-local**, per signed-in account, under
`aegis_active_jobs_v1:<userId>`; they are not the server's saved-calculation jobs.
Plan / Rig up / Run / Handover checklists and SIM / STANDBY / LIVE mode persist.
SI/IMP retains its existing global preference. Telemetry and changing depth are
separate from job/checklist state. Calculator prefills are opening-time snapshots,
not continuously changing inputs; saved/explicit inputs take precedence. The first
migrated job can restore legacy workbook/fatigue inputs; later jobs are isolated.

After a successful online visit, the service worker precaches static/lazy assets.
Offline reopening uses the last verified workspace and cached plan access, labeled
as such, without caching credentials. Reconnection checks the server again;
confirmed 401/403 responses remove cached access. Logout removes offline access.
Clearing browser storage removes local jobs/drafts; use shared logs for durable
crew records.

Crew-alert polling validates the notification digest before using it. Failed or
malformed responses show an unavailable status and retry automatically without
replacing the job workspace with the application error screen.

Treatment logs remain **rig-scoped**, not job-ID-scoped. Offline entries are durable
device drafts with explicit destination review/upload. They are never automatically
replayed: treatment creation/entry endpoints have no idempotency support. Ambiguous
delivery is marked unconfirmed; verify the shared log before retrying or removing
the draft. A draft tied to a different treatment cannot silently move to a new one.
Shared treatment creation and email require connectivity. Handover previews the
selected rig/time-window log; unsent drafts are explicitly excluded. Existing crew
contacts, confirmations and human-in-the-loop approval govern email.

### Wide-deck cockpit

The cockpit (`/cockpit`, also opened by Live) uses a **10-minute** default chart
window, with 1-hour, 4-hour and shift options. Coil, wellhead and differential
pressure share the left axis; weight uses the right axis. Engineering-scale bands
include zero and expand for negative or overrange values rather than rescaling
each pen to its latest fluctuations. Traces are not smoothed; missing readings and
gaps over 30 seconds break the line.

Use **Display units** in the cockpit or Classic Mode to switch between Imperial
(psi, lbs, ft, ft/min, bpm) and Metric (MPa, daN, m, m/min, L/min), following the
existing field-unit conventions. Chart axes, readouts, encoders, fatigue depths,
buckling labels and workbook numeric cells follow this preference. Workbook edits
convert back to canonical Imperial storage; switching units does not change
telemetry, alarm thresholds or physics calculations. Fluid channel mappings retain
their configured DAQ units.

### Validation and known risks

Use `CI=true npm run build` and `CI=true npm test -- --watchAll=false --runInBand`.
Reducer, registry, feed provenance, input prefills, durable drafts, cache races and
offline-workspace behavior have focused tests. The unchanged baseline also fails
two CT-segment benchmark assertions, the StringHistoryImport axios mock setup and
CRA/Jest resolution of `react-router/dom`; no calculation formulas were changed to
make those failures disappear.

The Emergent visual editor and branded development error overlay are not included;
standard frontend installation no longer requires their tarballs. Other Emergent
integrations, including browser scripts, have not been removed. The main application
bundle remains large despite the new lazy screens. Cross-device operational-job sync,
server-idempotent log replay and job-ID-specific shared log partitioning require
separate backend work. Final site acceptance should exercise real DAQ, crew email,
existing classic consoles and device-specific 3D performance.

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You may also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you're on your own.

You don't have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn't feel obligated to use this feature. However we understand that this tool wouldn't be useful if you couldn't customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).

### Code Splitting

This section has moved here: [https://facebook.github.io/create-react-app/docs/code-splitting](https://facebook.github.io/create-react-app/docs/code-splitting)

### Analyzing the Bundle Size

This section has moved here: [https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size](https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size)

### Making a Progressive Web App

This section has moved here: [https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app](https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app)

### Advanced Configuration

This section has moved here: [https://facebook.github.io/create-react-app/docs/advanced-configuration](https://facebook.github.io/create-react-app/docs/advanced-configuration)

### Deployment

This section has moved here: [https://facebook.github.io/create-react-app/docs/deployment](https://facebook.github.io/create-react-app/docs/deployment)

### `npm run build` fails to minify

This section has moved here: [https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify](https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify)
