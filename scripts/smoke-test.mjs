#!/usr/bin/env node

const base = process.env.WIKIOS_BASE_URL ?? "http://localhost:5211";
let pass = 0;
let fail = 0;
const errors = [];

async function request(url) {
  const response = await fetch(url);
  const bodyText = await response.text();
  return { response, bodyText };
}

function noteFailure(message) {
  fail += 1;
  errors.push(message);
}

async function checkJson(name, url, predicate) {
  try {
    const { response, bodyText } = await request(url);
    if (!response.ok) {
      noteFailure(`  ✗ ${name}: HTTP ${response.status}`);
      return;
    }

    let data;
    try {
      data = JSON.parse(bodyText);
    } catch {
      noteFailure(`  ✗ ${name}: invalid JSON`);
      return;
    }

    if (!predicate(data)) {
      noteFailure(`  ✗ ${name}: structure check failed`);
      return;
    }

    pass += 1;
    console.log(`  ✓ ${name}`);
  } catch {
    noteFailure(`  ✗ ${name}: connection failed`);
  }
}

async function checkHtml(name, url, needle) {
  try {
    const { response, bodyText } = await request(url);
    if (!response.ok) {
      noteFailure(`  ✗ ${name}: HTTP ${response.status}`);
      return;
    }

    if (!bodyText.includes(needle)) {
      noteFailure(`  ✗ ${name}: missing '${needle}'`);
      return;
    }

    pass += 1;
    console.log(`  ✓ ${name}`);
  } catch {
    noteFailure(`  ✗ ${name}: connection failed`);
  }
}

async function main() {
  console.log(`WikiOS smoke tests (${base})`);
  console.log("─────────────────────────────────────");

  await checkHtml("homepage shell", `${base}/`, "WikiOS");
  await checkJson("health", `${base}/api/health`, (d) => d.ok === true && Number.isInteger(d.totalPages));
  await checkJson("version", `${base}/api/version`, (d) => typeof d.commit === "string" && typeof d.commitShort === "string");
  await checkJson("home data", `${base}/api/home`, (d) => Number.isInteger(d.totalPages) && typeof d.featured === "object" && d.featured !== null);
  await checkJson("stats", `${base}/api/stats`, (d) => Number.isInteger(d.total_pages) && Array.isArray(d.top_backlinks));
  await checkJson("search", `${base}/api/search?q=wiki`, (d) => Array.isArray(d.results));

  let featuredSlug = "";
  try {
    const { response, bodyText } = await request(`${base}/api/home`);
    if (response.ok) {
      const data = JSON.parse(bodyText);
      featuredSlug = data?.featured?.slug ?? "";
    }
  } catch {
    featuredSlug = "";
  }

  if (featuredSlug) {
    await checkJson("featured article", `${base}/api/wiki/${featuredSlug}`, (d) => typeof d.title === "string" && typeof d.contentMarkdown === "string");
  } else {
    noteFailure("  ✗ featured article: no featured slug from /api/home");
  }

  console.log("─────────────────────────────────────");
  console.log(`  ${pass} passed, ${fail} failed`);

  if (fail > 0) {
    console.log(`\nFailures:\n${errors.join("\n")}`);
    process.exit(1);
  }

  console.log("  All checks passed ✓");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "smoke-test failed");
  process.exit(1);
});