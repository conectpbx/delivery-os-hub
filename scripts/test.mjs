import { readdir } from "node:fs/promises";

for (const directory of ["../src/lib/", "../src/components/"]) {
  const base = new URL(directory, import.meta.url);
  for (const file of (await readdir(base)).sort()) {
    if (/\.test\.tsx?$/.test(file)) await import(new URL(file, base).href);
  }
}
