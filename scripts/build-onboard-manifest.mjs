#!/usr/bin/env bun

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    channel: "",
    tag: "",
    repo: "",
    checksums: "",
    output: "",
    commit: process.env.GITHUB_SHA ?? "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    if (token === "--channel" && next) {
      args.channel = next;
      i += 1;
      continue;
    }
    if (token === "--tag" && next) {
      args.tag = next;
      i += 1;
      continue;
    }
    if (token === "--repo" && next) {
      args.repo = next;
      i += 1;
      continue;
    }
    if (token === "--checksums" && next) {
      args.checksums = next;
      i += 1;
      continue;
    }
    if (token === "--output" && next) {
      args.output = next;
      i += 1;
      continue;
    }
    if (token === "--commit" && next) {
      args.commit = next;
      i += 1;
      continue;
    }
  }

  if (!args.channel || !args.tag || !args.repo || !args.checksums || !args.output) {
    throw new Error(
      "Usage: bun scripts/build-onboard-manifest.mjs --channel <stable|preview> --tag <tag> --repo <owner/repo> --checksums <file> --output <file> [--commit <sha>]",
    );
  }

  return args;
}

function parseChecksums(raw) {
  const entries = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^([a-f0-9]{64})\s+\*?(.+)$/.exec(line);
      if (!match) return null;
      return { sha256: match[1], fileName: path.basename(match[2]) };
    })
    .filter(Boolean);
  return entries;
}

function runtimeKeyFromFileName(fileName) {
  const match = /^owliabot-onboard-(darwin|linux|win32)-(x64|arm64)(\.exe)?$/.exec(fileName);
  if (!match) return null;
  return `${match[1]}-${match[2]}`;
}

function buildManifest(args, entries) {
  const assets = {};
  for (const entry of entries) {
    const key = runtimeKeyFromFileName(entry.fileName);
    if (!key) continue;
    assets[key] = {
      fileName: entry.fileName,
      sha256: entry.sha256,
      url: `https://github.com/${args.repo}/releases/download/${args.tag}/${entry.fileName}`,
    };
  }
  return {
    channel: args.channel,
    tag: args.tag,
    repository: args.repo,
    commit: args.commit || undefined,
    generatedAt: new Date().toISOString(),
    assets,
  };
}

const args = parseArgs(process.argv.slice(2));
const checksumsRaw = readFileSync(args.checksums, "utf8");
const entries = parseChecksums(checksumsRaw);
if (entries.length === 0) {
  throw new Error(`No checksum entries found: ${args.checksums}`);
}
const manifest = buildManifest(args, entries);
if (Object.keys(manifest.assets).length === 0) {
  throw new Error("No matching onboard binaries found in checksums file.");
}

writeFileSync(args.output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
