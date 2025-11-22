export type PlayerCurrencyState = {
  balance: number;
  totalEarned: number;
  recentEarnings?: number;
  queuedUpgrades: UpgradeId[];
};

export type UpgradeDefinition = {
  id: UpgradeId;
  label: string;
  description: string;
  cost: number;
};

export type UpgradeId = 'afterburner' | 'reserve-core' | 'hook-stock';

const balances: Record<string, PlayerCurrencyState> = {};

export const UPGRADE_CATALOG: UpgradeDefinition[] = [
  {
    id: 'afterburner',
    label: 'Afterburner',
    description: 'Boost top speed by 10% next round.',
    cost: 3
  },
  {
    id: 'reserve-core',
    label: 'Reserve Core',
    description: 'Start the next round with +1 energy.',
    cost: 2
  },
  {
    id: 'hook-stock',
    label: 'Hook Stock',
    description: 'Carry an extra grapple charge next round.',
    cost: 2
  }
];

function ensureEntry(playerId: string): PlayerCurrencyState {
  if (!balances[playerId]) {
    balances[playerId] = { balance: 0, totalEarned: 0, recentEarnings: 0, queuedUpgrades: [] };
  }
  return balances[playerId];
}

export function getCurrency(playerId: string): PlayerCurrencyState {
  return ensureEntry(playerId);
}

export function awardCurrency(playerId: string, amount: number): PlayerCurrencyState {
  const entry = ensureEntry(playerId);
  entry.balance += amount;
  entry.totalEarned += amount;
  entry.recentEarnings = amount;
  return entry;
}

export function spendCurrency(playerId: string, upgradeId: UpgradeId): boolean {
  const entry = ensureEntry(playerId);
  const upgrade = UPGRADE_CATALOG.find((item) => item.id === upgradeId);
  if (!upgrade || entry.balance < upgrade.cost) {
    return false;
  }
  entry.balance -= upgrade.cost;
  entry.recentEarnings = 0;
  entry.queuedUpgrades.push(upgrade.id);
  return true;
}

export function pullQueuedUpgrades(playerId: string): UpgradeId[] {
  const entry = ensureEntry(playerId);
  const queued = [...entry.queuedUpgrades];
  entry.queuedUpgrades = [];
  return queued;
}

export function resetRecentEarnings(): void {
  Object.values(balances).forEach((entry) => {
    entry.recentEarnings = 0;
  });
}
