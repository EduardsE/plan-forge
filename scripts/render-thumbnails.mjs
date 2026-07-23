/**
 * Offline library-card thumbnails for every real-mesh catalog item. Run
 * manually via `pnpm render-thumbnails` after `pnpm prepare-models` — never
 * part of the build. Renders each manifest GLB with three.js in headless
 * Chrome (same camera language as the app's 3D lens: orbit 38° / 62°, warm
 * studio light) to a transparent 512² PNG under public/thumbnails/<id>.png.
 * CatalogThumbnail (src/components/catalog-thumbnails.tsx) shows these for
 * manifest ids and falls back to the CSS glyphs for primitives-only items.
 *
 * Body-slot materials take the item's default colorway tint
 * (furnitureBaseColor) so a card matches what actually drops into the room.
 */
import { createServer } from "node:http";
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { extname, join } from "node:path";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const require = createRequire(import.meta.url);

// --- data: manifest ids/files/slots, and default body tints -----------------

const manifestSource = readFileSync(
	join(ROOT, "src/lib/model/model-manifest.gen.ts"),
	"utf8",
);
// The generated file is JSON-adjacent; strip the TS wrapper and quote keys.
const manifestJson = manifestSource
	.replace(/^[\s\S]*?export const MODEL_MANIFEST = /, "")
	.replace(/ as const;\s*$/, "")
	.replace(/([{,]\s*)([A-Za-z_][\w-]*)(\s*:)/g, '$1"$2"$3')
	.replace(/,(\s*[}\]])/g, "$1");
const MODEL_MANIFEST = JSON.parse(manifestJson);

const partsSource = readFileSync(join(ROOT, "src/lib/furniture-parts.ts"), "utf8");
const colorsBlock = partsSource.match(
	/FURNITURE_COLORS: Record<string, string> = \{([\s\S]*?)\};/,
)?.[1];
if (!colorsBlock) throw new Error("FURNITURE_COLORS not found in furniture-parts.ts");
const FURNITURE_COLORS = {};
for (const [, id, hex] of colorsBlock.matchAll(/"?([\w-]+)"?:\s*"(#[0-9a-fA-F]{6})"/g)) {
	FURNITURE_COLORS[id] = hex;
}
const FALLBACK_COLOR = "#b98a5f";

// --- static server: node_modules (three) + public/models + the render page --

const MIME = {
	".js": "text/javascript",
	".mjs": "text/javascript",
	".glb": "model/gltf-binary",
	".html": "text/html",
};

const PAGE = `<!doctype html><meta charset="utf-8">
<script type="importmap">{"imports":{
	"three":"/node_modules/three/build/three.module.js",
	"three/addons/":"/node_modules/three/examples/jsm/"
}}</script>
<body style="margin:0">
<script type="module">
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const SIZE = 512;
const renderer = new THREE.WebGLRenderer({
	alpha: true, antialias: true, preserveDrawingBuffer: true,
});
renderer.setSize(SIZE, SIZE);
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

// The app's default 3D orbit: azimuth 38°, polar 62° (planner-canvas.tsx).
const AZIMUTH = (38 * Math.PI) / 180;
const POLAR = (62 * Math.PI) / 180;
const FOV = 36;

window.renderModel = async (url, slots, tint) => {
	const scene = new THREE.Scene();
	scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d2c8, 1.1));
	const key = new THREE.DirectionalLight(0xfff6e8, 2.2);
	key.position.set(-1.5, 2.5, 2);
	scene.add(key);
	const fill = new THREE.DirectionalLight(0xf2f4f8, 0.7);
	fill.position.set(2, 1.2, -1.5);
	scene.add(fill);

	const gltf = await new GLTFLoader().loadAsync(url);
	const model = gltf.scene;
	const tintColor = new THREE.Color(tint);
	model.traverse((obj) => {
		if (obj.isMesh && obj.material) {
			const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
			for (const mat of mats) {
				if (slots[mat.name] === "body" && mat.color) mat.color.copy(tintColor);
			}
		}
	});
	scene.add(model);

	const box = new THREE.Box3().setFromObject(model);
	const center = box.getCenter(new THREE.Vector3());
	const sphere = box.getBoundingSphere(new THREE.Sphere());
	const dist = (sphere.radius / Math.sin((FOV * Math.PI) / 360)) * 1.02;
	const camera = new THREE.PerspectiveCamera(FOV, 1, dist / 100, dist * 10);
	camera.position.set(
		center.x + dist * Math.sin(POLAR) * Math.sin(AZIMUTH),
		center.y + dist * Math.cos(POLAR),
		center.z + dist * Math.sin(POLAR) * Math.cos(AZIMUTH),
	);
	camera.lookAt(center);

	renderer.render(scene, camera);
	return renderer.domElement.toDataURL("image/png");
};
window.pageReady = true;
</script>`;

const server = createServer((req, res) => {
	const url = new URL(req.url, "http://localhost");
	if (url.pathname === "/") {
		res.writeHead(200, { "content-type": "text/html" });
		res.end(PAGE);
		return;
	}
	const rel = url.pathname.startsWith("/node_modules/")
		? url.pathname.slice(1)
		: url.pathname.startsWith("/models/")
			? `public${url.pathname}`
			: null;
	const file = rel ? join(ROOT, rel) : null;
	if (!file || !file.startsWith(ROOT) || !existsSync(file)) {
		res.writeHead(404);
		res.end();
		return;
	}
	res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
	res.end(readFileSync(file));
});

// --- drive headless Chrome via the Playwright MCP's npx cache ---------------

const { chromium } = require("/Users/e2/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core");

await new Promise((resolve) => server.listen(0, resolve));
const port = server.address().port;

const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
	const page = await browser.newPage({ viewport: { width: 600, height: 600 } });
	page.on("pageerror", (err) => console.error("page error:", err.message));
	await page.goto(`http://localhost:${port}/`);
	await page.waitForFunction("window.pageReady === true");

	mkdirSync(join(ROOT, "public/thumbnails"), { recursive: true });
	for (const [id, entry] of Object.entries(MODEL_MANIFEST)) {
		const tint = FURNITURE_COLORS[id] ?? FALLBACK_COLOR;
		const dataUrl = await page.evaluate(
			([file, slots, color]) => window.renderModel(file, slots, color),
			[entry.file, entry.slots, tint],
		);
		const png = Buffer.from(dataUrl.split(",")[1], "base64");
		writeFileSync(join(ROOT, `public/thumbnails/${id}.png`), png);
		console.log(`${id}: ${Math.round(png.length / 1024)} KB`);
	}
} finally {
	await browser.close();
	server.close();
}
console.log(`wrote ${Object.keys(MODEL_MANIFEST).length} thumbnail(s)`);
