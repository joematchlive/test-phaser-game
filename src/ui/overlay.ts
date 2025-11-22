export type EffectState = {
  label: string;
  percent: number;
  color: string;
};

export type ScoreState = {
  id: string;
  label: string;
  value: number;
  color: string;
  dashReady: boolean;
  dashPercent: number;
  goal: number;
  effects: EffectState[];
  wins: number;
  hookCharges: number;
  maxHookCharges: number;
  surfaceLabel?: string;
  power?: PowerState;
  role?: string;
  roleColor?: string;
  objective?: string;
  currency?: {
    balance: number;
    earned?: number;
  };
};

export type PowerState = {
  label: string;
  ready: boolean;
  hint?: string;
};

export const OVERLAY_POWER_EVENT = 'overlay:power-activate';

type OverlayOptions = {
  targetScore: number;
  negativeLossThreshold?: number;
  modeLabel?: string;
  modeDescription?: string;
  roleDescriptors?: Array<{ id: string; label: string; detail: string; color: string }>;
  timerSeconds?: number;
};

type OverlayUpdateContext = {
  timerRemainingMs?: number;
};

export class Overlay {
  private scoreboard: HTMLDivElement;
  private modeSummary: HTMLDivElement;
  private instructionPanel: HTMLDivElement;
  private instructionToggle: HTMLButtonElement;
  private timerLabel?: HTMLSpanElement;

  constructor(options?: OverlayOptions) {
    document.querySelectorAll('.scoreboard, .instruction-panel, .instruction-toggle, .mode-summary').forEach((element) =>
      element.remove()
    );

    this.modeSummary = document.createElement('div');
    this.modeSummary.className = 'mode-summary';
    const modeTitle = document.createElement('div');
    modeTitle.className = 'mode-summary__title';
    modeTitle.textContent = options?.modeLabel ?? 'Arena Briefing';
    this.modeSummary.appendChild(modeTitle);

    const modeDescription = document.createElement('p');
    modeDescription.className = 'mode-summary__description';
    modeDescription.textContent =
      options?.modeDescription ?? 'Race to the target score by scooping energy while dodging hazards.';
    this.modeSummary.appendChild(modeDescription);

    if (options?.timerSeconds && options.timerSeconds > 0) {
      const timer = document.createElement('div');
      timer.className = 'mode-summary__timer';
      timer.innerHTML = `<strong>Timer</strong> <span>${this.formatTimer(options.timerSeconds * 1000)}</span>`;
      this.timerLabel = timer.querySelector('span') ?? undefined;
      this.modeSummary.appendChild(timer);
    }

    if (options?.roleDescriptors?.length) {
      const roles = document.createElement('div');
      roles.className = 'mode-summary__roles';
      options.roleDescriptors.forEach((role) => {
        const badge = document.createElement('div');
        badge.className = 'mode-summary__role';
        badge.style.setProperty('--role-color', role.color);
        badge.innerHTML = `<strong>${role.label}</strong><span>${role.detail}</span>`;
        roles.appendChild(badge);
      });
      this.modeSummary.appendChild(roles);
    }

    document.body.appendChild(this.modeSummary);

    this.scoreboard = document.createElement('div');
    this.scoreboard.className = 'scoreboard';
    document.body.appendChild(this.scoreboard);

    this.instructionPanel = document.createElement('div');
    this.instructionPanel.className = 'instruction-panel';
    const targetScore = options?.targetScore ?? 10;
    const modeLine = options?.modeDescription ? `<li class="instruction-panel__mode">${options.modeDescription}</li>` : '';
    const debtLine =
      options?.negativeLossThreshold !== undefined
        ? `<li>Debt matters: hitting ${options.negativeLossThreshold} puts you out immediately. Adjust the floor in Settings.</li>`
        : '';

    this.instructionPanel.innerHTML = `
      <h3>Arena Briefing</h3>
      <p>Race to ${targetScore} energy by scooping power cores, grappling rivals, and dodging hazards.</p>
      <ul>
        <li><strong>Pilot One:</strong> WASD to move, Shift to Dash, E to Grapple, R to deploy a collected power.</li>
        <li><strong>Pilot Two:</strong> Arrow Keys to move, Enter to Dash, P to Grapple, O to deploy a collected power.</li>
        <li>Dash bars under each score show cooldown progress—wait for a full bar to burst again.</li>
        <li>Green orbs are +1, radiant gold cores are +3. Red pulses subtract 2 and shake your craft.</li>
        <li>Cyan boosters, magenta dampeners, pale prisms, and ember disruptors now appear. Use them for surges, to slow rivals, cloak yourself, or hex the other pilot.</li>
        <li>Glowing floor plates influence traction—watch the "Surface" label next to your score to know if you're cruising or dragging.</li>
        <li>Power pickups grant single-use tools like Glue Drop. Hold only one at a time and tap the action key or button beside your score to spend it.</li>
        <li>Rope spools are scarce but restock a grapple charge (you only hold three). Spend hooks wisely.</li>
        ${modeLine}
        ${debtLine}
        <li>Neon rings (or the lack of one when cloaked) plus mini bars on the HUD show how long each modifier lasts.</li>
        <li>Moving gates and optional Minefield mode add constant motion to obstacles—watch your positioning.</li>
        <li>Press ESC at any time to head back to the menu and adjust arenas, hazards, score limits, or the active mode.</li>
      </ul>
    `;
    document.body.appendChild(this.instructionPanel);

    this.instructionToggle = document.createElement('button');
    this.instructionToggle.className = 'instruction-toggle';
    this.instructionToggle.type = 'button';
    this.instructionToggle.setAttribute('aria-expanded', 'false');
    this.instructionToggle.textContent = 'Show Instructions';
    this.instructionToggle.addEventListener('click', () => this.toggleInstructions());
    document.body.appendChild(this.instructionToggle);
  }

