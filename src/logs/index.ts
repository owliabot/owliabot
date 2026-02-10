/**
 * Public surface of the logs module.
 */
export { streamLogs, type LogReaderOptions, type LogSource, matchesLevel, matchesGrep } from "./reader.js";
export { isInsideDocker, isDockerAvailable, isContainerRunning, dockerSource } from "./docker.js";
export { resolveLogFilePath, logFileExists, fileSource } from "./file.js";
export { detectLogSource } from "./detect.js";
