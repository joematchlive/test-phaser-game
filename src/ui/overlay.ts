export type ScoreState = {
  id: string;
  label: string;
  value: number;
  color: string;
  dashReady: boolean;
  dashPercent: number;
};

export class Overlay {
  private scoreboard: HTMLDivElement;
  private instructionPanel: HTMLDivElement;
  private instructionToggle: HTMLButtonElement;

  constructor() {
    document.querySelectorAll('.scoreboard, .instruction-panel, .instruction-toggle').forEach((element) =>
      element.remove()
    );

    this.scoreboard = document.createElement('div');
    this.scoreboard.className = 'scoreboard';
    document.body.appendChild(this.scoreboard);

    this.instructionPanel = document.createElement('div');
    this.instructionPanel.className = 'instruction-panel';
    this.instructionPanel.innerHTML = `
      <h3>How to play</h3>
      <ul>
        <li><strong>Player 1:</strong> WASD to move, Shift to Dash</li>
        <li><strong>Player 2:</strong> Arrow Keys to move, Enter to Dash</li>
        <li>Collect green energy orbs (+1) and the rare yellow cores (+3).</li>
        <li>Avoid the hazardous red pulses (-2) and navigate around solid walls.</li>
        <li>Dash gauge shows cooldown. First to reach 10 points wins.</li>
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
      value.textContent = String(score.value);
      row.appendChild(value);

      const dashGauge = document.createElement('div');
      dashGauge.className = 'scoreboard__dash';
      dashGauge.setAttribute('data-ready', String(score.dashReady));
      const dashFill = document.createElement('div');
      dashFill.className = 'scoreboard__dash-fill';
      dashFill.style.width = `${Math.round(score.dashPercent * 100)}%`;
      dashFill.style.background = score.dashReady ? '#2cb67d' : score.color;
      dashGauge.appendChild(dashFill);
      row.appendChild(dashGauge);

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
