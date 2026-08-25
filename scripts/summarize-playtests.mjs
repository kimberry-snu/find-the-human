#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import process from 'node:process';

const inputs = process.argv.slice(2);

const readInput = async () => {
  if (inputs.length > 0) {
    return (await Promise.all(inputs.map((path) => readFile(path, 'utf8')))).join('\n');
  }

  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
};

const parseGameComplete = (line) => {
  const marker = line.indexOf('{"event":"game_complete"');
  if (marker < 0) return null;
  try {
    const parsed = JSON.parse(line.slice(marker));
    if (
      parsed?.event !== 'game_complete' ||
      !['mild', 'spicy'].includes(parsed.difficulty) ||
      !['HUMAN', 'AI', 'NONE'].includes(parsed.winner)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const source = await readInput();
const games = source.split(/\r?\n/).map(parseGameComplete).filter(Boolean);

if (games.length === 0) {
  console.error('game_complete 로그를 찾지 못했습니다. 로그 파일을 인자로 주거나 stdin으로 전달하세요.');
  process.exitCode = 1;
} else {
  console.log(`플레이테스트 ${games.length}판`);
  for (const difficulty of ['mild', 'spicy']) {
    const subset = games.filter((game) => game.difficulty === difficulty && game.winner !== 'NONE');
    if (subset.length === 0) {
      console.log(`- ${difficulty}: 승패가 있는 표본 없음`);
      continue;
    }
    const humanWins = subset.filter((game) => game.winner === 'HUMAN').length;
    const rate = Math.round((humanWins / subset.length) * 100);
    console.log(`- ${difficulty}: 인간 ${humanWins}승 / ${subset.length}판 (${rate}%)`);
  }
}
