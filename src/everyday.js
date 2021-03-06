require("dotenv").config();

const { getAsfProjects } = require("./lib/asf");
const log = require("./lib/log")();
const JiraClient = require("./lib/jira");
const fs = require("fs");
const { kStringMaxLength } = require("buffer");

const API_BASE = "https://apis.danklco.com/apache-release-info/";
const curies = [
  {
    name: "int",
    href: "https://www.danklco.com/api-docs/rels.html#{rel}",
    templated: true,
  },
  {
    name: "jira",
    href: "https://www.danklco.com/api-docs/rels.html#{rel}",
    templated: true,
  },
  {
    name: "proj",
    href: "https://www.danklco.com/api-docs/rels.html#{rel}",
    templated: true,
  },
];

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
  "INFRACLOUD1",
  "IMFRATEST3",
  "LABS",
  "LEGAL",
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
  if (process.env.MODE === "RECREATE" && fs.existsSync("docs/api/")) {
    log.info("Deleting existing API files");
    fs.rmSync("docs/api/", { recursive: true });
  }

  if (fs.existsSync("docs/api/index.json")) {
    log.debug("Removing existing index");
    fs.rmSync("docs/api/index.json");
  }

  const projects = await jira.getProjects();
  asfProjects = await getAsfProjects();

  let releases = [];
  let idx = 1;
  for (const project of projects) {
    if (SKIP_PROJECTS.indexOf(project.key) !== -1) {
      log.debug(`Skipping project: ${project.key}`);
      continue;
    }
    log.info(`Processing project: ${project.name} (${idx}/${projects.length})`);

    await updateProject(
      jira,
      await jira.getProjectDetails(project.id),
      releases
    );

    releases = releases
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 25);
    idx++;
  }

  fs.mkdirSync("docs/api/latest", { recursive: true });
  fs.writeFileSync(
    "docs/api/latest/index.json",
    JSON.stringify(
      {
        _embedded: {
          releases,
        },
      },
      null,
      2
    )
  );

  log.debug("Sorting projects by name");
  const index = JSON.parse(fs.readFileSync("docs/api/index.json"));
  index._links["int:latest"] = {
    title: "Latest Releases",
    href: `${API_BASE}/latest`,
  };
  index._embedded["int:projects"] = index._embedded["int:projects"].sort(
    (a, b) => a.name - b.name
  );
  fs.writeFileSync("docs/api/index.json", JSON.stringify(index, null, 2));
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
      curies,
      self: { href: `${API_BASE}${project.key}/${release.id}` },
      "int:project": {
        title: "The project containing this release",
        href: `${API_BASE}${project.key}`,
      },
      "int:root": {
        title: "The root of this API",
        href: `${API_BASE}`,
      },
      "jira:release": {
        title: "The release in ASF Jira",
        href: `${JIRA_BASE_URL}${release.url.replace("jira/", "")}`,
      },
      "jira:project": {
        title: "The project containing this release in ASF Jira",
        href: `${JIRA_BASE_URL}/projects/${project.key}`,
      },
    },
  };
  fs.mkdirSync(`docs/api/${project.key}`, { recursive: true });
  if (!fs.existsSync(`docs/api/${project.key}/${release.id}/index.json`)) {
    log.debug(`Creating release ${release.name}`);

    const releaseNote = await jira.getReleaseNotes(project.id, release);

    log.debug("Adding issues");
    releaseNote.issues.forEach((issue) => {
      issue._links = {
        curies,
        "int:release": {
          title: "The release containing this issue",
          href: `${API_BASE}${project.key}/${release.id}`,
        },
        "int:project": {
          title: "The project containing this issue",
          href: `${API_BASE}${project.key}`,
        },
        "int:root": {
          title: "The root of this API",
          href: `${API_BASE}`,
        },
        "jira:issue": {
          title: "The issue in ASF Jira",
          href: `${JIRA_BASE_URL}/browse/${issue.issue}`,
        },
        "jira:release": {
          title: "The release containing this issue in ASF Jira",
          href: `${JIRA_BASE_URL}${release.url.replace("jira/", "")}`,
        },
        "jira:project": {
          title: "The project containing this issue in ASF Jira",
          href: `${JIRA_BASE_URL}/projects/${project.key}`,
        },
      };
    });
    releaseData.releaseNotes = releaseNote.description;
    releaseData._embedded = {
      "int:issues": releaseNote.issues,
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
    log.debug(`Reusing existing release file for ${release.name}`);
  }
  return releaseData;
}

/**
 * Runs the daily update to grab all public releases and store them to JSON.
 * @param {JiraClient} jira the jira client
 * @param {*} project the project to update
 * @param {Array} allReleases the releases
 */
async function updateProject(jira, project, allReleases) {
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
      curies,
      self: { href: `${API_BASE}` },
    },
    _embedded: {
      "int:projects": [],
    },
  };
  fs.mkdirSync("docs/api/", { recursive: true });
  if (fs.existsSync("docs/api/index.json")) {
    indexData._embedded["int:projects"] = JSON.parse(
      fs.readFileSync("docs/api/index.json")
    )._embedded["int:projects"].filter((proj) => proj.id !== project.id);
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
      curies,
      self: { href: `${API_BASE}${project.key}` },
      "int:root": {
        title: "The root of this API",
        href: API_BASE,
      },
      "jira:project": {
        title: "The project in ASF Jira",
        href: `${JIRA_BASE_URL}/projects/${project.key}`,
      },
      "proj:logo": {
        title: "The logo for this project",
        href: project.avatarUrls["48x48"],
      },
      "proj:homepage": {
        title: "The homepage of this project",
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
    if (asfProjectData.category) {
      projectData.category = asfProjectData.category.split(/,\s*/);
    }
    if (asfProjectData["programming-language"]) {
      projectData.programmingLanguage =
        asfProjectData["programming-language"].split(/,\s*/);
    }
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
  indexData._embedded["int:projects"].push(projectData);
  fs.writeFileSync("docs/api/index.json", JSON.stringify(indexData, null, 2));

  log.debug("Processing releases");
  projectData._embedded = {
    "int:releases": [],
  };
  for (const release of releases) {
    const releaseData = await handleRelease(jira, project, release);
    delete releaseData._embedded;
    delete releaseData.releaseNote;
    allReleases.push(releaseData);
    projectData._embedded["int:releases"].push(releaseData);
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
    const start = Date.now();
    await run(new JiraClient(process.env));
    log.info(`Updated releases in ${Date.now() / 1000 - start / 1000}sec`);
  } catch (e) {
    log.error("Failed to get apache release info", e);
    console.error(e);
    process.exit(1);
  }
})().then(
  () => process.exit(0),
  () => process.exit(1)
);
