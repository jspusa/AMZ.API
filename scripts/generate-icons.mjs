import { readFile, writeFile } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";

const svg = await readFile(new URL("../build/icon.svg", import.meta.url), "utf8");
const definitions = [
  ["ic10", 1024],
  ["ic09", 512],
  ["ic08", 256],
  ["ic07", 128],
  ["icp6", 64],
  ["icp5", 32],
  ["icp4", 16],
];

function rasterize(size) {
  const renderer = new Resvg(svg, {
    fitTo: { mode: "width", value: size },
    background: "rgba(0, 0, 0, 0)",
  });
  return renderer.render().asPng();
}

function chunk(type, data) {
  const header = Buffer.alloc(8);
  header.write(type, 0, 4, "ascii");
  header.writeUInt32BE(data.length + 8, 4);
  return Buffer.concat([header, data]);
}

const chunks = definitions.map(([type, size]) => chunk(type, rasterize(size)));
const header = Buffer.alloc(8);
header.write("icns", 0, 4, "ascii");
header.writeUInt32BE(8 + chunks.reduce((sum, item) => sum + item.length, 0), 4);

await Promise.all([
  writeFile(new URL("../build/icon.png", import.meta.url), rasterize(1024)),
  writeFile(new URL("../build/icon.icns", import.meta.url), Buffer.concat([header, ...chunks])),
]);