  update(scores: ScoreState[], context?: OverlayUpdateContext): void {
    if (this.timerLabel && context?.timerRemainingMs !== undefined) {
      this.timerLabel.textContent = this.formatTimer(context.timerRemainingMs);
    }

    this.scoreboard.innerHTML = '';
    scores.forEach((score) => {
      const row = document.createElement('div');
      row.className = 'scoreboard__row';

      const header = document.createElement('div');
      header.className = 'scoreboard__header';

      const label = document.createElement('span');
      label.className = 'scoreboard__label';
      label.style.color = score.color;
      label.textContent = score.label;
      header.appendChild(label);

      if (score.role) {
        const role = document.createElement('span');
        role.className = 'scoreboard__role';
        if (score.roleColor) {
          role.style.setProperty('--role-color', score.roleColor);
        }
        role.textContent = score.role;
        header.appendChild(role);
      }

      row.appendChild(header);

      const value = document.createElement('span');
      value.className = 'scoreboard__value';
      value.textContent = `${score.value}/${score.goal}`;
      row.appendChild(value);

      if (score.objective) {
        const objective = document.createElement('div');
        objective.className = 'scoreboard__objective';
        objective.textContent = score.objective;
        row.appendChild(objective);
      }

      const meta = document.createElement('div');
      meta.className = 'scoreboard__meta';
      const wins = document.createElement('span');
      wins.innerHTML = `Wins <strong>${score.wins}</strong>`;
      meta.appendChild(wins);
      const hooks = document.createElement('span');
      hooks.innerHTML = `Hooks <strong>${score.hookCharges}/${score.maxHookCharges}</strong>`;
      meta.appendChild(hooks);
      if (score.currency) {
        const currency = document.createElement('span');
        currency.className = 'scoreboard__currency';
        currency.innerHTML = `Credits <strong>${score.currency.balance}</strong>${
          score.currency.earned ? ` <em>(+${score.currency.earned})</em>` : ''
        }`;
        meta.appendChild(currency);
      }
      row.appendChild(meta);

      const surface = document.createElement('span');
      surface.className = 'scoreboard__surface';
      surface.textContent = `Surface: ${score.surfaceLabel ?? 'Base Hull'}`;
      row.appendChild(surface);

      const dashGauge = document.createElement('div');
      dashGauge.className = 'scoreboard__dash';
      dashGauge.setAttribute('data-ready', String(score.dashReady));
      const dashFill = document.createElement('div');
      dashFill.className = 'scoreboard__dash-fill';
      dashFill.style.width = `${Math.round(score.dashPercent * 100)}%`;
      dashFill.style.background = score.dashReady ? '#2cb67d' : score.color;
      dashGauge.appendChild(dashFill);
      row.appendChild(dashGauge);

      if (score.effects.length > 0) {
        const effectWrap = document.createElement('div');
        effectWrap.className = 'scoreboard__effects';
        score.effects.forEach((effect) => {
          const effectItem = document.createElement('div');
          effectItem.className = 'scoreboard__effect';
          effectItem.style.setProperty('--effect-color', effect.color);

          const effectLabel = document.createElement('span');
          effectLabel.className = 'scoreboard__effect-label';
          effectLabel.textContent = effect.label;
          effectItem.appendChild(effectLabel);

          const meter = document.createElement('div');
          meter.className = 'scoreboard__effect-meter';
          const fill = document.createElement('div');
          fill.className = 'scoreboard__effect-meter-fill';
          fill.style.width = `${Math.round(effect.percent * 100)}%`;
          fill.style.backgroundColor = effect.color;
          meter.appendChild(fill);
          effectItem.appendChild(meter);

          effectWrap.appendChild(effectItem);
        });
        row.appendChild(effectWrap);
      }

      const powerButton = document.createElement('button');
      powerButton.className = 'scoreboard__power-button';
      powerButton.type = 'button';
      powerButton.disabled = !score.power?.ready;
      powerButton.textContent = score.power
        ? score.power.ready
          ? `Use ${score.power.label}${score.power.hint ? ` (${score.power.hint})` : ''}`
          : `Holding ${score.power.label}`
        : 'No Power';
      powerButton.addEventListener('click', () => {
        if (!score.power?.ready) return;
        window.dispatchEvent(new CustomEvent(OVERLAY_POWER_EVENT, { detail: { playerId: score.id } }));
      });
      row.appendChild(powerButton);

      this.scoreboard.appendChild(row);
    });
  }

  private toggleInstructions(): void {
    const expanded = this.instructionToggle.getAttribute('aria-expanded') === 'true';
    this.instructionToggle.setAttribute('aria-expanded', String(!expanded));
    this.instructionToggle.textContent = expanded ? 'Show Instructions' : 'Hide Instructions';
    this.instructionPanel.classList.toggle('instruction-panel--visible', !expanded);
  }

  private formatTimer(ms: number): string {
    const clamped = Math.max(0, ms);
    const minutes = Math.floor(clamped / 60000);
    const seconds = Math.floor((clamped % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  destroy(): void {
    this.modeSummary.remove();
    this.scoreboard.remove();
    this.instructionPanel.remove();
    this.instructionToggle.remove();
  }
}
