import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = resolve(here, "index.html");
const readmePath = resolve(here, "README.md");
const html = await readFile(htmlPath, "utf8");
const readme = await readFile(readmePath, "utf8");

const forbidden = [
  /(?:src|href)\s*=\s*["'](?:https?:|\/\/|file:)/i,
  /(?:src|href)\s*=\s*["']\//i,
  /(?:Users|home)\/[A-Za-z0-9._-]+\//,
  /<img\b/i,
  /(?:from\s+["']|import\s*\()[^"']*(?:apps\/editor|packages\/|node_modules)/i,
  /(?:customer|campaign|credential|presigned|private corpus)/i
];
for (const pattern of forbidden) {
  assert(!pattern.test(html), "static safety boundary failed");
}
assert(!forbidden.slice(0, 4).some(pattern => pattern.test(readme)), "documentation safety boundary failed");
assert(html.includes("Interaction reference — synthetic data; not compiler output or production behavior."));
assert(!/requestAnimationFrame\s*\([^)]*(?:play|interpol|tick)/i.test(html), "JavaScript interpolation loop found");

const executablePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ executablePath, headless: true });
const results = [];

function near(actual, expected, tolerance, label) {
  assert(Math.abs(actual - expected) <= tolerance, `${label} outside tolerance`);
}

function sameGeometry(actual, expected, label) {
  assert.deepEqual(actual.poses, expected.poses, `${label} geometry changed`);
  assert.deepEqual(actual.settings, expected.settings, `${label} settings changed`);
}

async function snapshot(page) {
  return page.evaluate(() => window.__unifiedCanvasReference.snapshot());
}

async function drag(page, selector, dx, dy) {
  const box = await page.locator(selector).boundingBox();
  assert(box, "drag target missing");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await page.mouse.up();
}

async function checkViewport(viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const failures = [];
  const requests = [];
  page.on("console", message => { if (message.type() === "error") failures.push("console"); });
  page.on("pageerror", () => failures.push("page"));
  page.on("requestfailed", () => failures.push("request"));
  page.on("request", request => requests.push(request.url()));
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });

  await assert.doesNotReject(() => page.locator(".disclaimer").waitFor({ state: "visible" }));
  assert.equal(await page.locator("#advanced-toggle").getAttribute("aria-expanded"), "false");
  assert.equal(await page.locator("#advanced-panel").isHidden(), true);
  assert.equal(await page.locator("[data-workspace='unified']").count(), 1);
  assert.equal(await page.locator(".canvas").count(), 1);
  assert.equal(await page.locator(".moment-button[aria-current='step']").textContent(), "Start");
  assert.equal(await page.locator("#select-object-1").getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator("#select-object-2").getAttribute("aria-pressed"), "false");

  const initialCanvas = await page.locator("#canvas").boundingBox();
  assert(initialCanvas && initialCanvas.width > 0 && initialCanvas.height > 0);
  near(initialCanvas.width / initialCanvas.height, 16 / 9, .015, "canvas aspect");
  if (viewport.width === 1440) assert(initialCanvas.width >= viewport.width * .6, "desktop canvas too narrow");

  await page.locator("#path-toggle").click();
  const pathOffCanvas = await page.locator("#canvas").boundingBox();
  assert.deepEqual(pathOffCanvas, initialCanvas, "Path changed canvas bounds");
  assert.equal(await page.locator(".waypoint:visible").count(), 0);
  assert.equal(await page.locator(".handle.selected:visible").count(), 2);
  await page.locator("#path-toggle").click();

  await page.locator("#advanced-toggle").click();
  const advancedCanvas = await page.locator("#canvas").boundingBox();
  assert.deepEqual(advancedCanvas, initialCanvas, "Advanced changed canvas bounds");
  assert.equal(await page.locator("#advanced-toggle").getAttribute("aria-expanded"), "true");
  assert.equal(await page.locator("#advanced-panel").getAttribute("aria-labelledby"), "advanced-title");
  assert.equal(await page.locator("#advanced-close").evaluate(element => element === document.activeElement), true);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#advanced-panel").isHidden(), true);
  assert.equal(await page.locator("#advanced-toggle").getAttribute("aria-expanded"), "false");

  // Screen-space handle targets stay operable for every object/moment at minimum authored scale.
  for (const id of ["object-1", "object-2"]) {
    for (const moment of ["start", "middle", "settled"]) {
      await page.locator(`#select-${id}`).click();
      await page.locator(`.moment-button[data-moment='${moment}']`).click();
      await page.locator("#advanced-toggle").click();
      await page.locator("#advanced-scale").fill("0.25");
      await page.locator("#advanced-scale").dispatchEvent("change");
      await page.locator("#advanced-close").click();
      const handles = await page.locator(`.handle.selected:visible`).evaluateAll(elements => elements.map(element => {
        const rect = element.getBoundingClientRect();
        return { width: rect.width, height: rect.height, role: element.getAttribute("role"), value: element.getAttribute("aria-valuenow") };
      }));
      assert.equal(handles.length, 2, "selected transform handles missing");
      for (const handle of handles) {
        assert(handle.width >= 43.5 && handle.height >= 43.5, "minimum-scale handle target below 44px");
        assert.equal(handle.role, "slider", "handle semantics are not truthful");
      }
      assert.equal(await page.locator(`#handle-scale-${id}`).getAttribute("aria-valuenow"), "0.25");
      await page.locator("#undo").click();
    }
  }

  const clickBaseline = await snapshot(page);
  await page.locator("#select-object-2").click();
  sameGeometry(await snapshot(page), clickBaseline, "object selector click");
  await page.locator(".moment-button[data-moment='middle']").click();
  sameGeometry(await snapshot(page), clickBaseline, "moment click");
  await page.locator("[data-waypoint-object='object-1'][data-waypoint-moment='settled']").click();
  const waypointClick = await snapshot(page);
  sameGeometry(waypointClick, clickBaseline, "waypoint click");
  assert.equal(waypointClick.selectedObject, "object-1");
  assert.equal(waypointClick.selectedMoment, "settled");

  // Complete the direct no-Advanced workflow for Object 1.
  await page.locator(".moment-button[data-moment='start']").click();
  let before = await snapshot(page);
  const rect = await page.locator("#canvas").boundingBox();
  await drag(page, "#object-1 .object-body", rect.width * 40 / 960, rect.height * 22 / 540);
  let after = await snapshot(page);
  near(after.poses["object-1"].start.x - before.poses["object-1"].start.x, 40, 1, "pointer x endpoint");
  near(after.poses["object-1"].start.y - before.poses["object-1"].start.y, 22, 1, "pointer y endpoint");
  assert.equal(after.undoDepth, before.undoDepth + 1, "pointer drag should be one transaction");

  before = after;
  await drag(page, "#handle-scale-object-1", rect.width * 22 / 960, rect.height * 16 / 540);
  after = await snapshot(page);
  assert.notEqual(after.poses["object-1"].start.scale, before.poses["object-1"].start.scale, "scale handle did not edit");
  assert.equal(after.poses["object-2"].start.scale, before.poses["object-2"].start.scale, "scale changed secondary");

  before = after;
  await drag(page, "#handle-rotate-object-1", rect.width * 25 / 960, 0);
  after = await snapshot(page);
  assert.notEqual(after.poses["object-1"].start.rotation, before.poses["object-1"].start.rotation, "rotate handle did not edit");
  assert.equal(after.poses["object-2"].start.rotation, before.poses["object-2"].start.rotation, "rotation changed secondary");

  before = after;
  await drag(page, "[data-waypoint-object='object-1'][data-waypoint-moment='middle']", rect.width * 18 / 960, rect.height * -12 / 540);
  after = await snapshot(page);
  near(after.poses["object-1"].middle.x - before.poses["object-1"].middle.x, 18, 1, "waypoint x endpoint");
  near(after.poses["object-1"].middle.y - before.poses["object-1"].middle.y, -12, 1, "waypoint y endpoint");

  // Object 2 also completes move, scale, rotation, and waypoint editing without Advanced.
  await page.locator("#select-object-2").click();
  await page.locator(".moment-button[data-moment='middle']").click();
  before = await snapshot(page);
  await page.locator("#object-2 .object-body").focus();
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Alt+ArrowRight");
  await page.keyboard.press("Alt+ArrowUp");
  after = await snapshot(page);
  near(after.poses["object-2"].middle.x - before.poses["object-2"].middle.x, 10, .01, "keyboard translate");
  near(after.poses["object-2"].middle.rotation - before.poses["object-2"].middle.rotation, 1, .01, "keyboard rotate");
  near(after.poses["object-2"].middle.scale - before.poses["object-2"].middle.scale, .05, .001, "keyboard scale");

  // The direct handles themselves expose slider semantics and perform announced keyboard edits.
  before = after;
  const scaleHandle = page.locator("#handle-scale-object-2");
  await scaleHandle.focus();
  assert.equal(await scaleHandle.getAttribute("role"), "slider");
  assert.equal(await scaleHandle.evaluate(element => getComputedStyle(element).outlineStyle !== "none"), true, "scale handle focus not visible");
  await page.keyboard.press("ArrowUp");
  after = await snapshot(page);
  near(after.poses["object-2"].middle.scale - before.poses["object-2"].middle.scale, .05, .001, "scale slider keyboard edit");
  await page.waitForFunction(() => document.querySelector("#live-region").textContent.includes("uniform scale"));
  const scaleAfterArrow = after.poses["object-2"].middle.scale;
  await page.keyboard.press("Enter");
  near((await snapshot(page)).poses["object-2"].middle.scale, scaleAfterArrow, .001, "scale slider Enter changed value");

  before = await snapshot(page);
  const rotateHandle = page.locator("#handle-rotate-object-2");
  await rotateHandle.focus();
  assert.equal(await rotateHandle.getAttribute("role"), "slider");
  assert.equal(await rotateHandle.evaluate(element => getComputedStyle(element).outlineStyle !== "none"), true, "rotation handle focus not visible");
  await page.keyboard.press("ArrowRight");
  after = await snapshot(page);
  near(after.poses["object-2"].middle.rotation - before.poses["object-2"].middle.rotation, 1, .01, "rotation slider keyboard edit");
  await page.waitForFunction(() => document.querySelector("#live-region").textContent.includes("rotation"));
  const rotationAfterArrow = after.poses["object-2"].middle.rotation;
  await page.keyboard.press("Space");
  near((await snapshot(page)).poses["object-2"].middle.rotation, rotationAfterArrow, .001, "rotation slider Space changed value");

  // Rotation endpoints retain truthful committed, rendered, exposed, and announced identity.
  await page.keyboard.press("Home");
  let endpoint = await snapshot(page);
  assert.equal(endpoint.poses["object-2"].middle.rotation, -180, "rotation Home did not commit -180");
  assert((await page.locator("#object-2").getAttribute("style")).includes("rotate(-180deg)"), "rotation Home did not render -180");
  assert.equal(await rotateHandle.getAttribute("aria-valuenow"), "-180");
  assert.equal(await rotateHandle.getAttribute("aria-valuetext"), "-180 degrees");
  await page.waitForFunction(() => document.querySelector("#live-region").textContent.includes("rotation -180 degrees"));

  await page.keyboard.press("End");
  endpoint = await snapshot(page);
  assert.equal(endpoint.poses["object-2"].middle.rotation, 180, "rotation End did not commit +180");
  assert((await page.locator("#object-2").getAttribute("style")).includes("rotate(180deg)"), "rotation End did not render +180");
  assert.equal(await rotateHandle.getAttribute("aria-valuenow"), "180");
  assert.equal(await rotateHandle.getAttribute("aria-valuetext"), "180 degrees");
  await page.waitForFunction(() => document.querySelector("#live-region").textContent.includes("rotation 180 degrees"));

  await page.keyboard.press("ArrowRight");
  endpoint = await snapshot(page);
  assert.equal(endpoint.poses["object-2"].middle.rotation, -179, "increasing rotation did not wrap after +180");
  assert.equal(await rotateHandle.getAttribute("aria-valuenow"), "-179");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowLeft");
  endpoint = await snapshot(page);
  assert.equal(endpoint.poses["object-2"].middle.rotation, 179, "decreasing rotation did not wrap before -180");
  assert.equal(await rotateHandle.getAttribute("aria-valuenow"), "179");

  before = after;
  await page.locator("[data-waypoint-object='object-2'][data-waypoint-moment='settled']").focus();
  await page.keyboard.press("Shift+ArrowLeft");
  after = await snapshot(page);
  near(after.poses["object-2"].settled.x - before.poses["object-2"].settled.x, -10, .01, "waypoint keyboard move");

  // Group translation is one exact reversible transaction.
  await page.locator("#group-toggle").click();
  assert.equal(await page.locator("#group-toggle").getAttribute("aria-pressed"), "true");
  before = await snapshot(page);
  await drag(page, "#object-2 .object-body", rect.width * 24 / 960, rect.height * 14 / 540);
  after = await snapshot(page);
  for (const id of ["object-1", "object-2"]) {
    near(after.poses[id].settled.x - before.poses[id].settled.x, 24, 1, `${id} grouped x`);
    near(after.poses[id].settled.y - before.poses[id].settled.y, 14, 1, `${id} grouped y`);
  }
  assert.equal(after.undoDepth, before.undoDepth + 1, "group move should be one transaction");
  await page.locator("#undo").click();
  sameGeometry(await snapshot(page), before, "group undo");
  await page.locator("#redo").click();
  sameGeometry(await snapshot(page), after, "group redo");

  // Escape restores an in-flight gesture and creates no history.
  before = await snapshot(page);
  const bodyBox = await page.locator("#object-2 .object-body").boundingBox();
  await page.mouse.move(bodyBox.x + bodyBox.width / 2, bodyBox.y + bodyBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(bodyBox.x + bodyBox.width / 2 + 31, bodyBox.y + bodyBox.height / 2 + 17, { steps: 3 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  after = await snapshot(page);
  sameGeometry(after, before, "Escape cancel");
  assert.equal(after.undoDepth, before.undoDepth, "cancel created history");
  await page.waitForFunction(() => document.querySelector("#live-region").textContent.toLowerCase().includes("cancel"));

  // Advanced Settled hold extends browser-native playback, then ends exactly with no drift.
  await page.locator("#advanced-toggle").click();
  await page.locator("#advanced-hold").fill("600");
  await page.locator("#advanced-hold").dispatchEvent("change");
  await page.locator("#advanced-close").click();
  await page.locator(".moment-button[data-moment='start']").click();
  const playbackStarted = Date.now();
  await page.locator("#play-pause").click();
  await page.waitForTimeout(1500);
  assert.equal((await snapshot(page)).playing, true, "Settled hold did not extend playback");
  await page.waitForFunction(() => window.__unifiedCanvasReference.snapshot().selectedMoment === "settled" && !window.__unifiedCanvasReference.snapshot().playing, null, { timeout: 1600 });
  const playbackElapsed = Date.now() - playbackStarted;
  assert(playbackElapsed >= 1950 && playbackElapsed <= 2700, "Settled hold elapsed timing incorrect");
  const settledState = await snapshot(page);
  const visualA = await page.evaluate(() => ["object-1", "object-2"].map(id => {
    const element = document.querySelector(`#${id}`);
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    const rotation = Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
    const box = element.getBoundingClientRect();
    const canvasBox = document.querySelector("#canvas").getBoundingClientRect();
    return { id, cx: (box.left + box.width / 2 - canvasBox.left) / canvasBox.width * 960, cy: (box.top + box.height / 2 - canvasBox.top) / canvasBox.height * 540, rotation };
  }));
  await page.waitForTimeout(180);
  const visualB = await page.evaluate(() => ["object-1", "object-2"].map(id => {
    const element = document.querySelector(`#${id}`);
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    const rotation = Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
    const box = element.getBoundingClientRect();
    const canvasBox = document.querySelector("#canvas").getBoundingClientRect();
    return { id, cx: (box.left + box.width / 2 - canvasBox.left) / canvasBox.width * 960, cy: (box.top + box.height / 2 - canvasBox.top) / canvasBox.height * 540, rotation };
  }));
  for (let i = 0; i < visualA.length; i++) {
    const expected = settledState.poses[visualA[i].id].settled;
    near(visualA[i].cx, expected.x, 1, "settled x");
    near(visualA[i].cy, expected.y, 1, "settled y");
    near(visualA[i].rotation, expected.rotation, .1, "settled rotation");
    near(visualB[i].cx, visualA[i].cx, .05, "post-settled x drift");
    near(visualB[i].cy, visualA[i].cy, .05, "post-settled y drift");
    near(visualB[i].rotation, visualA[i].rotation, .01, "post-settled rotation drift");
  }
  assert((await page.locator("#live-region").textContent()).includes("Playback ended"));

  // Accessibility and layout checks.
  assert.equal(await page.locator("[role='status'][aria-live='polite']").count(), 1);
  const targetBoxes = await page.locator("button:visible").evaluateAll(buttons => buttons.map(button => {
    const box = button.getBoundingClientRect();
    return { width: box.width, height: box.height, label: button.getAttribute("aria-label") || button.textContent.trim() };
  }));
  for (const box of targetBoxes) assert(box.width >= 43.5 && box.height >= 43.5, "visible button target below 44px");
  const layout = await page.evaluate(() => {
    const viewport = { width: innerWidth, height: innerHeight };
    const all = [...document.querySelectorAll("body *")].filter(el => {
      const style = getComputedStyle(el);
      return style.display !== "none" && style.visibility !== "hidden" && !el.closest("[hidden]");
    });
    const clipping = all.some(el => {
      const r = el.getBoundingClientRect();
      return r.right > viewport.width + 1 || r.left < -1;
    });
    const handles = [...document.querySelectorAll(".handle.selected")].map(el => el.getBoundingClientRect());
    const overlap = handles.length === 2 && !(handles[0].right < handles[1].left || handles[1].right < handles[0].left || handles[0].bottom < handles[1].top || handles[1].bottom < handles[0].top);
    return { scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, clipping, overlap };
  });
  assert(layout.scrollWidth <= viewport.width, "horizontal overflow");
  assert(layout.scrollHeight <= viewport.height + 1, "page requires vertical scrolling");
  assert.equal(layout.clipping, false, "visible content clipped");
  assert.equal(layout.overlap, false, "transform handles overlap");
  assert.equal(failures.length, 0, "runtime failures detected");
  assert.equal(requests.filter(url => url !== pathToFileURL(htmlPath).href).length, 0, "non-document network request detected");

  results.push({ viewport: `${viewport.width}x${viewport.height}`, assertions: "passed" });
  await context.close();
}

try {
  await checkViewport({ width: 1440, height: 900 });
  await checkViewport({ width: 768, height: 900 });
  process.stdout.write(JSON.stringify({ unified_canvas_reference: "passed", viewports: results.length, network_requests: 0 }) + "\n");
} finally {
  await browser.close();
}
