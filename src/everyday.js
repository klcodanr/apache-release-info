const JiraClient = require("./lib/jira");
const fs = require("fs");
require("dotenv").config();

const curies = [
  {
    name: "api",
    href: "http://klcodanr.github.io/apache-release-info/docs/rels/{rel}",
    templated: true,
  },
];
const API_BASE = "https://klcodanr.github.io/apache-release-info/api/";

/**
 * Runs the daily update to grab all public releases and store them to JSON.
 * @param {JiraClient} jira the jira client
 */
async function run(jira) {
  const releases = (await jira.getReleases()).sort((a, b) =>
    a.releaseDate.iso.localeCompare(b.releaseDate.iso)
  );
  console.log(`Found releases: ${releases.length}`);

  let indexData = {
    _links: {
      curies,
      self: API_BASE,
    },
    _embedded: { "api:projects": [] },
  };
  fs.mkdirSync("docs/api/", { recursive: true });
  if (fs.existsSync("docs/api/index.json")) {
    indexData = JSON.parse(fs.readFileSync("docs/api/index.json"));
  }
  const projectName = process.env.PROJECT_NAME;
  if (
    indexData._embedded["api:projects"].filter(
      (proj) => proj.id === process.env.PROJECT_ID
    ).length === 0
  ) {
    indexData._embedded["api:projects"].push({
      name: projectName,
      id: process.env.PROJECT_ID,
      _links: {
        curies,
        self: { href: `${API_BASE}${projectName}` },
        "api:jira": {
          href: `https://issues.apache.org/jira/projects/${projectName}`,
        },
      },
    });
  }
  fs.writeFileSync("docs/api/index.json", JSON.stringify(indexData, null, 2));

  const projectData = {
    name: projectName,
    id: process.env.PROJECT_ID,
    _embedded: {
      "api:releases": [],
    },
    _links: {
      curies,
      self: { href: `${API_BASE}${projectName}` },
      "api:jira": {
        href: `https://issues.apache.org/jira/projects/${projectName}`,
      },
    },
  };

  const releaseNames = [];
  for (const release of releases) {
    const releaseData = {
      id: release.id,
      name: release.name,
      description: release.description,
      date: release.releaseDate.iso,
      version: release.version,
      module: release.module,
      _links: {
        curies,
        self: { href: `${API_BASE}${projectName}/${release.id}` },
        "api:jira": { href: `https://issues.apache.org/jira${release.url}` },
        "api:project": { href: `${API_BASE}${projectName}` },
      },
    };
    releaseNames.push(release.name);

    fs.mkdirSync(`docs/api/${projectName}`, { recursive: true });
    if (!fs.existsSync(`docs/api/${projectName}/${release.id}/index.json`)) {
      const releaseNote = await jira.getReleaseNotes(release);

      Object.keys(releaseNote.issues).forEach((type) => {
        releaseNote.issues[type].forEach((issue) => {
          issue._links = {
            curies,
            "api:release": {
              href: `${API_BASE}${projectName}/${release.id}`,
            },
            "api:jira": {
              href: `https://issues.apache.org/jira/browse/${issue.issue}`,
            },
          };
        });
      });
      releaseData._embedded = {
        "api:releaseNote": releaseNote,
      };
      fs.mkdirSync(`docs/api/${projectName}/${release.id}`, {
        recursive: true,
      });
      fs.writeFileSync(
        `docs/api/${projectName}/${release.id}/index.json`,
        JSON.stringify(releaseData, null, 2)
      );
    }
    projectData._embedded["api:releases"].push(releaseData);
  }
  fs.mkdirSync(`docs/api/${projectName}`, {
    recursive: true,
  });
  fs.writeFileSync(
    `docs/api/${projectName}/index.json`,
    JSON.stringify(projectData, null, 2)
  );
}

(async () => {
  try {
    await run(new JiraClient(process.env));
  } catch (e) {
    console.log("Failed to get sling release info", e);
  }
})().then(
  () => process.exit(0),
  () => process.exit(1)
);
