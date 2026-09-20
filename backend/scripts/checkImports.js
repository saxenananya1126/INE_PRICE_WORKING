// backend/scripts/checkImports.js
// Usage (from backend):  node scripts/checkImports.js
//
// Windows ignores upper/lower case in file names, Linux (Render) does not. This checks every
// relative require("./x") in src/ and scripts/ against the EXACT file names on disk, so a
// casing mismatch is caught now instead of as "Cannot find module" after deploying.

const fs = require("fs");
const path = require("path");

const ROOTS = [path.join(__dirname, "..", "src"), __dirname];
const REQUIRE_RX = /require\(\s*["'`](\.{1,2}\/[^"'`]+)["'`]\s*\)/g;

function* walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) yield* walk(full);
        else if (entry.name.endsWith(".js")) yield full;
    }
}

// exact-case existence check (fs.existsSync is case-insensitive on Windows)
function existsExact(p) {
    const dir = path.dirname(p);
    if (dir === p) return true; // filesystem root
    if (!existsExact(dir)) return false;
    return fs.readdirSync(dir).includes(path.basename(p));
}

function findLooseMatch(p) {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) return null;
    const want = path.basename(p).toLowerCase();
    return fs.readdirSync(dir).find((n) => n.toLowerCase() === want) || null;
}

let files = 0;
let problems = 0;

for (const root of ROOTS) {
    for (const file of walk(root)) {
        files++;
        // ignore comments so example code inside them is not treated as an import
        const src = fs
            .readFileSync(file, "utf8")
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/^\s*\/\/.*$/gm, "");
        for (const match of src.matchAll(REQUIRE_RX)) {
            const target = path.resolve(path.dirname(file), match[1]);
            const candidates = [target, target + ".js", target + ".json", path.join(target, "index.js")];

            if (candidates.some(existsExact)) continue;

            problems++;
            const loose = candidates.map(findLooseMatch).find(Boolean);
            const rel = path.relative(path.join(__dirname, ".."), file);
            if (loose) {
                console.log(`CASE MISMATCH in ${rel}: require("${match[1]}") but the file on disk is "${loose}"`);
            } else {
                console.log(`MISSING in ${rel}: require("${match[1]}") - no such file`);
            }
        }
    }
}

console.log(problems ? `\n${problems} problem(s) found.` : `Checked ${files} files: all relative imports match the file names on disk.`);
process.exitCode = problems ? 1 : 0;