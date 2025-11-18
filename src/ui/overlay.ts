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
};

type OverlayOptions = {
  targetScore: number;
  negativeLossThreshold?: number;
};

export class Overlay {
  private scoreboard: HTMLDivElement;
  private instructionPanel: HTMLDivElement;
  private instructionToggle: HTMLButtonElement;

  constructor(options?: OverlayOptions) {
    document.querySelectorAll('.scoreboard, .instruction-panel, .instruction-toggle').forEach((element) =>
      element.remove()
    );

    this.scoreboard = document.createElement('div');
    this.scoreboard.className = 'scoreboard';
    document.body.appendChild(this.scoreboard);

    this.instructionPanel = document.createElement('div');
    this.instructionPanel.className = 'instruction-panel';
    const targetScore = options?.targetScore ?? 10;
    const debtLine =
      options?.negativeLossThreshold !== undefined
        ? `<li>Debt matters: hitting ${options.negativeLossThreshold} puts you out immediately. Adjust the floor in Settings.</li>`
        : '';

    this.instructionPanel.innerHTML = `
      <h3>Arena Briefing</h3>
      <p>Race to ${targetScore} energy by scooping power cores, grappling rivals, and dodging hazards.</p>
      <ul>
        <li><strong>Pilot One:</strong> WASD to move, Shift to Dash, E to Grapple.</li>
        <li><strong>Pilot Two:</strong> Arrow Keys to move, Enter to Dash, P to Grapple.</li>
        <li>Dash bars under each score show cooldown progress—wait for a full bar to burst again.</li>
        <li>Green orbs are +1, radiant gold cores are +3. Red pulses subtract 2 and shake your craft.</li>
        <li>Cyan boosters, magenta dampeners, pale prisms, and ember disruptors now appear. Use them for surges, to slow rivals, cloak yourself, or hex the other pilot.</li>
        <li>Rope spools are scarce but restock a grapple charge (you only hold three). Spend hooks wisely.</li>
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

  update(scores: ScoreState[]): void {
    this.scoreboard.innerHTML = '';
    scores.forEach((score) => {
      const row = document.createElement('div');
      row.className = 'scoreboard__row';

      const label = document.createElement('span');
      label.className = 'scoreboard__label';
      label.style.color = score.color;
      label.textContent = score.label;
      row.appendChild(label);

      const value = document.createElement('span');
      value.className = 'scoreboard__value';
      value.textContent = `${score.value}/${score.goal}`;
      row.appendChild(value);

      const meta = document.createElement('div');
      meta.className = 'scoreboard__meta';
      const wins = document.createElement('span');
      wins.innerHTML = `Wins <strong>${score.wins}</strong>`;
      meta.appendChild(wins);
      const hooks = document.createElement('span');
      hooks.innerHTML = `Hooks <strong>${score.hookCharges}/${score.maxHookCharges}</strong>`;
      meta.appendChild(hooks);
      row.appendChild(meta);

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

      this.scoreboard.appendChild(row);
    });
  }

  private toggleInstructions(): void {
    const expanded = this.instructionToggle.getAttribute('aria-expanded') === 'true';
    this.instructionToggle.setAttribute('aria-expanded', String(!expanded));
    this.instructionToggle.textContent = expanded ? 'Show Instructions' : 'Hide Instructions';
    this.instructionPanel.classList.toggle('instruction-panel--visible', !expanded);
  }

  destroy(): void {
    this.scoreboard.remove();
    this.instructionPanel.remove();
    this.instructionToggle.remove();
  }
}
