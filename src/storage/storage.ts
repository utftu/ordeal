import { appendFile, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";

import { historyKeep, historyLimit, latestKeep } from "../consts.ts";
import type { RunRecord } from "../types.ts";

// history.jsonl растёт вечно, поэтому output в него не пишется — он живёт
// только в latest.json, то есть в трёх последних запусках. Схема одна, просто
// одно поле в историю не едет.
function stripOutputs(record: RunRecord): RunRecord {
  return {
    ...record,
    evals: record.evals.map((evalRecord) => ({
      ...evalRecord,
      cases: evalRecord.cases.map((item) => ({
        ...item,
        trials: item.trials.map(({ output, ...trial }) => trial),
      })),
    })),
  };
}

async function readLatest(path: string): Promise<RunRecord[]> {
  const file = Bun.file(path);

  if ((await file.exists()) === false) {
    return [];
  }

  const parsed = await file.json().catch(() => undefined);

  if (Array.isArray(parsed) === false) {
    return [];
  }

  return parsed as RunRecord[];
}

// Пока строк не больше historyLimit, файл только дописывается. Стало больше —
// остаются последние historyKeep: перезапись раз в сотню запусков, а не на
// каждом. Строки режутся по переводам строк без разбора JSON. Запись идёт
// во временный файл и переименованием: падение посреди записи не теряет историю.
async function trimHistory(path: string): Promise<void> {
  const text = await Bun.file(path).text();
  const lines = text.split("\n").filter((line) => line !== "");

  if (lines.length <= historyLimit) {
    return;
  }

  const temporary = `${path}.tmp`;

  await Bun.write(temporary, `${lines.slice(-historyKeep).join("\n")}\n`);
  await rename(temporary, path);
}

export async function writeRecord(root: string, record: RunRecord): Promise<void> {
  await mkdir(root, { recursive: true });

  const historyPath = join(root, "history.jsonl");

  await appendFile(historyPath, `${JSON.stringify(stripOutputs(record))}\n`);
  await trimHistory(historyPath);

  const latestPath = join(root, "latest.json");
  const previous = await readLatest(latestPath);
  const next = [record, ...previous].slice(0, latestKeep);

  await Bun.write(latestPath, JSON.stringify(next, null, 2));

  // last.json — только последний запуск, объектом, а не массивом: открыл и читаешь.
  await Bun.write(join(root, "last.json"), JSON.stringify(record, null, 2));
}
