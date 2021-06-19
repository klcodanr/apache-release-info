require("dotenv").config();
const fs = require("fs");
const Handlebars = require("handlebars");
const puppeteer = require("puppeteer");

// Get ENV Variables
const {
  CMS_HOST,
  CMS_USERNAME,
  CMS_PASSWORD,
  CMS_PAGE_TEMPLATE,
  CMS_SITE_PATH,
  DATE,
  JIRA_USERNAME,
  JIRA_PASSWORD,
  PUPPETEER_HEADLESS,
} = process.env;

// Calculate Date
const lastMonth = DATE ? new Date(Date.parse(DATE)) : new Date();
lastMonth.setMonth(lastMonth.getMonth() - 1);
const year = lastMonth.getFullYear();
const month = lastMonth.toLocaleString("default", { month: "long" });
const monthCode = lastMonth.toLocaleDateString("en-US", {
  month: "2-digit",
});
console.log(`Gathering releases for ${month} ${year}`);

let page;
process.on("unhandledRejection", async (up) => {
  throw up;
});

async function createPost() {
  console.log("Creating post...");
  await page.goto(
    `${CMS_HOST}/cms/site/content.html${CMS_SITE_PATH}/posts/${year}/${monthCode}`,
    {
      waitUntil: "load",
    }
  );

  await page.click(
    `.button[href="/cms/page/create.html${CMS_SITE_PATH}/posts/${year}/${monthCode}"]`
  );
  await page.waitForSelector(".modal form");

  await page.select("#pageTemplate", CMS_PAGE_TEMPLATE);

  await page.waitForSelector("input[name=title]");

  await page.type(
    "input[name=title]",
    `This Month in Apache Sling: ${month} ${year}`
  );
  await page.type('input[name=":name"]', "this-month-apache-sling");
  await page.click(".modal button[type=submit]");

  await page.waitForResponse(
    `${CMS_HOST}${CMS_SITE_PATH}/posts/${year}/${monthCode}`
  );
  await removeModals(page);
  console.log("Post created successfully!");
}

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

async function loginCms() {
  console.log("Logging in to Sling CMS...");
  await page.goto(`${CMS_HOST}/system/sling/form/login`, {
    waitUntil: "load",
  });

  await page.waitForSelector("input[name=j_username]");
  await page.type("input[name=j_username]", CMS_USERNAME);
  await page.type("input[name=j_password]", CMS_PASSWORD);

  await page.keyboard.press("Enter");

  const loggedInUrl = `${CMS_HOST}/cms/start.html`;
  const currentUrl = await page.url();
  if (currentUrl !== loggedInUrl) {
    await page.waitForResponse(loggedInUrl);
  }
}

async function navigatePostMonth() {
  console.log("Navigating to post year...");
  await page.goto(`${CMS_HOST}/cms/site/content.html${CMS_SITE_PATH}/posts`, {
    waitUntil: "load",
  });
  if (!(await page.$(`.card[title="${year}"]`))) {
    console.log(`Creating folder for year ${year}`);
    await page.click(`a[href="/cms/folder/create.html${CMS_SITE_PATH}/posts"]`);
    await page.waitForSelector(".modal form");

    await page.type('input[name="jcr:content/jcr:title"]', `${year}`);
    await page.type('input[name=":name"]', `${year}`);
    await page.click(".modal button[type=submit]");

    await page.waitForResponse(`${CMS_HOST}${CMS_SITE_PATH}/posts/*`);
    console.log("Folder created successfully!");
    await removeModals(page);
  } else {
    console.log("Year folder already exists!");
  }

  console.log("Navigating to post month...");
  await page.goto(
    `${CMS_HOST}/cms/site/content.html${CMS_SITE_PATH}/posts/${year}`,
    {
      waitUntil: "load",
    }
  );

  if (!(await page.$(`.card[title="${monthCode}"]`))) {
    console.log(`Creating folder for month ${month}`);
    await page.click(
      `a[href="/cms/folder/create.html${CMS_SITE_PATH}/posts/${year}"]`
    );
    await page.waitForSelector(".modal form");

    await page.type('input[name="jcr:content/jcr:title"]', `${month} ${year}`);
    await page.type('input[name=":name"]', monthCode);
    await page.click(".modal button[type=submit]");

    await page.waitForResponse(`${CMS_HOST}${CMS_SITE_PATH}/posts/${year}/*`);
    await removeModals(page);
    console.log("Folder created successfully!");
  } else {
    console.log("Month folder already exists!");
  }
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

async function removeModals() {
  // Removes all modals on the page to avoid navigation denied errors
  await page.evaluate(() => {
    document.querySelectorAll(".modal").forEach((modal) => {
      modal.parentNode.removeChild(modal);
    });
  });
}

async function updatePostContent(html) {
  console.log("Updating post content...");
  await page.goto(
    `${CMS_HOST}/cms/editor/edit.html${CMS_SITE_PATH}/posts/${year}/${monthCode}/this-month-apache-sling/jcr:content/container/richtext?editor=/libs/sling-cms/components/general/richtext/edit`,
    {
      waitUntil: "load",
    }
  );

  console.log("Switching to source view...");
  await page.click('.button[data-wysihtml-action="change_view"]');

  console.log("Setting content...");
  await page.$eval(
    "textarea.rte-editor",
    (el, _html) => (el.value = _html),
    html
  );

  console.log("Saving changes...");
  await page.click("button[type=submit]");
  await page.waitForSelector(".modal");
  await removeModals(page);
  console.log("Post content updated successfully!");
}

(async () => {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: PUPPETEER_HEADLESS !== "false",
    });
    page = await browser.newPage();

    page.on("dialog", async (dialog) => {
      console.log(dialog.message());
      await dialog.dismiss();
      await browser.close();
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

    await loginCms();

    await navigatePostMonth();

    await createPost();

    await updatePostContent(html);
  } catch (e) {
    console.log("Failed to get sling release info", e);
    if (page) {
      console.log("Taking screenshot...");
      fs.mkdirSync("dist");
      await page.screenshot({ path: "dist/error.png" });
      await browser.close();
    }
    process.exit(1);
  }
})();
