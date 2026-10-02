export type Seat = 'chair' | 'bed';
export type Stage = 'idle' | 'sitting' | 'seated' | 'opening' | 'typing' | 'closing' | 'standing';
export type Intent = 'sit' | 'laptop' | 'stand';

// Opening and closing the laptop have no clip of their own: the character stays seated while the
// laptop appears and opens (or closes and disappears), then types (or rests).
const prefixes: Record<Exclude<Stage, 'idle'>, string> = {
  sitting: 'sit_down', seated: 'seated', opening: 'seated', typing: 'typing', closing: 'seated', standing: 'stand_up',
};

export class InteractionState {
  seat: Seat = 'chair';
  stage: Stage = 'idle';
  private standAfterClose = false;

  get clip(): string { return this.stage === 'idle' ? 'idle' : `${prefixes[this.stage]}_${this.seat}`; }
  get looping(): boolean { return !['sitting', 'standing'].includes(this.stage); }

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
    else if (intent === 'laptop') this.stage = this.stage === 'seated' ? 'opening' : 'closing';
    else if (this.stage === 'typing') { this.standAfterClose = true; this.stage = 'closing'; }
    else this.stage = 'standing';
    return true;
  }

  /** A one-shot clip (sitting down, standing up) ended. */
  finish(): boolean {
    if (this.stage === 'sitting') this.stage = 'seated';
    else if (this.stage === 'standing') this.stage = 'idle';
    else return false;
    return true;
  }

  /** The laptop finished opening (typing starts) or closing (back to resting, or standing up). */
  laptopDone(): boolean {
    if (this.stage === 'opening') this.stage = 'typing';
    else if (this.stage === 'closing') { this.stage = this.standAfterClose ? 'standing' : 'seated'; this.standAfterClose = false; }
    else return false;
    return true;
  }

  reset(): void { this.stage = 'idle'; this.standAfterClose = false; }
}
