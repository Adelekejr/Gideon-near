// Builds the extension into dist/ (Load unpacked) and, with --zip, gideon-extension-<version>.zip.
// --firefox builds the Firefox (desktop + Android) variant into dist-firefox/ and gideon-extension-firefox-<version>.zip.
import { build } from "vite";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { deflateRawSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const firefox = process.argv.includes("--firefox");
const dist = join(here, firefox ? "dist-firefox" : "dist");
const alias = {
  "@gideon/core": join(root, "packages/core/src/index.ts"),
  "@gideon/sources": join(root, "packages/sources/src/index.ts"),
};

await rm(dist, { recursive: true, force: true });
for (const name of ["background", "content", "popup"]) {
  await build({
    configFile: false,
    logLevel: "warn",
    root: here,
    resolve: { alias },
    // GIDEON_SITE: the website's address once it's live (the popup's "Remove with any wallet" link). Empty by default.
    define: { "process.env.NODE_ENV": '"production"', __GIDEON_SITE__: JSON.stringify(process.env.GIDEON_SITE ?? "") },
    build: {
      outDir: dist,
      emptyOutDir: false,
      target: "chrome111",
      minify: true,
      sourcemap: false,
      lib: { entry: join(here, `src/${name}.ts`), formats: ["iife"], name: `gideon_${name}`, fileName: () => `${name}.js` },
    },
  });
}
await cp(join(here, "static"), dist, { recursive: true });
await cp(join(here, "popup.html"), join(dist, "popup.html"));
// What it reads and sends, the licence and third-party notices ship in the zip (0.3.1).
await cp(join(here, "PRIVACY.md"), join(dist, "PRIVACY.md"));
await cp(join(root, "THIRD_PARTY_NOTICES.txt"), join(dist, "THIRD_PARTY_NOTICES.txt"));
await cp(join(root, "LICENSE"), join(dist, "LICENSE.txt"));
const manifest = JSON.parse(await readFile(join(here, "manifest.json"), "utf8"));
await writeFile(join(dist, "manifest.json"), JSON.stringify(firefox ? forFirefox(manifest) : manifest, null, 2) + "\n");

const files = await walk(dist);
let bytes = 0;
for (const f of files) bytes += (await stat(f)).size;
console.log(`built ${relative(root, dist)}: ${files.length} files, ${(bytes / 1024).toFixed(0)} KB`);

if (process.argv.includes("--zip")) {
  const out = join(here, `gideon-extension-${firefox ? "firefox-" : ""}${manifest.version}.zip`);
  await writeFile(out, zip(await Promise.all(files.map(async (f) => ({ name: relative(dist, f).split("\\").join("/"), data: await readFile(f) })))));
  console.log(`zipped ${relative(root, out)} (${((await stat(out)).size / 1024).toFixed(0)} KB)`);
}

/**
 * Firefox MV3 differences: an event-page background (background.scripts, no service_worker),
 * an add-on ID (required to sign), and the data-collection declaration AMO requires.
 * Gideon sends the recipient you paste on a page and related transaction lookups to the
 * public APIs in host_permissions, so it declares websiteContent and financialAndPaymentInfo.
 * Firefox 140 (desktop) / 142 (Android) are the first with the built-in data consent screen.
 */
function forFirefox(m) {
  const { minimum_chrome_version: _drop, ...rest } = m;
  return {
    ...rest,
    background: { scripts: ["background.js"] },
    browser_specific_settings: {
      gecko: {
        id: "gideon-near@adelekejr.github.io",
        strict_min_version: "140.0",
        data_collection_permissions: { required: ["websiteContent", "financialAndPaymentInfo"] },
      },
      gecko_android: { strict_min_version: "142.0" },
    },
  };
}

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out.sort();
}

/* A small, dependency-free zip writer (deflate, no zip64). */
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  const DOS_TIME = 0, DOS_DATE = (2026 - 1980) << 9 | 10 << 5 | 29; // fixed date for reproducible zips
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const comp = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(DOS_TIME, 10); lh.writeUInt16LE(DOS_DATE, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(DOS_TIME, 12); ch.writeUInt16LE(DOS_DATE, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, comp);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
