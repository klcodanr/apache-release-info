const winston = require("winston");

const format = winston.format.combine(
  winston.format.colorize(),
  winston.format.errors({ stack: true }),
  winston.format.timestamp(),
  winston.format.align(),
  winston.format.printf((info) => {
    if (info.meta && info.meta instanceof Error) {
      info.message = `${info.message} ${info.meta.stack}`;
    }
    return `${info.timestamp} ${info.level}: ${info.message}`;
  })
);

module.exports = function () {
  return winston.createLogger({
    format,
    transports: [new winston.transports.Console()],
    level: process.env.LOG_LEVEL || "info",
  });
};
