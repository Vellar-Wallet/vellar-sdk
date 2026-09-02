// Example: a minimal typed event bus — on/off/emit for named events, with
// the payload type for each event name checked at compile time.
//
// Run with: npx tsx simple-event-bus.ts

export type Listener<T> = (payload: T) => void;

/**
 * A typed event bus: `Events` maps each event name to its payload type, so
 * `on`/`off`/`emit` are all checked against the right payload shape for the
 * event name given. Multiple listeners may be registered for the same
 * event; `off` removes only the exact listener reference passed to it,
 * leaving every other listener for that event intact.
 */
export class EventBus<Events extends Record<string, unknown>> {
  private listeners: { [K in keyof Events]?: Set<Listener<Events[K]>> } = {};

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    let set = this.listeners[event];
    if (!set) {
      set = new Set();
      this.listeners[event] = set;
    }
    set.add(listener);
  }

  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    this.listeners[event]?.delete(listener);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    this.listeners[event]?.forEach((listener) => listener(payload));
  }
}

interface WalletEvents {
  deposit: { amount: number };
  logout: undefined;
}

function main() {
  const bus = new EventBus<WalletEvents>();

  const first: Listener<WalletEvents["deposit"]> = (payload) => console.log(`listener A saw deposit of ${payload.amount}`);
  const second: Listener<WalletEvents["deposit"]> = (payload) => console.log(`listener B saw deposit of ${payload.amount}`);

  bus.on("deposit", first);
  bus.on("deposit", second);

  console.log("Emitting with both listeners registered:");
  bus.emit("deposit", { amount: 100 });

  bus.off("deposit", first);

  console.log("\nEmitting after removing listener A:");
  bus.emit("deposit", { amount: 50 });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
