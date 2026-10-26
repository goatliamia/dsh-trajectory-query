// Host-half self-test: 字面检索的语义(大小写、轮次归属、片段的 matchAt、上限与总数)+ 路由形状。
// 用法:node plugin/conversation-search/self-test.mjs
import { apply, eventText, logIdentity, searchEvents } from "./lib/index.js";

let failed = 0;
const results = [];
const check = (name, condition, detail) => {
  results.push((condition ? "PASS " : "FAIL ") + name + (condition ? "" : "  " + JSON.stringify(detail === undefined ? "" : detail)));
  if (!condition) failed++;
};

const ev = (type, seq, data, time = seq * 10) => ({ type, seq, time, data });

const events = [
  ev("turn/start", 0, {}),
  ev("user/message", 1, { content: [{ type: "text", text: "帮我看一下 package.json 的构建脚本" }] }),
  ev("assistant/message", 2, { turn: 1, message: { content: [{ type: "text", text: "先读 package.json,再改 scripts.build" }] } }),
  ev("tool/call", 3, { turn: 1, name: "read", arguments: "{\"file_path\":\"package.json\"}" }),
  ev("tool/result", 4, { turn: 1, message: { content: [{ type: "text", text: "{\"scripts\":{\"build\":\"node build.mjs\"}}" }] } }),
  ev("turn/end", 5, { reason: { kind: "completed" } }),
  ev("turn/start", 6, {}),
  ev("tool/call", 7, { turn: 2, name: "read", arguments: "{\"file_path\":\"README.md\"}" }),
  ev("tool/result", 8, { turn: 2, message: { content: [{ type: "text", text: "read failed" }], isError: true }, error: { name: "FsError", code: "FS_NOT_OBSERVED" } }),
  ev("turn/end", 9, { reason: { kind: "error" } }),
];

check("eventText: 用户消息取正文", eventText(events[1]).includes("package.json"), eventText(events[1]));
check("eventText: 无文字事件返回空", eventText(events[0]) === "", eventText(events[0]));
check("eventText: 工具错误带码", eventText(events[8]).includes("FsError:FS_NOT_OBSERVED"), eventText(events[8]));

const broad = searchEvents(events, "package.json", 20);
check("search: 大小写不敏感", searchEvents(events, "PACKAGE.JSON", 20).total === broad.total, broad.total);
check("search: 命中总数", broad.total === 3, broad.total);
check("search: 轮次归属", broad.hits.every((hit) => hit.turn === 1), broad.hits.map((hit) => hit.turn));
check("search: 片段 matchAt 指向命中词", broad.hits.every((hit) => hit.text.slice(hit.matchAt, hit.matchAt + 12).toLowerCase() === "package.json"), broad.hits.map((hit) => hit.text.slice(hit.matchAt, hit.matchAt + 12)));

const second = searchEvents(events, "README.md", 20);
check("search: 第二个 turn 的命中", second.total === 1 && second.hits[0].turn === 2, second.hits);

const capped = searchEvents(events, "package.json", 2);
check("search: limit 截断但 total 照算", capped.hits.length === 2 && capped.total === 3, { hits: capped.hits.length, total: capped.total });

const errorHit = searchEvents(events, "fs_not_observed", 5);
check("search: 能搜到错误码", errorHit.total === 1 && errorHit.hits[0].seq === 8, errorHit.hits);

const log = logIdentity("session-x", events);
check("logIdentity: 12 位 id 与事件数", log.id.length === 12 && log.events === events.length, log);

/* ---------------- 路由 ---------------- */
const captured = {};
const ctx = {
  get(name) {
    if (name === "webServer") return { register(route) { captured.route = route; return () => {}; } };
    if (name === "sessionQuery") {
      return { async observeSession(sessionId) { return { sessionId, events, [Symbol.dispose]() {} }; } };
    }
    return undefined;
  },
  effect(callback) { callback(); return () => {}; },
};
apply(ctx, {});
check("route: 注册在 /conversation-search", captured.route !== undefined && captured.route.path === "/conversation-search", captured.route && captured.route.path);

const fakeRes = () => ({
  status: 0,
  body: "",
  writeHead(status) { this.status = status; },
  end(body) { this.body = body; },
});
const call = async (url) => {
  const res = fakeRes();
  await captured.route.handler({ method: "GET", url }, res);
  return { status: res.status, json: res.body ? JSON.parse(res.body) : null };
};

const found = await call("/conversation-search/search?session=s1&q=package.json&limit=2");
check("route: 200 且有 total/returned", found.status === 200 && found.json.total === 3 && found.json.returned === 2, found.json);
check("route: 命中带 seq/turn/text/matchAt", found.json.hits.every((hit) => typeof hit.seq === "number" && typeof hit.turn === "number" && typeof hit.text === "string" && typeof hit.matchAt === "number"), found.json.hits);
const missing = await call("/conversation-search/search?q=x");
check("route: 缺 session 返回 400", missing.status === 400, missing.json);
const noQuery = await call("/conversation-search/search?session=s1");
check("route: 缺 q 返回 400", noQuery.status === 400, noQuery.json);
const unknown = await call("/conversation-search/nope");
check("route: 未知路径返回 404", unknown.status === 404, unknown.json);

for (const line of results) console.log(line);
console.log(failed === 0 ? "\nALL PASS (" + results.length + " checks)" : "\n" + failed + " FAILED");
process.exit(failed === 0 ? 0 : 1);
