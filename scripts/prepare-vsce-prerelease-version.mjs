import fs from "node:fs";

const releaseVersion = process.argv[2];

if (!releaseVersion) {
  throw new Error("Missing semantic-release version argument.");
}

const match = releaseVersion.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);

if (!match) {
  throw new Error(`Invalid semantic-release version: ${releaseVersion}`);
}

const [, major, minor, patch, prerelease] = match;
let vsceVersion = `${major}.${minor}.${patch}`;

if (prerelease) {
  const prereleaseNumber = prerelease.match(/(?:^|\.)(\d+)$/)?.[1] ?? "1";
  vsceVersion = `${major}.${minor}.${Number(patch) + Number(prereleaseNumber)}`;
}

const updateJsonVersion = (path, updateRootPackage = false) => {
  const json = JSON.parse(fs.readFileSync(path, "utf8"));
  json.version = vsceVersion;

  if (updateRootPackage && json.packages?.[""]) {
    json.packages[""].version = vsceVersion;
  }

  fs.writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
};

updateJsonVersion("package.json");
updateJsonVersion("package-lock.json", true);

console.log(`Prepared VSCE package version ${vsceVersion} for semantic release ${releaseVersion}.`);
