export type Seat = 'chair' | 'bed';
export type Stage = 'idle' | 'sitting' | 'seated' | 'drawing' | 'typing' | 'stowing' | 'standing';
export type Intent = 'sit' | 'laptop' | 'stand';

const prefixes: Record<Exclude<Stage, 'idle'>, string> = {
  sitting: 'sit_down', seated: 'seated', drawing: 'laptop_draw', typing: 'typing', stowing: 'laptop_stow', standing: 'stand_up',
};

export class InteractionState {
  seat: Seat = 'chair';
  stage: Stage = 'idle';
  private standAfterStow = false;

  get clip(): string { return this.stage === 'idle' ? 'idle' : `${prefixes[this.stage]}_${this.seat}`; }
  get looping(): boolean { return ['idle', 'seated', 'typing'].includes(this.stage); }

  setSeat(seat: Seat): boolean {
    if (this.stage !== 'idle' || !['chair', 'bed'].includes(seat)) return false;
    this.seat = seat;
    return true;
  }

  can(intent: Intent): boolean {
    return intent === 'sit' ? this.stage === 'idle' : ['seated', 'typing'].includes(this.stage);
  }

  command(intent: Intent): boolean {
    if (!this.can(intent)) return false;
    if (intent === 'sit') this.stage = 'sitting';
    else if (intent === 'laptop') this.stage = this.stage === 'seated' ? 'drawing' : 'stowing';
    else if (this.stage === 'typing') { this.standAfterStow = true; this.stage = 'stowing'; }
    else this.stage = 'standing';
    return true;
  }

  finish(): boolean {
    if (this.looping) return false;
    if (this.stage === 'sitting') this.stage = 'seated';
    else if (this.stage === 'drawing') this.stage = 'typing';
    else if (this.stage === 'stowing') { this.stage = this.standAfterStow ? 'standing' : 'seated'; this.standAfterStow = false; }
    else this.stage = 'idle';
    return true;
  }

  reset(): void { this.stage = 'idle'; this.standAfterStow = false; }
}
