import { exec } from "node:child_process";

const TIMEOUT_MS = 15_000;

/**
 * Execute an ncm-cli command and return parsed JSON or raw text.
 * @param {string} cmd - The ncm-cli command (without the leading "ncm-cli")
 * @param {number} [timeout] - Timeout in milliseconds
 * @returns {Promise<any>} Parsed JSON object, or { raw: string } if not JSON
 */
export function execNcm(cmd, timeout = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const fullCmd = `ncm-cli ${cmd}`;
    exec(fullCmd, { timeout, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        const msg = stderr?.trim() || error.message;
        return reject(new Error(`ncm-cli error (${error.code}): ${msg}`));
      }
      const text = stdout.trim();
      if (!text) {
        return resolve(null);
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        resolve({ raw: text });
      }
    });
  });
}

/**
 * Check whether ncm-cli is installed and available on PATH.
 * @returns {Promise<{ available: boolean, version?: string }>}
 */
export function isNcmAvailable() {
  return new Promise((resolve) => {
    exec("ncm-cli --version", { windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve({ available: false });
      } else {
        resolve({ available: true, version: stdout.trim() });
      }
    });
  });
}

/**
 * Escape a string for safe use as a shell argument.
 * Wraps in double quotes and escapes embedded double quotes and backticks.
 */
export function escapeShellArg(str) {
  return `"${str.replace(/["`$\\]/g, "\\$&")}"`;
}
