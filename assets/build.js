const esbuild = require("esbuild");
const path = require("path");

const args = process.argv.slice(2);
const watch = args.includes("--watch");
const deploy = args.includes("--deploy");

const outdir = path.join(__dirname, "../priv/static/assets");

const jsConfig = {
  entryPoints: ["js/nexus.jsx"],
  bundle: true,
  target: "es2017",
  outfile: path.join(outdir, "app.js"),
  logLevel: "info",
  jsx: "automatic",
  define: {
    "process.env.NODE_ENV": deploy ? '"production"' : '"development"'
  },
  minify: deploy
};

const cssConfig = {
  entryPoints: ["css/app.css"],
  bundle: true,
  outfile: path.join(outdir, "app.css"),
  logLevel: "info",
  minify: deploy
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
