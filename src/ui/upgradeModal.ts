import { PlayerCurrencyState, spendCurrency, UPGRADE_CATALOG, UpgradeDefinition, UpgradeId } from '../state/currency';

type UpgradeModalPlayer = {
  id: string;
  label: string;
  color: string;
  currency: PlayerCurrencyState;
  roundEarnings: number;
};

type UpgradeModalOptions = {
  players: UpgradeModalPlayer[];
  onSpend?: (playerId: string, upgradeId: UpgradeId) => void;
};

export class UpgradeModal {
  private container: HTMLDivElement;
  private resolver?: () => void;
  private acknowledged: Set<string> = new Set();

  constructor(private options: UpgradeModalOptions) {
    document.querySelectorAll('.upgrade-modal').forEach((element) => element.remove());

    this.container = document.createElement('div');
    this.container.className = 'upgrade-modal';
    this.container.innerHTML = `
      <div class="upgrade-modal__panel">
        <header class="upgrade-modal__header">
          <div>
            <p class="upgrade-modal__eyebrow">Round Complete</p>
            <h2 class="upgrade-modal__title">Spend your session credits</h2>
            <p class="upgrade-modal__subtitle">Credits persist while you stay in this session. Spend now or skip to jump back in.</p>
          </div>
          <div class="upgrade-modal__legend">
            <span class="upgrade-modal__legend-pill">Costs</span>
            <span class="upgrade-modal__legend-pill upgrade-modal__legend-pill--earned">Earned this round</span>
          </div>
        </header>
        <div class="upgrade-modal__body"></div>
      </div>
    `;
  }

  open(): Promise<void> {
    return new Promise((resolve) => {
      this.resolver = resolve;
      const body = this.container.querySelector('.upgrade-modal__body');
      if (!body) {
        resolve();
        return;
      }
      this.options.players.forEach((player) => {
        const column = this.buildPlayerColumn(player);
        body.appendChild(column);
      });
      document.body.appendChild(this.container);
    });
  }

  destroy(): void {
    this.container.remove();
  }

  private buildPlayerColumn(player: UpgradeModalPlayer): HTMLElement {
    const column = document.createElement('div');
    column.className = 'upgrade-modal__player';
    column.style.setProperty('--player-color', player.color);

    const header = document.createElement('div');
    header.className = 'upgrade-modal__player-header';
    header.innerHTML = `
      <div>
        <p class="upgrade-modal__player-label">${player.label}</p>
        <p class="upgrade-modal__player-balance">Balance <strong>${player.currency.balance}</strong></p>
      </div>
      <div class="upgrade-modal__badge">
        +${player.roundEarnings}
      </div>
    `;
    column.appendChild(header);

    const list = document.createElement('div');
    list.className = 'upgrade-modal__upgrades';
    UPGRADE_CATALOG.forEach((upgrade) => {
      list.appendChild(this.buildUpgradeCard(player, upgrade));
    });
    column.appendChild(list);

    const footer = document.createElement('div');
    footer.className = 'upgrade-modal__footer';
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'upgrade-modal__skip';
    skip.textContent = 'Ready / Skip';
    skip.addEventListener('click', () => this.handleAcknowledged(player.id));
    footer.appendChild(skip);
    column.appendChild(footer);

    return column;
  }

  private buildUpgradeCard(player: UpgradeModalPlayer, upgrade: UpgradeDefinition): HTMLElement {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'upgrade-modal__upgrade';
    card.setAttribute('data-upgrade-id', upgrade.id);
    card.setAttribute('data-player-id', player.id);

    card.disabled = player.currency.balance < upgrade.cost;

    card.innerHTML = `
      <div class="upgrade-modal__upgrade-header">
        <p class="upgrade-modal__upgrade-label">${upgrade.label}</p>
        <span class="upgrade-modal__cost">-${upgrade.cost}</span>
      </div>
      <p class="upgrade-modal__upgrade-description">${upgrade.description}</p>
    `;

    card.addEventListener('click', () => {
      const success = spendCurrency(player.id, upgrade.id);
      if (!success) {
        card.disabled = true;
        return;
      }
      this.options.onSpend?.(player.id, upgrade.id);
      const balanceLabel = card.closest('.upgrade-modal__player')?.querySelector(
        '.upgrade-modal__player-balance strong'
      );
      if (balanceLabel) {
        balanceLabel.textContent = `${player.currency.balance}`;
      }
      this.refreshPlayerCards(player);
    });

    return card;
  }

  private refreshPlayerCards(player: UpgradeModalPlayer): void {
    const cards = this.container.querySelectorAll<HTMLButtonElement>(
      `.upgrade-modal__upgrade[data-player-id="${player.id}"]`
    );
    cards.forEach((button) => {
      const upgradeId = button.getAttribute('data-upgrade-id') as UpgradeId | null;
      const upgrade = UPGRADE_CATALOG.find((entry) => entry.id === upgradeId);
      if (!upgrade) return;
      button.disabled = player.currency.balance < upgrade.cost;
    });
  }

  private handleAcknowledged(playerId: string): void {
    this.acknowledged.add(playerId);
    if (this.acknowledged.size >= this.options.players.length) {
      this.resolver?.();
      this.destroy();
    }
  }
}
