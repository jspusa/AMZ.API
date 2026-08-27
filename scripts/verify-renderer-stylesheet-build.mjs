import { readFile, realpath } from "node:fs/promises";
import {
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { pathToFileURL } from "node:url";
import { RENDERER_STYLESHEET_CONTRACT } from "./renderer-stylesheet-contract.mjs";
import { verifyStylesheetComposition } from "./stylesheet-composition.mjs";

const ALLOWED_RENDERER_HTML_ELEMENTS = new Set([
  "body",
  "div",
  "head",
  "html",
  "link",
  "meta",
  "script",
  "title",
]);
const APPROVED_RENDERER_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'";
const SAFE_LOCAL_CSS_ASSET_PATTERN =
  /^\.\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9][A-Za-z0-9_.-]*\.css$/u;

function buildVerificationError(message, cause) {
  return new Error(`Renderer stylesheet build rejected: ${message}`, {
    ...(cause === undefined ? {} : { cause }),
  });
}

function isHtmlSpace(character) {
  return /[\t\n\f\r ]/u.test(character);
}

function trimHtmlSpaces(value) {
  return value.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/gu, "");
}

function tagStartsAt(html, index, name) {
  const prefix = `<${name}`;
  if (html.slice(index, index + prefix.length).toLowerCase() !== prefix) {
    return false;
  }
  const boundary = html[index + prefix.length];
  return boundary === undefined || isHtmlSpace(boundary) || boundary === "/" || boundary === ">";
}

function isHtmlTagOpener(html, index) {
  const first = html[index + 1];
  if (first === "!" || first === "?") return true;
  if (first === "/") return /[A-Za-z]/u.test(html[index + 2] ?? "");
  return /[A-Za-z]/u.test(first ?? "");
}

function htmlTagDescriptor(html, index) {
  let cursor = index + 1;
  const closing = html[cursor] === "/";
  if (closing) cursor += 1;
  const match = html.slice(cursor).match(/^[A-Za-z][A-Za-z0-9:-]*/u);
  if (!match) return null;
  return { closing, name: match[0].toLowerCase() };
}

function asciiEqualsIgnoreCase(actual, expected) {
  if (actual.length !== expected.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    const actualCode = actual.charCodeAt(index);
    const foldedActualCode =
      actualCode >= 65 && actualCode <= 90 ? actualCode + 32 : actualCode;
    if (foldedActualCode !== expected.charCodeAt(index)) return false;
  }
  return true;
}

function canonicalRawTextEnd(html, start, name) {
  const prefix = `</${name}`;
  const canonical = `${prefix}>`;
  for (
    let candidate = html.indexOf("</", start);
    candidate !== -1;
    candidate = html.indexOf("</", candidate + 2)
  ) {
    if (
      !asciiEqualsIgnoreCase(
        html.slice(candidate, candidate + prefix.length),
        prefix,
      )
    ) {
      continue;
    }
    const delimiter = html[candidate + prefix.length];
    if (
      delimiter !== ">" &&
      delimiter !== "/" &&
      !isHtmlSpace(delimiter)
    ) {
      continue;
    }
    const closing = readHtmlTag(html, candidate);
    if (closing.source !== canonical) {
      throw buildVerificationError(
        `non-canonical ${canonical} raw-text closer`,
      );
    }
    return closing.end;
  }
  throw buildVerificationError(`unterminated <${name}> element`);
}

function readHtmlTag(html, start) {
  let quote = null;
  for (let index = start + 1; index < html.length; index += 1) {
    const character = html[index];
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") {
      return { end: index + 1, source: html.slice(start, index + 1) };
    }
  }
  throw buildVerificationError(`unterminated HTML tag at byte ${start}`);
}

function parseQuotedAttributes(tag, name) {
  const attributes = new Map();
  let index = name.length + 1;
  const end = tag.length - 1;
  while (index < end) {
    while (index < end && isHtmlSpace(tag[index])) index += 1;
    if (index >= end) break;
    if (tag[index] === "/") {
      index += 1;
      while (index < end && isHtmlSpace(tag[index])) index += 1;
      if (index !== end) {
        throw buildVerificationError(`invalid <${name}> closing syntax`);
      }
      break;
    }

    const attributeStart = index;
    while (
      index < end &&
      !isHtmlSpace(tag[index]) &&
      tag[index] !== "/" &&
      tag[index] !== "="
    ) {
      index += 1;
    }
    if (attributeStart === index) {
      throw buildVerificationError(`invalid <${name}> attribute syntax`);
    }
    const attributeName = tag.slice(attributeStart, index).toLowerCase();
    if (attributes.has(attributeName)) {
      throw buildVerificationError(`duplicate <${name}> attribute: ${attributeName}`);
    }
    while (index < end && isHtmlSpace(tag[index])) index += 1;

    let value = null;
    if (tag[index] === "=") {
      index += 1;
      while (index < end && isHtmlSpace(tag[index])) index += 1;
      const quote = tag[index];
      if (quote !== '"' && quote !== "'") {
        throw buildVerificationError(
          `<${name}> attribute values must be quoted: ${attributeName}`,
        );
      }
      index += 1;
      const valueStart = index;
      while (index < end && tag[index] !== quote) index += 1;
      if (index >= end) {
        throw buildVerificationError(
          `unterminated <${name}> attribute: ${attributeName}`,
        );
      }
      value = tag.slice(valueStart, index);
      index += 1;
    }
    attributes.set(attributeName, value);
  }
  return attributes;
}

