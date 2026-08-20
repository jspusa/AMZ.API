import packageMetadata from "../../../package.json";

function platformLabel(platform: NodeJS.Platform): string {
  if (platform === "darwin") return "macOS";
  if (platform === "win32") return "Windows";
  if (platform === "linux") return "Linux";
  return platform;
}

export function buildSpApiUserAgent(input: {
  platform: NodeJS.Platform;
  version: string;
}): string {
  const version = input.version.trim();
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new TypeError("SP-API User-Agent 版本無效。");
  }
  return `AMZ.API/${version} (Language=TypeScript; Platform=${platformLabel(input.platform)})`;
}

export function spApiUserAgent(): string {
  return buildSpApiUserAgent({
    platform: process.platform,
    version: packageMetadata.version,
  });
}
