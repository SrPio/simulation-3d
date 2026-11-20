/**
 * Whether Canela comes along: once she is brought from the laptop's app she is there on every later visit, until she
 * is sent home from the same app. Stored as `simulation-3d:dog` ('with-you' | 'home'); blocked storage means she only
 * stays for this visit.
 */
export const DOG_KEY = 'simulation-3d:dog';

type Store = Pick<Storage, 'getItem' | 'setItem'> | undefined;

export function readDog(storage: Store): boolean {
  try {
    return storage?.getItem(DOG_KEY) === 'with-you';
  } catch {
    return false;
  }
}

export function saveDog(storage: Store, withYou: boolean): void {
  try {
    storage?.setItem(DOG_KEY, withYou ? 'with-you' : 'home');
  } catch {
    // Kept for this visit only.
  }
}
