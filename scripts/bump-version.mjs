import {readFile, writeFile} from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const typeIndex = args.indexOf("--type");
const repoIndex = args.indexOf("--repo");
const currentIndex = args.indexOf("--current-version");
const releaseType = typeIndex >= 0 ? args[typeIndex + 1] : "minor";
const dryRun = args.includes("--dry-run");
const repoArg = repoIndex >= 0 ? args[repoIndex + 1] : undefined;
const currentOverride = currentIndex >= 0 ? args[currentIndex + 1] : undefined;

const allowedTypes = new Set(["patch", "minor", "major"]);
if (!allowedTypes.has(releaseType)) {
  throw new Error(`Unsupported release type: ${releaseType}`);
}

const root = process.cwd();
const manifestTemplatePath = path.join(root, "manifest.template.json");
const packagePath = path.join(root, "package.json");

const manifestTemplate = JSON.parse(await readFile(manifestTemplatePath, "utf8"));
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));

const minAppVersion = manifestTemplate.minAppVersion;

if (!minAppVersion) {
  throw new Error("manifest.template.json is missing minAppVersion");
}

const bumpVersion = (version, type) => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Invalid semver version: ${version}`);
  }

  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2], 10);
  const patch = Number.parseInt(match[3], 10);

  if (type === "major") {
    return `${major + 1}.0.0`;
  }
  if (type === "minor") {
    return `${major}.${minor + 1}.0`;
  }
  return `${major}.${minor}.${patch + 1}`;
};

const normalizeVersion = (value) => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.startsWith("v") ? trimmed.slice(1) : trimmed;
};

const compareSemver = (left, right) => {
  const leftMatch = /^\d+\.\d+\.\d+$/.exec(left);
  const rightMatch = /^\d+\.\d+\.\d+$/.exec(right);
  if (!leftMatch || !rightMatch) {
    return 0;
  }
  const leftParts = left.split(".").map((part) => Number.parseInt(part, 10));
  const rightParts = right.split(".").map((part) => Number.parseInt(part, 10));
  for (let i = 0; i < 3; i += 1) {
    if (leftParts[i] > rightParts[i]) {
      return 1;
    }
    if (leftParts[i] < rightParts[i]) {
      return -1;
    }
  }
  return 0;
};

const loadLatestVersion = async () => {
  if (currentOverride) {
    const normalized = normalizeVersion(currentOverride);
    if (!normalized) {
      throw new Error("--current-version must be a valid semver value");
    }
    return normalized;
  }

  const repo = repoArg || process.env.GITHUB_REPOSITORY;
  if (!repo) {
    throw new Error("Missing repo. Set GITHUB_REPOSITORY or pass --repo owner/name.");
  }

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const headers = {
    "Accept": "application/vnd.github+json",
    "User-Agent": "daily-notes-digest-bump"
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const latestUrl = `https://api.github.com/repos/${repo}/releases/latest`;
  const latestResponse = await fetch(latestUrl, {headers});
  if (latestResponse.ok) {
    const payload = await latestResponse.json();
    const normalized = normalizeVersion(payload.tag_name || payload.name);
    if (normalized) {
      return normalized;
    }
  }

  const tagsUrl = `https://api.github.com/repos/${repo}/tags?per_page=100`;
  const tagsResponse = await fetch(tagsUrl, {headers});
  if (!tagsResponse.ok) {
    throw new Error(`Failed to read tags from GitHub (${tagsResponse.status})`);
  }
  const tags = await tagsResponse.json();
  if (!Array.isArray(tags) || tags.length === 0) {
    return "0.0.0";
  }

  const versions = tags
    .map((tag) => normalizeVersion(tag?.name))
    .filter((version) => /^\d+\.\d+\.\d+$/.test(version || ""));
  if (versions.length === 0) {
    return "0.0.0";
  }

  return versions.sort(compareSemver).at(-1);
};

const currentVersion = await loadLatestVersion();
if (!currentVersion) {
  throw new Error("Unable to determine current version from GitHub");
}

const nextVersion = bumpVersion(currentVersion, releaseType);

if (dryRun) {
  console.log(nextVersion);
  process.exit(0);
}

packageJson.version = nextVersion;

await writeFile(packagePath, JSON.stringify(packageJson, null, 2) + "\n", "utf8");

console.log(nextVersion);
