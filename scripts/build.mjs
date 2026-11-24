import { cp, mkdir, rm } from "node:fs/promises";

const dist = new URL("../dist/", import.meta.url);
await rm(dist, { recursive: true, force: true });
await mkdir(new URL(".openai/", dist), { recursive: true });
await Promise.all([
  cp(new URL("../src/", import.meta.url), new URL("server/", dist), { recursive: true }),
  cp(new URL("../.openai/hosting.json", import.meta.url), new URL(".openai/hosting.json", dist)),
]);
