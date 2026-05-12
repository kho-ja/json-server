import { Hono } from "hono";
import { cors } from "hono/cors";

interface Endpoint {
  path: string;
  data: unknown;
  createdAt: string;
  updatedAt: string;
}

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.use(
  "/__admin/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  })
);

app.use("/__admin/*", async (c, next) => {
  const auth = c.req.header("Authorization");
  if (!auth || !auth.startsWith("Bearer ") || auth.slice(7) !== c.env.TOKEN) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

const admin = new Hono<{ Bindings: CloudflareBindings }>();

admin.get("/endpoints", async (c) => {
  const kv = c.env.ENDPOINTS_KV;
  const keys = await kv.list({ prefix: "ep:" });
  if (keys.keys.length === 0) return c.json([]);
  const values = await Promise.all(keys.keys.map((k) => kv.get(k.name)));
  const endpoints = values.filter(Boolean).map((v) => JSON.parse(v!));
  return c.json(endpoints);
});

admin.post("/endpoints", async (c) => {
  const kv = c.env.ENDPOINTS_KV;
  const { path, data } = await c.req.json();
  if (!path || data === undefined) {
    return c.json({ error: "path and data are required" }, 400);
  }
  if (!path.startsWith("/") || path.startsWith("/__admin")) {
    return c.json({ error: "Path must start with / and cannot use /__admin prefix" }, 400);
  }
  const existing = await kv.get(`ep:${path}`);
  if (existing) {
    return c.json({ error: "Endpoint already exists" }, 409);
  }
  const now = new Date().toISOString();
  const endpoint: Endpoint = { path, data, createdAt: now, updatedAt: now };
  await kv.put(`ep:${path}`, JSON.stringify(endpoint));
  return c.json(endpoint, 201);
});

admin.put("/endpoints", async (c) => {
  const kv = c.env.ENDPOINTS_KV;
  const { path, data } = await c.req.json();
  const raw = await kv.get(`ep:${path}`);
  if (!raw) return c.json({ error: "Not found" }, 404);
  const endpoint: Endpoint = JSON.parse(raw);
  endpoint.data = data;
  endpoint.updatedAt = new Date().toISOString();
  await kv.put(`ep:${path}`, JSON.stringify(endpoint));
  return c.json(endpoint);
});

admin.delete("/endpoints", async (c) => {
  const kv = c.env.ENDPOINTS_KV;
  const { path } = await c.req.json();
  const existing = await kv.get(`ep:${path}`);
  if (!existing) return c.json({ error: "Not found" }, 404);
  await kv.delete(`ep:${path}`);
  return c.json({ success: true });
});

app.route("/__admin", admin);

app.get("/__endpoints", async (c) => {
  const kv = c.env.ENDPOINTS_KV;
  const keys = await kv.list({ prefix: "ep:" });
  if (keys.keys.length === 0) return c.json([]);
  const values = await Promise.all(keys.keys.map((k) => kv.get(k.name)));
  const endpoints = values.filter(Boolean).map((v) => JSON.parse(v!));
  return c.json(endpoints, 200, { "Cache-Control": "no-store" });
});

app.all("*", async (c) => {
  const kv = c.env.ENDPOINTS_KV;
  const raw = await kv.get(`ep:${c.req.path}`);
  if (raw) {
    const endpoint: Endpoint = JSON.parse(raw);
    return c.json(endpoint.data, 200, { "Cache-Control": "no-store" });
  }
  return c.json({ error: "Not found" }, 404);
});

export default app;