function stylesheetHrefs(html) {
  const hrefs = [];
  let contentSecurityPolicyCount = 0;
  for (let index = 0; index < html.length; ) {
    const nextTag = html.indexOf("<", index);
    if (nextTag === -1) break;
    if (html.startsWith("<!--", nextTag)) {
      throw buildVerificationError(
        "renderer HTML comments are not allowed in the verified document",
      );
    }
    if (tagStartsAt(html, nextTag, "script")) {
      const opening = readHtmlTag(html, nextTag);
      const closingEnd = canonicalRawTextEnd(html, opening.end, "script");
      if (closingEnd !== opening.end + "</script>".length) {
        throw buildVerificationError(
          "renderer HTML must not contain inline script content",
        );
      }
      index = closingEnd;
      continue;
    }
    if (tagStartsAt(html, nextTag, "style")) {
      throw buildVerificationError("unverified inline stylesheet in renderer HTML");
    }
    if (
      tagStartsAt(html, nextTag, "template") ||
      tagStartsAt(html, nextTag, "noscript")
    ) {
      throw buildVerificationError(
        "stylesheet verification does not allow inert HTML containers",
      );
    }
    if (!isHtmlTagOpener(html, nextTag)) {
      index = nextTag + 1;
      continue;
    }
    if (html[nextTag + 1] === "!" || html[nextTag + 1] === "?") {
      const declaration = readHtmlTag(html, nextTag);
      if (
        !/^<!doctype[\t\n\f\r ]+html[\t\n\f\r ]*>$/iu.test(
          declaration.source,
        )
      ) {
        throw buildVerificationError(
          "renderer HTML contains an unsupported declaration",
        );
      }
      index = declaration.end;
      continue;
    }
    const descriptor = htmlTagDescriptor(html, nextTag);
    if (!descriptor || !ALLOWED_RENDERER_HTML_ELEMENTS.has(descriptor.name)) {
      throw buildVerificationError(
        `renderer HTML contains an unsupported element: ${descriptor?.name ?? "unknown"}`,
      );
    }
    if (!descriptor.closing && descriptor.name === "title") {
      const opening = readHtmlTag(html, nextTag);
      index = canonicalRawTextEnd(html, opening.end, "title");
      continue;
    }
    if (!descriptor.closing && descriptor.name === "meta") {
      const meta = readHtmlTag(html, nextTag);
      const attributes = parseQuotedAttributes(meta.source, "meta");
      const httpEquiv = attributes.get("http-equiv");
      if (typeof httpEquiv === "string" && httpEquiv.includes("&")) {
        throw buildVerificationError(
          "renderer meta attributes must not hide semantics in character references",
        );
      }
      if (
        typeof httpEquiv === "string" &&
        trimHtmlSpaces(httpEquiv.toLowerCase()) ===
          "content-security-policy"
      ) {
        contentSecurityPolicyCount += 1;
        if (
          contentSecurityPolicyCount !== 1 ||
          attributes.get("content") !== APPROVED_RENDERER_CSP
        ) {
          throw buildVerificationError(
            "renderer Content-Security-Policy differs from the approved policy",
          );
        }
      }
      index = meta.end;
      continue;
    }
    if (!tagStartsAt(html, nextTag, "link")) {
      index = readHtmlTag(html, nextTag).end;
      continue;
    }

    const link = readHtmlTag(html, nextTag);
    const attributes = parseQuotedAttributes(link.source, "link");
    const rel = attributes.get("rel");
    if (typeof rel === "string" && rel.includes("&")) {
      throw buildVerificationError(
        "stylesheet-related link attributes must not contain character references",
      );
    }
    const relTokens =
      typeof rel === "string"
        ? trimHtmlSpaces(rel.toLowerCase())
            .split(/[\t\n\f\r ]+/u)
            .filter(Boolean)
        : [];
    if (!relTokens.includes("stylesheet")) {
      index = link.end;
      continue;
    }
    const supportedAttributes = new Set([
      "crossorigin",
      "href",
      "media",
      "rel",
    ]);
    for (const [attributeName, value] of attributes) {
      if (!supportedAttributes.has(attributeName)) {
        throw buildVerificationError(
          `unsupported stylesheet-link attribute: ${attributeName}`,
        );
      }
      if (typeof value === "string" && value.includes("&")) {
        throw buildVerificationError(
          "stylesheet-related link attributes must not contain character references",
        );
      }
    }
    if (
      attributes.has("crossorigin") &&
      attributes.get("crossorigin") !== null
    ) {
      throw buildVerificationError(
        "unsupported stylesheet-link attribute value: crossorigin",
      );
    }
    const media = attributes.get("media");
    if (
      relTokens.length !== 1 ||
      relTokens[0] !== "stylesheet" ||
      attributes.has("disabled") ||
      (attributes.has("media") &&
        (typeof media !== "string" ||
          trimHtmlSpaces(media.toLowerCase()) !== "all"))
    ) {
      throw buildVerificationError(
        "stylesheet link must be one unconditional active stylesheet",
      );
    }
    hrefs.push(attributes.get("href"));
    index = link.end;
  }
  return hrefs;
}

