const esbuild = require("esbuild");
const path = require("path");

const args   = process.argv.slice(2);
const watch  = args.includes("--watch");
const deploy = args.includes("--deploy");

const outdir = path.join(__dirname, "../priv/static/assets");

const alias = {
  "components": path.join(__dirname, "js/components"),
  "lib":        path.join(__dirname, "js/lib"),
  "pages":      path.join(__dirname, "js/pages"),
  "admin":      path.join(__dirname, "js/admin"),
  "layout":     path.join(__dirname, "js/layout"),
};

// See package README / Stage 2 notes: admin.js is loaded lazily and must reuse
// the main app's single instances of React and the shared modules, not bundle
// its own. Bundling a second React breaks hooks; re-running the api client
// re-registers its module-level install-prompt listeners; duplicating Toasts /
// Avatar splits their singleton state so admin toasts and user-card popovers
// silently stop working. This plugin rewrites those imports (admin build only)
// to read window.__nexusRuntime, which nexus.jsx populates.
const SHARED = {
  "react":                           "react",
  "react/jsx-runtime":               "react/jsx-runtime",
  "lib/api":                         "lib/api",
  "lib/utils":                       "lib/utils",
  "components/Avatar":               "components/Avatar",
  "components/Markdown":             "components/Markdown",
  "components/Select":               "components/Select",
  "components/Toasts":               "components/Toasts",
  "components/RichTextArea":         "components/RichTextArea",
  "components/PermissionGatePicker": "components/PermissionGatePicker",
  "pages/UpdatesPanel":              "pages/UpdatesPanel",
};

function sharedKey(spec) {
  if (SHARED[spec]) return SHARED[spec];
  const stripped = spec.replace(/^(\.\.?\/)+/, "");
  if (SHARED[stripped]) return SHARED[stripped];
  return null;
}

const sharedRuntimePlugin = {
  name: "nexus-shared-runtime",
  setup(build) {
    build.onResolve({ filter: /.*/ }, (a) => {
      const key = sharedKey(a.path);
      if (!key) return null;
      return { path: key, namespace: "nexus-shared" };
    });
    build.onLoad({ filter: /.*/, namespace: "nexus-shared" }, (a) => ({
      contents: "module.exports = window.__nexusRuntime[" + JSON.stringify(a.path) + "];",
      loader: "js",
    }));
  },
};

const common = {
  bundle:   true,
  target:   "es2017",
  logLevel: "info",
  jsx:      "automatic",
  define:   { "process.env.NODE_ENV": deploy ? '"production"' : '"development"' },
  minify:   deploy,
  alias,
};

const mainConfig = {
  ...common,
  entryPoints: ["js/nexus.jsx"],
  outfile:     path.join(outdir, "app.js"),
};

const adminConfig = {
  ...common,
  entryPoints: ["js/admin-entry.jsx"],
  outfile:     path.join(outdir, "admin.js"),
  plugins:     [sharedRuntimePlugin],
};

const cssConfig = {
  entryPoints: ["css/app.css"],
  bundle: true,
  outfile: path.join(outdir, "app.css"),
  logLevel: "info",
  minify: deploy,
  external: ["/fonts/*"],
};

if (watch) {
  Promise.all([
    esbuild.context(mainConfig).then(ctx => ctx.watch()),
    esbuild.context(adminConfig).then(ctx => ctx.watch()),
    esbuild.context(cssConfig).then(ctx => ctx.watch()),
  ]);
} else {
  Promise.all([
    esbuild.build(mainConfig),
    esbuild.build(adminConfig),
    esbuild.build(cssConfig),
  ]);
}
