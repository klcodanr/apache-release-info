require("dotenv").config();
const fetch = require("node-fetch");
const fs = require("fs");
const Handlebars = require("handlebars");
const { parse } = require("node-html-parser");

// Get ENV Variables
const {
  DATE,
  JIRA_USERNAME,
  JIRA_PASSWORD,
  PROJECT_ID,
  PROJECT_NAME,
} = process.env;

// Calculate Date
const lastMonth = DATE ? new Date(Date.parse(DATE)) : new Date();
lastMonth.setMonth(lastMonth.getMonth() - 1);
const year = lastMonth.getFullYear();
const month = lastMonth.toLocaleString("default", { month: "long" });
console.log(`Gathering releases for ${month} ${year}`);

process.on("unhandledRejection", (up) => {
  throw up;
});

function generateHtml(releases = []) {
  const data = {
    month,
    year,
    releases,
    PROJECT_NAME,
  };

  const template = Handlebars.compile(
    fs.readFileSync("./src/notes.hbs").toString()
  );
  return template(data);
}

async function getReleaseNotes(release = {}) {
  console.log(`Getting release notes for ${release.name}`);
  const res = await fetch(
    `https://issues.apache.org/jira/secure/ReleaseNote.jspa?version=${release.id}&styleName=Text&projectId=${PROJECT_ID}`,
    {
      headers: {
        Authorization: `Basic ${Buffer.from(
          JIRA_USERNAME + ":" + JIRA_PASSWORD
        ).toString("base64")}`,
      },
    }
  );
  if (res.ok) {
    const html = await res.text();
    const noteStr = parse(html).querySelector("textarea").text;
    return parseReleaseNotes(noteStr);
  }
  throw new Error(
    `Recieved invalid response from JIRA: ${JSON.stringify(res)}`
  );
}

async function getReleases() {
  console.log("Loading releases...");
  const res = await fetch(
    `https://issues.apache.org/jira/rest/projects/1.0/project/${PROJECT_NAME}/release/allversions?_=${new Date().toISOString()}`,
    {
      headers: {
        Authorization: `Basic ${Buffer.from(
          JIRA_USERNAME + ":" + JIRA_PASSWORD
        ).toString("base64")}`,
      },
    }
  );

  if (res.ok) {
    let releases = await res.json();
    console.log(`Loaded ${releases.length} releases`);
    const currentMonth = `${lastMonth.toISOString().substr(0, 7)}`;
    releases = releases.filter(
      (r) => r.released && r.releaseDate.iso.indexOf(currentMonth) === 0
    );
    return releases;
  }
  throw new Error(
    `Recieved invalid response from JIRA: ${JSON.stringify(res)}`
  );
}

function parseReleaseNotes(notesStr = "") {
  const notes = {};
  let currentType = "Misc";
  notesStr
    .split(/\n/)
    .map((n) => n.trim())
    .filter((n) => n !== "" && n.substring(0, 1) === "*")
    .forEach((n) => {
      if (n.substr(0, 2) === "**") {
        currentType = n.substr(2).trim();
      } else {
        if (!notes[currentType]) {
          notes[currentType] = [];
        }
        notes[currentType].push(parseTicket(n));
      }
    });
  return notes;
}

function parseTicket(ticket = "") {
  const idx = ticket.indexOf(" - ");
  const issue = ticket.substring(3, idx - 4);
  const title = ticket.substring(idx + 3);
  return { issue, title };
}

async function run() {
  const releases = (await getReleases()).sort((a, b) =>
    a.releaseDate.iso.localeCompare(b.releaseDate.iso)
  );

  console.log(`Releases this month: ${releases.length}`);

  for (const release of releases) {
    release.notes = await getReleaseNotes(release);
  }

  const html = generateHtml(releases);

  console.log("Writing HTML to dist...");
  if (!fs.existsSync("./dist")) {
    console.log("Creating dist...");
    fs.mkdirSync("./dist");
  }
  fs.writeFileSync("./dist/releases.html", html);
  console.log("Releases processed successfully!");
}

(async () => {
  try {
    await run();
  } catch (e) {
    console.log("Failed to get sling release info", e);
  }
})().then(
  () => process.exit(0),
  () => process.exit(1)
);