function isWithinRoot(path, rootDirectory) {
  const fromRoot = relative(rootDirectory, path);
  return fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot));
}

function localCssAsset(href) {
  if (
    typeof href !== "string" ||
    !SAFE_LOCAL_CSS_ASSET_PATTERN.test(href)
  ) {
    throw buildVerificationError(
      `stylesheet href must be one local relative CSS asset with a safe ASCII local CSS asset path: ${String(href)}`,
    );
  }
  return href.slice(2);
}

/**
 * Verifies the emitted renderer HTML has one local CSS asset and that its
 * ordered PostCSS rule stream is identical to the pinned source composition.
 */
export async function verifyRendererStylesheetBuild({
  expectedFingerprint,
  expectedSourceFiles,
  rendererOutDirectory,
  sourceEntryPath,
  sourceRootDirectory,
}) {
  const sourceComposition = await verifyStylesheetComposition({
    entryPath: sourceEntryPath,
    expectedFiles: expectedSourceFiles,
    expectedFingerprint,
    rootDirectory: sourceRootDirectory,
  });

  let canonicalOutDirectory;
  let html;
  try {
    canonicalOutDirectory = await realpath(rendererOutDirectory);
    html = await readFile(join(canonicalOutDirectory, "index.html"), "utf8");
  } catch (error) {
    throw buildVerificationError(
      `renderer output or index.html is missing: ${rendererOutDirectory}`,
      error,
    );
  }

  const hrefs = stylesheetHrefs(html);
  if (hrefs.length !== 1) {
    throw buildVerificationError(
      `expected exactly one local stylesheet link, received ${hrefs.length}`,
    );
  }
  const builtCssFile = localCssAsset(hrefs[0]);
  let builtCssPath;
  try {
    builtCssPath = await realpath(resolve(canonicalOutDirectory, builtCssFile));
  } catch (error) {
    throw buildVerificationError(
      `built stylesheet is missing: ${builtCssFile}`,
      error,
    );
  }
  if (!isWithinRoot(builtCssPath, canonicalOutDirectory)) {
    throw buildVerificationError(`built stylesheet escapes renderer output: ${builtCssFile}`);
  }

  const logicalBuiltCssFile = relative(canonicalOutDirectory, builtCssPath)
    .split(sep)
    .join("/");
  const builtComposition = await verifyStylesheetComposition({
    entryPath: builtCssPath,
    expectedFiles: [logicalBuiltCssFile],
    expectedFingerprint,
    rootDirectory: canonicalOutDirectory,
  });
  if (builtComposition.canonicalJson !== sourceComposition.canonicalJson) {
    throw buildVerificationError(
      "built and source canonical rule streams differ despite their fingerprints",
    );
  }

  return Object.freeze({
    builtCssFile: logicalBuiltCssFile,
    fingerprint: builtComposition.fingerprint,
  });
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : undefined;
if (invokedPath === import.meta.url) {
  const projectRoot = process.cwd();
  const result = await verifyRendererStylesheetBuild({
    expectedFingerprint: RENDERER_STYLESHEET_CONTRACT.fingerprint,
    expectedSourceFiles: RENDERER_STYLESHEET_CONTRACT.expectedFiles,
    rendererOutDirectory: resolve(projectRoot, "out", "renderer"),
    sourceEntryPath: resolve(
      projectRoot,
      "src",
      "renderer",
      "src",
      "styles",
      "index.css",
    ),
    sourceRootDirectory: resolve(projectRoot, "src", "renderer", "src"),
  });
  console.log(
    `Renderer stylesheet verified: ${result.builtCssFile} (${result.fingerprint})`,
  );
}
