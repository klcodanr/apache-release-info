require("dotenv").config();

const { getAsfProjects } = require("./lib/asf");
const log = require("./lib/log")();
const JiraClient = require("./lib/jira");
const fs = require("fs");

const API_BASE = "https://apis.danklco.com/apache-release-info/";
const JIRA_BASE_URL = process.env.JIRA_BASE_URL;
const SKIP_PROJECTS = [
  "AAR",
  "ASFSITE",
  "ATTIC",
  "COMDEV",
  "CS",
  "DI",
  "DORMANT",
  "INCUBATOR",
  "INFRA",
  "IMFRACLOUD1",
  "IMFRATEST3",
  "LABS",
  "PETRI",
  "PODLINGNAMESEARCH",
  "PRC",
  "STEVE",
  "TESTTTTT",
  "TM",
  "TRAINING",
  "TST",
];

let asfProjects;

/**
 * Runs the daily update to grab all public releases and store them to JSON.
 * @param {JiraClient} jira the jira client
 */
async function run(jira) {
  const projects = await jira.getProjects();
  asfProjects = await getAsfProjects();
  for (const project of projects) {
    if (SKIP_PROJECTS.indexOf(project.key) !== -1) {
      log.debug(`Skipping project: ${project.key}`);
      continue;
    }
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
      jira: { href: `${JIRA_BASE_URL}${release.url.replace("jira/", "")}` },
      project: { href: `${API_BASE}${project.key}` },
    },
  };
  fs.mkdirSync(`docs/api/${project.key}`, { recursive: true });
  if (!fs.existsSync(`docs/api/${project.key}/${release.id}/index.json`)) {
    log.debug("Creating release document");

    const releaseNote = await jira.getReleaseNotes(project.id, release);

    log.debug("Adding issues");
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

    log.debug("Saving release");
    fs.mkdirSync(`docs/api/${project.key}/${release.id}`, {
      recursive: true,
    });
    fs.writeFileSync(
      `docs/api/${project.key}/${release.id}/index.json`,
      JSON.stringify(releaseData, null, 2)
    );
  } else {
    log.debug("Reusing existing release file");
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

  log.debug("Loading index...");
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

  log.debug("Generating project data");
  const projectData = {
    name: project.name.replace(/^A[ap]{2}che\s/, ""),
    id: project.id,
    key: project.key,
    description: project.description,
    lastUpdated: Date.now(),
    type: "project",
    category: [],
    created: "",
    releaseCount: releases.length,
    programmingLanguage: [],
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
    ["description", "created"].forEach((k) => {
      projectData[k] = asfProjectData[k];
    });
    ["category", "programming-language"].forEach((k) => {
      projectData[k] = asfProjectData[k].split(/,\s*/);
    });
    if (asfProjectData.implements) {
      asfProjectData.implements.forEach((impl) => {
        projectData.category.push(`${impl.body}: ${impl.id}`);
      });
    }
  }

  const projectStr = JSON.stringify(projectData).toLowerCase();
  if (
    (projectStr.indexOf("retired") !== -1 ||
      projectStr.indexOf("attic") !== -1) &&
    projectData.category.indexOf("retired") === -1
  ) {
    projectData.category.push("retired");
  }
  if (
    projectStr.indexOf("incubator") !== -1 &&
    projectData.category.indexOf("incubator") !== -1
  ) {
    projectData.category.push("incubator");
  }

  log.debug("Updating index");
  indexData._embedded.projects.push(projectData);
  fs.writeFileSync("docs/api/index.json", JSON.stringify(indexData, null, 2));

  log.debug("Processing releases");
  projectData._embedded = {
    releases: [],
  };
  for (const release of releases) {
    const releaseData = await handleRelease(jira, project, release);
    delete releaseData._embedded;
    delete releaseData.releaseNote;
    projectData._embedded.releases.push(releaseData);
  }

  log.debug("Updating project");
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
