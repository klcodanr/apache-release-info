const { getAsfProjects } = require("./lib/asf");
const log = require("./lib/log")();
const JiraClient = require("./lib/jira");
const fs = require("fs");
require("dotenv").config();

const API_BASE = "https://apis.danklco.com/apache-release-info/";
const JIRA_BASE_URL = process.env.JIRA_BASE_URL;

let asfProjects;

/**
 * Runs the daily update to grab all public releases and store them to JSON.
 * @param {JiraClient} jira the jira client
 */
async function run(jira) {
  const projects = await jira.getProjects();
  asfProjects = await getAsfProjects();
  for (const project of projects) {
    log.info(`Processing project: ${project.name}`);

    await updateProject(jira, await jira.getProjectDetails(project.id));
  }
}

/**
 * Handles creating a release if the release JSON does not already exist
 *
 * @param {JiraClient} jira the jira client
 * @param {*} project the project for the release
 * @param {*} release the release to handle
 */
async function handleRelease(jira, project, release) {
  const releaseData = {
    id: release.id,
    name: release.name,
    description: release.description,
    date: release.releaseDate.iso,
    version: release.version,
    module: release.module,
    lastUpdated: Date.now(),
    type: "release",
    _links: {
      self: { href: `${API_BASE}${project.key}/${release.id}` },
      jira: { href: `${JIRA_BASE_URL}${release.url}` },
      project: { href: `${API_BASE}${project.key}` },
    },
  };

  fs.mkdirSync(`docs/api/${project.key}`, { recursive: true });
  if (!fs.existsSync(`docs/api/${project.key}/${release.id}/index.json`)) {
    log.debug("Creating release document");
    const releaseNote = await jira.getReleaseNotes(project.id, release);

    releaseNote.issues.forEach((issue) => {
      issue._links = {
        release: {
          href: `${API_BASE}${project.key}/${release.id}`,
        },
        jira: {
          href: `${JIRA_BASE_URL}/browse/${issue.issue}`,
        },
      };
    });
    releaseData.releaseNotes = releaseNote.description;
    releaseData._embedded = {
      issues: releaseNote.issues,
    };
    fs.mkdirSync(`docs/api/${project.key}/${release.id}`, {
      recursive: true,
    });
    fs.writeFileSync(
      `docs/api/${project.key}/${release.id}/index.json`,
      JSON.stringify(releaseData, null, 2)
    );
  }
  return releaseData;
}

/**
 * Runs the daily update to grab all public releases and store them to JSON.
 * @param {JiraClient} jira the jira client
 * @param {*} project the project to update
 */
async function updateProject(jira, project) {
  const releases = (await jira.getReleases(project)).sort((a, b) =>
    a.releaseDate.iso.localeCompare(b.releaseDate.iso)
  );
  log.debug(`Found releases: ${releases.length}`);

  let indexData = {
    title: "Apache Release Information API",
    lastUpdated: Date.now(),
    type: "index",
    _links: {
      self: { href: `${API_BASE}` },
      documentation: {
        href: `https://www.danklco.com/api-docs/apache-release-info.html`,
      },
    },
    _embedded: {
      projects: [],
    },
  };
  fs.mkdirSync("docs/api/", { recursive: true });
  if (fs.existsSync("docs/api/index.json")) {
    indexData._embedded.projects = JSON.parse(
      fs.readFileSync("docs/api/index.json")
    )._embedded.projects.filter((proj) => proj.id !== project.id);
  }

  const projectData = {
    name: project.name,
    id: project.id,
    description: project.description,
    lastUpdated: Date.now(),
    type: "project",
    category: "",
    created: "",
    "programming-language": "",
    _links: {
      self: { href: `${API_BASE}${project.key}` },
      jira: {
        href: `${JIRA_BASE_URL}/projects/${project.key}`,
      },
      avatar: {
        href: project.avatarUrls["48x48"],
      },
      root: {
        href: API_BASE,
      },
      homepage: {
        href: project.url,
      },
    },
  };

  const asfProjectData = asfProjects[project.key];
  if (asfProjectData) {
    log.debug("Adding ASF Project data");
    ["description", "category", "created", "programming-language"].forEach(
      (k) => {
        projectData[k] = asfProjectData[k];
      }
    );
  }

  indexData._embedded.projects.push(projectData);
  fs.writeFileSync("docs/api/index.json", JSON.stringify(indexData, null, 2));

  projectData._embedded = {
    releases: [],
  };
  for (const release of releases) {
    const releaseData = await handleRelease(jira, project, release);
    delete releaseData._embedded;
    projectData._embedded.releases.push(releaseData);
  }
  fs.mkdirSync(`docs/api/${project.key}`, {
    recursive: true,
  });
  fs.writeFileSync(
    `docs/api/${project.key}/index.json`,
    JSON.stringify(projectData, null, 2)
  );
}

(async () => {
  try {
    await run(new JiraClient(process.env));
  } catch (e) {
    log.error("Failed to get sling release info", e);
    console.error(e);
  }
})().then(
  () => process.exit(0),
  () => process.exit(1)
);
