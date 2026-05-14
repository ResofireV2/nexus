const esbuild = require("esbuild");
const path = require("path");

const args   = process.argv.slice(2);
const watch  = args.includes("--watch");
const deploy = args.includes("--deploy");

const outdir = path.join(__dirname, "../priv/static/assets");

const jsConfig = {
  entryPoints: ["js/nexus.jsx"],
  bundle:      true,
  target:      "es2017",
  outfile:     path.join(outdir, "app.js"),
  logLevel:    "info",
  jsx:         "automatic",
  define: {
    "process.env.NODE_ENV": deploy ? '"production"' : '"development"',
  },
  minify: deploy,

  // Path aliases — lets any file import cleanly without relative path hell
  // as the directory tree grows.
  alias: {
    "components": path.join(__dirname, "js/components"),
    "lib":        path.join(__dirname, "js/lib"),
    "pages":      path.join(__dirname, "js/pages"),
    "admin":      path.join(__dirname, "js/admin"),
    "layout":     path.join(__dirname, "js/layout"),
  },
};

const cssConfig = {
  entryPoints: ["css/app.css"],
  bundle: true,
  outfile: path.join(outdir, "app.css"),
  logLevel: "info",
  minify: deploy,
  // Font files are served directly by Phoenix/Caddy from priv/static/fonts/.
  // Mark them as external so esbuild leaves the url() references as-is rather
  // than trying to resolve them as local filesystem paths during bundling.
  external: ["/fonts/*"],
};

if (watch) {
  Promise.all([
    esbuild.context(jsConfig).then(ctx => ctx.watch()),
    esbuild.context(cssConfig).then(ctx => ctx.watch()),
  ]);
} else {
  Promise.all([
    esbuild.build(jsConfig),
    esbuild.build(cssConfig),
  ]);
}
