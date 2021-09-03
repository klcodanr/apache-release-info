const { parse } = require("node-html-parser");
const fetch = require("node-fetch");

class JiraClient {
  /**
   * Constructs
   * @param {*} cfg the this.configuration for the client
   * @param {number} cfg.PROJECT_ID the project id in JIRA
   * @param {string} cfg.PROJECT_NAME the project name from JIRA
   * @param {string} cfg.JIRA_USERNAME the username for connecting to JIRA
   * @param {string} cfg.JIRA_PASSWORD the password for connecting to JIRA
   */
  constructor(cfg) {
    this.config = cfg;
  }

  /**
   *
   * @param {string} the project ID to use for connecting
   * @param {*} release the release object to get the notes from
   * @param {number} release.id id for the release
   * @param {string} release.name the release name string
   * @returns get the release notes object for the release
   */
  getReleaseNotes = async function (release) {
    console.log(`Getting release notes for ${release.name}`);
    const res = await fetch(
      `https://issues.apache.org/jira/secure/ReleaseNote.jspa?version=${release.id}&styleName=Text&projectId=${this.config.PROJECT_ID}`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(
            this.config.JIRA_USERNAME + ":" + this.config.JIRA_PASSWORD
          ).toString("base64")}`,
        },
      }
    );
    if (res.ok) {
      const html = await res.text();
      const noteStr = parse(html).querySelector("textarea").text;
      return this.parseReleaseNotes(noteStr);
    }
    throw new Error(
      `Recieved invalid response from JIRA: ${JSON.stringify(res)}`
    );
  };

  /**
   * Gets the releases for the project
   * @param {Date} month the month for which to get the resleases
   * @returns the releases for the project and for the particular month if specified
   */
  getReleases = async function (month) {
    console.log(`Loading releases for ${this.config.PROJECT_NAME}...`);
    const res = await fetch(
      `https://issues.apache.org/jira/rest/projects/1.0/project/${
        this.config.PROJECT_NAME
      }/release/allversions?_=${new Date().toISOString()}`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(
            this.config.JIRA_USERNAME + ":" + this.config.JIRA_PASSWORD
          ).toString("base64")}`,
        },
      }
    );

    if (res.ok) {
      let releases = await res.json();
      console.log(`Loaded ${releases.length} releases`);

      releases = releases.filter((r) => r.released);
      if (month) {
        const currentMonth = `${lastMonth.toISOString().substr(0, 7)}`;
        releases = releases.filter(
          (r) => r.releaseDate.iso.indexOf(currentMonth) === 0
        );
        console.log(
          `Loaded ${releases.length} releases for month ${currentMonth}`
        );
      }
      releases.forEach((r, idx) => {
        const match = r.name.match(/[0-9\.\-]+$/);
        if (match.length === 1) {
          releases[idx].module = r.name.replace(match[0], "").trim();
          releases[idx].version = match[0].trim();
        }
      });
      return releases;
    }
    throw new Error(
      `Recieved invalid response from JIRA: ${JSON.stringify(res)}`
    );
  };

  /**
   * Parses the release notes into a usable object
   * @param {*} notesStr The notes in a Markdown-esque string form
   * @returns the parsed release notes
   */
  parseReleaseNotes = function (notesStr) {
    const notes = { issues: {} };
    let currentType = "Misc";
    const lines = notesStr
      .split(/\n/)
      .map((n) => n.trim())
      .filter((n) => n !== "");
    lines
      .filter((n) => n.substr(0, 1) === "*")
      .forEach((n) => {
        if (n.substr(0, 2) === "**") {
          currentType = n.substr(2).trim();
        } else {
          if (!notes.issues[currentType]) {
            notes.issues[currentType] = [];
          }
          notes.issues[currentType].push(this.parseTicket(n));
        }
      });
    notes.description = lines.filter((n) => n.substr(0, 1) !== "*").join("\n");
    return notes;
  };

  /**
   * Parases a ticket from a release note string
   * @param {string} ticket the ticket to parse
   * @returns the parsed ticket
   */
  parseTicket = function (ticket) {
    const idx = ticket.indexOf(" - ");
    const issue = ticket.substr(3, idx - 4);
    const title = ticket.substr(idx + 3);
    return { issue, title };
  };
}
module.exports = JiraClient;
