import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// server/data/ 아래의 작은 JSON 파일로 상태를 저장한다. 파일 이름이 없으면 저장하지 않는다(테스트용).
export const dataFile = (name: string) => fileURLToPath(new URL(`../data/${name}`, import.meta.url));

export function loadJson<T>(file: string | undefined, fallback: T): T {
  if (!file || !existsSync(file)) return fallback;
  try {
    return { ...fallback, ...(JSON.parse(readFileSync(file, 'utf8')) as T) };
  } catch {
    return fallback;
  }
}

export function saveJson(file: string | undefined, data: unknown) {
  if (!file) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2));
}
