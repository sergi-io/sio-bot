// OS Report using Bun
import os, { totalmem } from 'os';

export function getOSReport() {
  return {
    platform: os.platform(),
    type: os.type(),
    release: os.release(),
    arch: os.arch(),
    hostname: os.hostname(),
    uptime: os.uptime(),
    totalmem: os.totalmem(),
    freemem: os.freemem(),
    totalmemInGB: totalmem() / 1024 ** 3, // Convert bytes to GB
    freememInGB: os.freemem() / 1024 ** 3,
    cpuCount: os.cpus().length,
    // cpus: os.cpus(),
    loadavg: os.loadavg(),
    // networkInterfaces: os.networkInterfaces(),
    userInfo: os.userInfo(),
    homedir: os.homedir(),
    tmpdir: os.tmpdir(),
    endianness: os.endianness(),
    version: os.version ? os.version() : undefined,
  };
}

// Print the report if run directly
if (import.meta.main) {
  console.log(JSON.stringify(getOSReport(), null, 2));
}
