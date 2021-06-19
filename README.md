# Sling Release Info

Aggregates each month's Apache Sling Releases and release notes and sends an email with the releases.

## Use

To install run: `npm install`

To run:

 1. Set the following in your .env file or Environment variables: 
  - JIRA_USERNAME
  - JIRA_PASSWORD
  - DATE (optional, override date)
  - PUPPETEER_HEADLESS (optional, controls pupeteers headless mode)
  - MAIL_HOST
  - MAIL_USERNAME
  - MAIL_SENDER
  - MAIL_PASSWORD
  - MAIL_RECIPIENT
 2. run: `node .`
