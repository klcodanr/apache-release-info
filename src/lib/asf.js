
const fetch = require("node-fetch");

module.exports.getAsfProjects = async function () {
  const res = await fetch(
    "https://projects.apache.org/json/foundation/projects.json"
  );
  const projects = {};
  const projectJson = await res.json();
  Object.keys(projectJson).forEach((pk) => {
    const project = projectJson[pk];
    if (
      project["bug-database"] &&
      project["bug-database"].indexOf("https://issues.apache.org/jira/") !== -1
    ) {
      const projectKeys = [];

      project["bug-database"].split(",").forEach((k) => {
        projectKeys.push(
          k
            .replace("https://issues.apache.org/jira/browse/", "")
            .replace("https://issues.apache.org/jira/projects/", "")
            .replace("/", "")
            .toUpperCase()
            .trim()
        );
      });
      projectKeys.forEach((k) => (projects[k] = project));
    }
  });
  return projects;
};
