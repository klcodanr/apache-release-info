require("dotenv").config();
const fs = require("fs");
const Handlebars = require("handlebars");
const puppeteer = require("puppeteer");

// Get ENV Variables
const { DATE, JIRA_USERNAME, JIRA_PASSWORD, PUPPETEER_HEADLESS } = process.env;

// Calculate Date
const lastMonth = DATE ? new Date(Date.parse(DATE)) : new Date();
lastMonth.setMonth(lastMonth.getMonth() - 1);
const year = lastMonth.getFullYear();
const month = lastMonth.toLocaleString("default", { month: "long" });
console.log(`Gathering releases for ${month} ${year}`);

let page;
process.on("unhandledRejection", (up) => {
  throw up;
});

function generateHtml(releases = []) {
  const data = {
    month,
    year,
    releases,
  };

  const template = Handlebars.compile(
    fs.readFileSync("./src/notes.hbs").toString()
  );
  return template(data);
}

async function getReleaseNotes(release = {}) {
  console.log(`Getting release notes for ${release.name}`);
  await page.goto(
    `https://issues.apache.org/jira/secure/ReleaseNote.jspa?version=${release.id}&styleName=Text&projectId=12310710`,
    {
      waitUntil: "load",
    }
  );
  await page.content();
  let noteStr = await page.evaluate(() => {
    return document.querySelector("textarea").value;
  });
  return parseReleaseNotes(noteStr);
}

async function getReleases() {
  console.log("Loading releases...");
  await page.goto(
    `https://issues.apache.org/jira/rest/projects/1.0/project/SLING/release/allversions?_=${new Date().toISOString()}`,
    {
      waitUntil: "load",
    }
  );
  await page.content();
  let releases = await page.evaluate(() => {
    return JSON.parse(document.querySelector("body").innerText);
  });

  console.log(`Loaded ${releases.length} releases`);
  const currentMonth = `${lastMonth.toISOString().substr(0, 7)}`;
  releases = releases.filter(
    (r) => r.released && r.releaseDate.iso.indexOf(currentMonth) === 0
  );
  return releases;
}

async function loginJira() {
  console.log("Logging in to JIRA...");
  await page.goto("https://issues.apache.org/jira/secure/Dashboard.jspa", {
    waitUntil: "load",
  });
  await page.type("#login-form-username", JIRA_USERNAME);
  await page.type("#login-form-password", JIRA_PASSWORD);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2000);
}

function parseReleaseNotes(notesStr = "") {
  const notes = {};
  let currentType = "Misc";
  notesStr
    .split(/\n/)
    .map((n) => n.trim())
    .filter((n) => n !== "" && n.substr(0, 1) === "*")
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
  const issue = ticket.substr(3, idx - 4);
  const title = ticket.substr(idx + 3);
  return { issue, title };
}

async function run() {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: PUPPETEER_HEADLESS !== "false",
    });
    page = await browser.newPage();

    page.on("dialog", async (dialog) => {
      console.log(dialog.message());
      await dialog.dismiss();
    });

    await loginJira();

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
  } catch (e) {
    if (page) {
      if (!fs.existsSync("./dist")) {
        console.log("Creating dist...");
        fs.mkdirSync("./dist");
      }
      console.log("Taking screenshot...");
      await page.emulateMediaType("screen");
      await page.pdf({ path: "./dist/error.pdf" });
      console.log("Screenshot taken...");
    }

    if (browser) {
      console.log("Closing browser...");
      await browser.close();
    }
    throw e;
  }
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
