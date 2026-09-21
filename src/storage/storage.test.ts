import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeRecord } from "./storage.ts";
import type { EvalRecord, RunRecord } from "../types.ts";

const root = await mkdtemp(join(tmpdir(), "ordeal-storage-"));

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function createEvalRecord(name: string, score: number): EvalRecord {
  return {
    name,
    total: 1,
    passed: 1,
    skipped: 0,
    cases: [
      {
        name: "брак с фото",
        minScore: 80,
        passed: true,
        trials: [{ score, ms: 100, retries: 0, output: { verdict: "refund" } }],
      },
    ],
  };
}

function createRecord(score: number): RunRecord {
  return {
    version: 1,
    startedAt: new Date(score).toISOString(),
    ms: 200,
    options: { trials: 1, retries: 0 },
    evals: [createEvalRecord("return-decision", score), createEvalRecord("summary", score)],
  };
}

test("одна строка на запуск, output только в latest", async () => {
  const base = join(root, "первый");
  await writeRecord(base, createRecord(91));

  const history = await Bun.file(join(base, "history.jsonl")).text();
  const latest = await Bun.file(join(base, "latest.json")).json();

  expect(history.trim().split("\n")).toHaveLength(1);
  expect(history).not.toContain("output");
  expect(history).not.toContain("refund");
  expect(JSON.parse(history).evals.map((item: EvalRecord) => item.name)).toEqual([
    "return-decision",
    "summary",
  ]);

  expect(latest).toHaveLength(1);
  expect(latest[0].evals[0].cases[0].trials[0].output).toEqual({ verdict: "refund" });
});

test("история копится, latest держит три последних запуска новым сверху", async () => {
  const base = join(root, "второй");

  for (const score of [10, 20, 30, 40]) {
    await writeRecord(base, createRecord(score));
  }

  const history = await Bun.file(join(base, "history.jsonl")).text();
  const latest = await Bun.file(join(base, "latest.json")).json();

  expect(history.trim().split("\n")).toHaveLength(4);
  expect(latest).toHaveLength(3);
  expect(
    latest.map((item: RunRecord) => item.evals[0]?.cases[0]?.trials[0]?.score),
  ).toEqual([40, 30, 20]);
});

async function fillHistory(base: string, count: number): Promise<void> {
  const lines = Array.from({ length: count }, (_, i) => `{"old":${i}}`);

  await Bun.write(join(base, "history.jsonl"), `${lines.join("\n")}\n`);
}

test("история до 200 запусков не обрезается", async () => {
  const base = join(root, "до-лимита");
  await fillHistory(base, 199);
  await writeRecord(base, createRecord(55));

  const lines = (await Bun.file(join(base, "history.jsonl")).text()).trim().split("\n");

  expect(lines).toHaveLength(200);
  expect(lines[0]).toBe('{"old":0}');
});

test("больше 200 запусков — остаются последние 100, новый в конце", async () => {
  const base = join(root, "сверх-лимита");
  await fillHistory(base, 200);
  await writeRecord(base, createRecord(66));

  const text = await Bun.file(join(base, "history.jsonl")).text();
  const lines = text.trim().split("\n");

  expect(lines).toHaveLength(100);
  expect(lines[0]).toBe('{"old":101}');
  expect(JSON.parse(lines[99]!).evals[0].cases[0].trials[0].score).toBe(66);
  expect(text.endsWith("\n")).toBe(true);
  expect(await Bun.file(join(base, "history.jsonl.tmp")).exists()).toBe(false);
});

test("last.json — только последний запуск, объектом и с output", async () => {
  const base = join(root, "последний");

  for (const score of [10, 20]) {
    await writeRecord(base, createRecord(score));
  }

  const text = await Bun.file(join(base, "last.json")).text();
  const last = JSON.parse(text);

  expect(text.startsWith('{\n  "version": 1')).toBe(true);
  expect(last.evals[0].cases[0].trials[0].score).toBe(20);
  expect(last.evals[0].cases[0].trials[0].output).toEqual({ verdict: "refund" });
});

test("latest.json остаётся читаемым человеком", async () => {
  const base = join(root, "третий");
  await writeRecord(base, createRecord(77));

  const text = await Bun.file(join(base, "latest.json")).text();

  expect(text).toContain('[\n  {\n    "version": 1');
});
