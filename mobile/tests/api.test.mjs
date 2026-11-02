import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(readFileSync(new URL("../api.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function client(response) {
  const exports = {};
  runInNewContext(source, {
    exports, require: name => name === "react-native" ? { Platform: { OS: "web" } } : { isDemo: false },
    process: { env: {} }, setTimeout, clearTimeout, AbortController,
    fetch: async () => response,
  });
  return exports;
}

test("削除成功の204はJSONを読まず正常終了する", async () => {
  const response = new Response(null, { status: 204 });
  response.json = () => { throw new Error("空の応答を読んではいけません"); };
  assert.equal(await client(response).api("/groups/1", "DELETE"), undefined);
});

test("通常のJSON応答をそのまま返す", async () => {
  const response = Response.json([{ id: 1, name: "授業" }]);
  assert.deepEqual(await client(response).api("/groups"), [{ id: 1, name: "授業" }]);
});

test("204以外の壊れた応答とAPIのエラー文は従来どおり検証する", async () => {
  await assert.rejects(client(new Response("", { status: 200 })).api("/groups"), /応答を読み取れませんでした/);
  await assert.rejects(client(Response.json({ detail: "グループが見つかりません" }, { status: 404 }))
    .api("/groups/1", "DELETE"), /グループが見つかりません/);
});
