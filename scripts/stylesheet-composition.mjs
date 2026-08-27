import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import {
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import postcss from "postcss";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const QUOTED_IMPORT_PATTERN = /^(?:"([^"]+)"|'([^']+)')$/u;

function compositionError(message, cause) {
  return new Error(`Stylesheet composition rejected: ${message}`, {
    ...(cause === undefined ? {} : { cause }),
  });
}

async function canonicalFilePath(path, role) {
  try {
    return await realpath(path);
  } catch (error) {
    throw compositionError(`${role} is missing: ${path}`, error);
  }
}

function isWithinRoot(path, rootDirectory) {
  const fromRoot = relative(rootDirectory, path);
  return fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot));
}

function logicalFilePath(path, rootDirectory) {
  return relative(rootDirectory, path).split(sep).join("/");
}

function localImportSpecifier(params, importingFile) {
  const match = params.trim().match(QUOTED_IMPORT_PATTERN);
  const specifier = match?.[1] ?? match?.[2];
  if (!specifier) {
    throw compositionError(
      `unsupported or qualified @import in ${importingFile}: ${params}`,
    );
  }
  if (
    !(specifier.startsWith("./") || specifier.startsWith("../")) ||
    specifier.includes("\\") ||
    specifier.includes("?") ||
    specifier.includes("#") ||
    extname(specifier).toLowerCase() !== ".css"
  ) {
    throw compositionError(
      `@import must be one plain local relative .css path in ${importingFile}: ${specifier}`,
    );
  }
  return specifier;
}

function canonicalNode(node) {
  if (node.type === "comment") return null;
  if (node.type === "decl") {
    return ["decl", node.prop, node.value, node.important];
  }
  if (node.type === "rule") {
    return [
      "rule",
      node.selector,
      node.nodes.map(canonicalNode).filter(Boolean),
    ];
  }
  if (node.type === "atrule") {
    return [
      "atrule",
      node.name,
      node.params,
      node.nodes ? node.nodes.map(canonicalNode).filter(Boolean) : null,
    ];
  }
  return [node.type];
}

async function composeFile(path, context) {
  const filePath = await canonicalFilePath(path, "imported stylesheet");
  if (!isWithinRoot(filePath, context.rootDirectory)) {
    throw compositionError(`import escapes the stylesheet root: ${filePath}`);
  }
  if (context.active.includes(filePath)) {
    const cycleStart = context.active.indexOf(filePath);
    const cycle = [...context.active.slice(cycleStart), filePath].join(" -> ");
    throw compositionError(`import cycle: ${cycle}`);
  }
  if (context.seen.has(filePath)) {
    throw compositionError(`duplicate import: ${filePath}`);
  }

  context.seen.add(filePath);
  context.active.push(filePath);
  context.files.push(filePath);
  try {
    const source = await readFile(filePath, "utf8");
    let root;
    try {
      root = postcss.parse(source, { from: filePath });
    } catch (error) {
      throw compositionError(`invalid CSS in ${filePath}`, error);
    }

    root.walkAtRules((atRule) => {
      if (atRule.name.toLowerCase() === "import" && atRule.parent !== root) {
        throw compositionError(`nested @import in ${filePath}`);
      }
    });

    const imports = root.nodes.filter(
      (node) => node.type === "atrule" && node.name.toLowerCase() === "import",
    );
    if (imports.length === 0) {
      return { css: source, nodes: [...root.nodes] };
    }

    let encounteredRule = false;
    const cssParts = [];
    const nodes = [];
    for (const node of root.nodes) {
      if (node.type === "comment") continue;
      if (node.type === "atrule" && node.name.toLowerCase() === "import") {
        if (encounteredRule) {
          throw compositionError(`@import appears after CSS rules in ${filePath}`);
        }
        const specifier = localImportSpecifier(node.params, filePath);
        const imported = await composeFile(
          resolve(dirname(filePath), specifier),
          context,
        );
        cssParts.push(imported.css);
        nodes.push(...imported.nodes);
        continue;
      }
      encounteredRule = true;
      throw compositionError(
        `composition manifest must contain only comments and @import rules: ${filePath}`,
      );
    }
    return { css: cssParts.join(""), nodes };
  } finally {
    context.active.pop();
  }
}

/**
 * Recursively resolves one ordered local stylesheet composition and rejects any
 * graph or rule-stream drift before returning the import-free logical stream.
 */
export async function verifyStylesheetComposition({
  entryPath,
  rootDirectory,
  expectedFiles,
  expectedFingerprint,
}) {
  if (!SHA256_PATTERN.test(expectedFingerprint)) {
    throw compositionError("expectedFingerprint must be one lowercase SHA-256");
  }
  const canonicalRoot = await canonicalFilePath(rootDirectory, "stylesheet root");
  const canonicalEntry = await canonicalFilePath(entryPath, "stylesheet entry");
  if (!isWithinRoot(canonicalEntry, canonicalRoot)) {
    throw compositionError(`entry escapes the stylesheet root: ${canonicalEntry}`);
  }

  const context = {
    active: [],
    files: [],
    rootDirectory: canonicalRoot,
    seen: new Set(),
  };
  const composition = await composeFile(canonicalEntry, context);
  const logicalFiles = context.files.map((file) =>
    logicalFilePath(file, canonicalRoot),
  );
  if (
    expectedFiles !== undefined &&
    JSON.stringify(logicalFiles) !== JSON.stringify(expectedFiles)
  ) {
    throw compositionError(
      `ordered stylesheet files changed: expected ${JSON.stringify(expectedFiles)}, received ${JSON.stringify(logicalFiles)}`,
    );
  }
  const canonicalJson = JSON.stringify([
    "root",
    composition.nodes.map(canonicalNode).filter(Boolean),
  ]);
  const fingerprint = createHash("sha256")
    .update(canonicalJson)
    .digest("hex");
  if (fingerprint !== expectedFingerprint) {
    throw compositionError(
      `ordered rule-stream fingerprint changed: expected ${expectedFingerprint}, received ${fingerprint}`,
    );
  }

  return Object.freeze({
    canonicalJson,
    css: composition.css,
    files: Object.freeze([...context.files]),
    fingerprint,
  });
}
