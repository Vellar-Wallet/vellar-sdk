# Simple typed event bus

A minimal event bus — `on`, `off`, `emit` — where `Events` maps each event
name to its payload type, so calls are checked against the right shape at
compile time. Multiple listeners can be registered for the same event name;
`off` removes only the exact listener reference passed to it, leaving every
other listener for that event intact.

## Usage

```ts
import { EventBus } from "./simple-event-bus";

interface WalletEvents {
  deposit: { amount: number };
  logout: undefined;
}

const bus = new EventBus<WalletEvents>();

const onDeposit = (payload: WalletEvents["deposit"]) => console.log(payload.amount);
bus.on("deposit", onDeposit);
bus.emit("deposit", { amount: 100 }); // logs 100

bus.off("deposit", onDeposit); // removes just this listener
```

## Run it

```sh
npx tsx simple-event-bus.ts
```

Expected output:

```
Emitting with both listeners registered:
listener A saw deposit of 100
listener B saw deposit of 100

Emitting after removing listener A:
listener B saw deposit of 50
```

## Tests

```sh
npx vitest run contrib/examples/simple-event-bus
```
