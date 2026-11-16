// 把 relay 打成单文件（esbuild，平台 node）：产物不依赖 @zcode/shared 的运行时解析，
// 用户机器上 `node dist/cli.mjs` 即可运行，无需构建工具链。
import { build } from "esbuild";

await build({
  entryPoints: ["src/cli.ts"],
  outfile: "dist/cli.mjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  // src/cli.ts already starts with a shebang that esbuild keeps; a banner made it
  // appear twice and the bundle failed to parse.
  // ws is CommonJS: give the ESM bundle a real require (esbuild's shim throws).
  banner: { js: 'import { createRequire as __zcodeCreateRequire } from "node:module"; const require = __zcodeCreateRequire(import.meta.url);' },
  logLevel: "info",
});
