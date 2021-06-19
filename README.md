# Sling Release Info

Aggregates each month's Apache Sling Releases and release notes and creates a page in a Sling CMS instance with the release information.

## Use

To install run: `npm install`

To run:

 1. Set the following in your .env file or Environment variables: 
  - JIRA_USERNAME
  - JIRA_PASSWORD
  - CMS_USERNAME
  - CMS_PASSWORD
  - DATE (optional, override date)
  - PUPPETEER_HEADLESS (optional, controls pupeteers headless mode)
 2. run: `node .`
