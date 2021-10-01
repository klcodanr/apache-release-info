require("dotenv").config();

const log = require("./log")();
const { parse } = require("node-html-parser");
const fetch = require("node-fetch");

class JiraClient {
  /**
   * Constructs a new jira client
   * @param {*} cfg the this.configuration for the client
   * @param {string} cfg.JIRA_USERNAME the username for connecting to JIRA
   * @param {string} cfg.JIRA_PASSWORD the password for connecting to JIRA
   * @param {string} cfg.JIRA_BASE_URL the base URL for JIRA
   */
  constructor(cfg) {
    this.config = cfg;
  }

  /**
   * Gets the projects from Apache Jira
   *
   * @returns the projects from Jira
   */
  getProjects = async function () {
    //https://issues.apache.org/jira/rest/api/2/project
    
    log.debug(`Getting projects`);
    const res = await fetch(
      `${this.config.JIRA_BASE_URL}/rest/api/2/project`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(
            this.config.JIRA_USERNAME + ":" + this.config.JIRA_PASSWORD
          ).toString("base64")}`,
        },
      }
    );
    if (res.ok) {
      return res.json();
    }
    throw new Error(
      `Recieved invalid response from JIRA: ${JSON.stringify(res)}`
    );
  };

  /**
   * Gets the deteails for a project
   * @param {number} projectId id for the project
   * @returns the projects from Jira
   */
  getProjectDetails = async function (projectId) {
    log.debug(`Getting project details for ${projectId}`);
    const res = await fetch(
      `${this.config.JIRA_BASE_URL}/rest/api/2/project/${projectId}`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(
            this.config.JIRA_USERNAME + ":" + this.config.JIRA_PASSWORD
          ).toString("base64")}`,
        },
      }
    );
    if (res.ok) {
      return res.json();
    }
    throw new Error(
      `Recieved invalid response from JIRA: ${JSON.stringify(res)}`
    );
  };

  /**
   * Retrieves the release notes for a particular release id
   * @param {number} projectId id the project the release is part of
   * @param {*} release the release object to get the notes from
   * @param {number} release.id id for the release
   * @param {string} release.name the release name string
   * @returns get the release notes object for the release
   */
  getReleaseNotes = async function (projectId, release) {
    log.info(`Getting release notes for ${release.name}`);
    const res = await fetch(
      `${this.config.JIRA_BASE_URL}/secure/ReleaseNote.jspa?version=${release.id}&styleName=Text&projectId=${projectId}`,
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
   * Gets the releases for the requested project
   * @param {*} project the project fro which to get the releases
   * @param {string} project.key the JIRA project key
   * @param {Date} month the month for which to get the releases
   * @returns the releases for the project and for the particular month if specified
   */
  getReleases = async function (project, month) {
    log.debug(`Loading releases for ${project.name}...`);
    const res = await fetch(
      `${this.config.JIRA_BASE_URL}/rest/projects/1.0/project/${
        project.key
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

      releases = releases.filter((r) => r.released);
      log.info(`Loaded ${releases.length} releases`);
      if (month) {
        const currentMonth = `${lastMonth.toISOString().substr(0, 7)}`;
        releases = releases.filter(
          (r) => r.releaseDate.iso.indexOf(currentMonth) === 0
        );
        log.info(
          `Loaded ${releases.length} releases for month ${currentMonth}`
        );
      }
      releases.forEach((r, idx) => {
        const match = r.name.match(/[0-9\.\-]+$/);
        if (match && match.length === 1) {
          releases[idx].module = r.name.replace(match[0], "").trim();
          releases[idx].version = match[0].trim().replace(/^-/, "");
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
    const notes = { issues: [] };
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
          const issue = this.parseTicket(n);
          issue.type = currentType;
          notes.issues.push(issue);
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
