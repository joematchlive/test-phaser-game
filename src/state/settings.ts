import levels from '../data/levels.json';

export type LevelSchema = {
  id: string;
  name: string;
  description: string;
  spawnPoints: Array<{ x: number; y: number }>;
  solids: Array<{ x: number; y: number; width: number; height: number }>;
};

export type GameSettings = {
  winningScore: number;
  levelId: string;
  energyCount: number;
  rareEnergyCount: number;
  hazardCount: number;
  behaviorPickupCount: number;
};

const parsedLevels: LevelSchema[] = Array.isArray(levels) ? (levels as LevelSchema[]) : [];

const defaultLevelId = parsedLevels[0]?.id ?? 'default';

const defaultSettings: GameSettings = {
  winningScore: 10,
  levelId: defaultLevelId,
  energyCount: 6,
  rareEnergyCount: 1,
  hazardCount: 2,
  behaviorPickupCount: 2
};

let activeSettings: GameSettings = { ...defaultSettings };

export function getLevelOptions(): LevelSchema[] {
  return parsedLevels;
}

export function getLevelById(id: string): LevelSchema {
  const fallback = parsedLevels[0] ?? {
    id: 'empty',
    name: 'Open Space',
    description: 'Bare arena for testing.',
    spawnPoints: [
      { x: 200, y: 200 },
      { x: 600, y: 400 }
    ],
    solids: []
  };
  return parsedLevels.find((level) => level.id === id) ?? fallback;
}

export function getActiveSettings(): GameSettings {
  return { ...activeSettings };
}

export function updateSettings(patch: Partial<GameSettings>): void {
  activeSettings = { ...activeSettings, ...patch };
}

export function cycleLevel(direction: 1 | -1): void {
  if (!parsedLevels.length) return;
  const currentIndex = parsedLevels.findIndex((level) => level.id === activeSettings.levelId);
  const nextIndex = (currentIndex + direction + parsedLevels.length) % parsedLevels.length;
  activeSettings = { ...activeSettings, levelId: parsedLevels[nextIndex].id };
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function clampSetting(
  field: keyof Pick<GameSettings, 'winningScore' | 'energyCount' | 'hazardCount' | 'behaviorPickupCount'>,
  delta: number,
  min: number,
  max: number
): void {
  const current = activeSettings[field] as number;
  const next = clamp(current + delta, min, max);
  activeSettings = { ...activeSettings, [field]: next } as GameSettings;
}
