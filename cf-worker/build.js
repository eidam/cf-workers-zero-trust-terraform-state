const esbuild = require("esbuild");
const { yamlPlugin } = require("esbuild-plugin-yaml");

esbuild
  .build({
    entryPoints: ["./src/main.ts"],
    bundle: true,
    format: "esm",
    outfile: "./dist/main.mjs",
    plugins: [
      yamlPlugin()
    ],
    loader: {
      ".html": "text",
      ".css": "text",
    },
  })
  .catch(() => process.exit(1));
