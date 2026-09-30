import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const root = process.cwd();
async function sourceTree(repo, sha, cache) {
  try {
    return JSON.parse((await readFile(cache, "utf8")).replace(/^\uFEFF/, ""));
  } catch {
    const response = await fetch(
      `https://api.github.com/repos/sgossner/${repo}/git/trees/${sha}?recursive=1`,
    );
    if (!response.ok)
      throw new Error("Cannot read pinned sample source: " + repo);
    const tree = await response.json();
    await mkdir(".sites-runtime", { recursive: true });
    await writeFile(cache, JSON.stringify(tree));
    return tree;
  }
}
const vsco = await sourceTree(
  "VSCO-2-CE",
  "440300901dfe9275fd84e0b7763af1f8443ae62e",
  ".sites-runtime/vsco-tree.json",
);
const vcsl = await sourceTree(
  "VCSL",
  "c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e",
  ".sites-runtime/vcsl-tree.json",
);
const noteRE = /_([A-G][#b]?)(-?\d)(?:_|\.wav)/;
const pcs = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function info(file) {
  const note = noteRE.exec(file.path);
  if (!note) return null;
  const accidental = note[1].includes("#") ? 1 : note[1].includes("b") ? -1 : 0;
  const midi = (Number(note[2]) + 2) * 12 + pcs[note[1][0]] + accidental;
  return {
    ...file,
    midi,
    velocity: Number(/_v(?:l)?(\d)/.exec(file.path)?.[1] ?? 1),
    rr: Number(/_rr(\d)/.exec(file.path)?.[1] ?? 1),
  };
}
const specs = [
  {
    id: "piano",
    name: "Kawai grand piano",
    family: "Keys",
    description: "Warm acoustic grand, with two recorded dynamic layers.",
    tree: vcsl,
    repo: "VCSL",
    prefix: "Chordophones/Zithers/Grand Piano, Kawai - Legacy/Sustains/",
    short: null,
    count: 8,
    layers: 2,
  },
  {
    id: "strings",
    name: "Chamber strings",
    family: "Strings",
    description: "Violin ensemble with sustained and spiccato articulations.",
    tree: vsco,
    repo: "VSCO-2-CE",
    prefix: "Strings/Violin Section/susVib/",
    short: "Strings/Violin Section/Spic/",
    count: 5,
    layers: 2,
  },
  {
    id: "cello",
    name: "Cello ensemble",
    family: "Strings",
    description:
      "Expressive cello ensemble, with sustained and spiccato bowing.",
    tree: vsco,
    repo: "VSCO-2-CE",
    prefix: "Strings/Cello Section/susvib/",
    short: "Strings/Cello Section/spic/",
    count: 5,
    layers: 2,
  },
  {
    id: "horn",
    name: "French horn",
    family: "Brass",
    description: "Recorded French horn with sustain and staccato.",
    tree: vsco,
    repo: "VSCO-2-CE",
    prefix: "Brass/F Horn/sus/",
    short: "Brass/F Horn/stac/",
    count: 5,
    layers: 2,
  },
  {
    id: "flute",
    name: "Concert flute",
    family: "Woodwinds",
    description: "Natural flute with sustained and staccato phrases.",
    tree: vsco,
    repo: "VSCO-2-CE",
    prefix: "Woodwinds/Flute/susNV/",
    short: "Woodwinds/Flute/stac/",
    count: 5,
    layers: 2,
  },
  {
    id: "glock",
    name: "Glockenspiel",
    family: "Percussion",
    description: "Bright orchestral bells.",
    tree: vsco,
    repo: "VSCO-2-CE",
    prefix: "Percussion/Glock/",
    short: null,
    count: 5,
    layers: 1,
  },
];
const manifests = [],
  downloads = [];
for (const spec of specs) {
  const zones = [];
  for (const [prefix, articulation] of [
    [spec.prefix, "sustain"],
    ...(spec.short ? [[spec.short, "short"]] : []),
  ]) {
    const files = spec.tree.tree
      .filter(
        (f) =>
          f.type === "blob" &&
          f.path.startsWith(prefix) &&
          f.path.endsWith(".wav"),
      )
      .map(info)
      .filter(Boolean);
    const roots = [...new Set(files.map((f) => f.midi))].sort((a, b) => a - b);
    const chosen = [
      ...new Set(
        Array.from(
          { length: Math.min(spec.count, roots.length) },
          (_, i) =>
            roots[
              Math.round(
                (i * (roots.length - 1)) /
                  (Math.min(spec.count, roots.length) - 1),
              )
            ],
        ),
      ),
    ];
    for (let i = 0; i < chosen.length; i++) {
      const midi = chosen[i];
      const candidates = files.filter((f) => f.midi === midi);
      const velocities = [...new Set(candidates.map((f) => f.velocity))].sort(
        (a, b) => a - b,
      );
      const selected =
        spec.layers === 1
          ? [velocities[Math.floor(velocities.length / 2)]]
          : [velocities[0], velocities[velocities.length - 1]];
      for (let layer = 0; layer < selected.length; layer++) {
        const group = candidates.filter((f) => f.velocity === selected[layer]);
        const variations =
          articulation === "short" ? group.slice(0, 2) : group.slice(0, 1);
        for (let rr = 0; rr < variations.length; rr++) {
          const file = variations[rr];
          const filename = `${articulation}-${midi}-${layer}-${rr}.wav`;
          const url = `/sounds/${spec.id}/${filename}`;
          zones.push({
            url,
            root: midi,
            low: i === 0 ? 0 : Math.floor((chosen[i - 1] + midi) / 2) + 1,
            high:
              i === chosen.length - 1
                ? 127
                : Math.floor((midi + chosen[i + 1]) / 2),
            velocityLow: selected.length === 1 ? 0 : layer === 0 ? 0 : 0.56,
            velocityHigh:
              selected.length === 1 || layer === selected.length - 1 ? 1 : 0.56,
            roundRobin: rr,
            articulation,
          });
          downloads.push({
            repo: spec.repo,
            sha: spec.tree.sha,
            file: file.path,
            target: path.join(root, "public", url),
            instrument: spec.id,
          });
        }
      }
    }
  }
  manifests.push({
    id: spec.id,
    name: spec.name,
    family: spec.family,
    description: spec.description,
    kind: "sample",
    zones,
    articulations: spec.short ? ["sustain", "short"] : ["sustain"],
    license: "CC0-1.0",
    source: `https://github.com/sgossner/${spec.repo}`,
    defaults: {
      attack: spec.id === "piano" || spec.id === "glock" ? 0.003 : 0.035,
      release: spec.id === "piano" ? 0.9 : 0.4,
      cutoff: 14000,
    },
  });
}
const percussionFiles = vsco.tree.filter(
  (f) =>
    f.type === "blob" &&
    /^VSCO 1 Percussion\/drums\/(bass|snare)\//.test(f.path) &&
    f.path.endsWith(".wav"),
);
const percussionZones = [];
for (const [category, pitch] of [
  ["bass", 36],
  ["snare", 38],
]) {
  const files = percussionFiles
    .filter((f) => f.path.includes("/" + category + "/"))
    .slice(0, 2);
  for (let i = 0; i < files.length; i++) {
    const url = `/sounds/percussion/${category}-${i}.wav`;
    percussionZones.push({
      url,
      root: pitch,
      low: pitch,
      high: pitch,
      velocityLow: 0,
      velocityHigh: 1,
      roundRobin: i,
      articulation: "sustain",
    });
    downloads.push({
      repo: "VSCO-2-CE",
      sha: vsco.sha,
      file: files[i].path,
      target: path.join(root, "public", url),
      instrument: "percussion",
    });
  }
}
manifests.push({
  id: "percussion",
  name: "Orchestral percussion",
  family: "Percussion",
  description:
    "Recorded orchestral bass drum and snare; synthetic cymbals complete the kit.",
  kind: "sample",
  zones: percussionZones,
  articulations: ["sustain"],
  license: "CC0-1.0",
  source: "https://github.com/sgossner/VSCO-2-CE",
  defaults: { attack: 0.001, release: 0.3 },
});
let next = 0,
  done = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (next < downloads.length) {
      const entry = downloads[next++];
      await mkdir(path.dirname(entry.target), { recursive: true });
      try {
        if ((await stat(entry.target)).size > 44) {
          const data = await readFile(entry.target);
          entry.bytes = data.length;
          entry.sha256 = createHash("sha256").update(data).digest("hex");
          done++;
          continue;
        }
      } catch {}
      const url =
        `https://raw.githubusercontent.com/sgossner/${entry.repo}/${entry.sha}/` +
        entry.file.split("/").map(encodeURIComponent).join("/");
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status}: ${entry.file}`);
      const data = Buffer.from(await response.arrayBuffer());
      if (data.toString("ascii", 0, 4) !== "RIFF")
        throw new Error("Not a WAV: " + entry.file);
      await writeFile(entry.target, data);
      entry.bytes = data.length;
      entry.sha256 = createHash("sha256").update(data).digest("hex");
      done++;
      if (done % 15 === 0)
        console.log(`Curated ${done}/${downloads.length} samples`);
    }
  }),
);
for (const entry of downloads) {
  const data = await readFile(entry.target);
  let sampleRate = 0,
    align = 0,
    length = 0;
  for (let offset = 12; offset + 8 < data.length; ) {
    const id = data.toString("ascii", offset, offset + 4),
      size = data.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      sampleRate = data.readUInt32LE(offset + 12);
      align = data.readUInt16LE(offset + 20);
    }
    if (id === "data") {
      length = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  const duration = length / align / sampleRate;
  if (
    ["strings", "cello", "horn", "flute"].includes(entry.instrument) &&
    path.basename(entry.target).startsWith("sustain") &&
    duration > 1.5
  ) {
    const manifest = manifests.find((i) => i.id === entry.instrument);
    const zone = manifest.zones.find(
      (z) => path.basename(z.url) === path.basename(entry.target),
    );
    zone.loopStart = Number((duration * 0.25).toFixed(4));
    zone.loopEnd = Number((duration * 0.8).toFixed(4));
  }
}
await mkdir("lib/audio", { recursive: true });
await writeFile(
  "lib/audio/factory-samples.json",
  JSON.stringify(manifests, null, 2) + "\n",
);
await writeFile(
  "public/sounds/provenance.json",
  JSON.stringify(
    {
      license: "CC0-1.0",
      sources: { VCSL: vcsl.sha, "VSCO-2-CE": vsco.sha },
      files: downloads.map(({ target, ...entry }) => ({
        ...entry,
        path: path.relative(root, target).replaceAll("\\", "/"),
      })),
    },
    null,
    2,
  ) + "\n",
);
await writeFile(
  "public/sounds/LICENSE.txt",
  "Curated samples from VSCO 2 Community Edition and the Versilian Community Sample Library (VCSL), by Versilian Studios and their contributing performers.\nBoth source collections are dedicated under CC0 1.0 Universal.\nhttps://creativecommons.org/publicdomain/zero/1.0/\nhttps://versilian-studios.com/vsco-community/\nhttps://github.com/sgossner/VCSL\nSee provenance.json for original paths, source revisions and checksums.\nSample filenames use C3 for MIDI 60; manifests convert to scientific MIDI numbering.\n",
);
console.log(
  JSON.stringify({
    instruments: manifests.length,
    samples: downloads.length,
    totalBytes: (
      await Promise.all(downloads.map((d) => stat(d.target)))
    ).reduce((s, f) => s + f.size, 0),
  }),
);
