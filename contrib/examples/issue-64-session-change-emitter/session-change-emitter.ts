/**
 * session-change-emitter.ts
 *
 * A self-contained event emitter that notifies subscribers whenever
 * the wallet session value changes.
 */

export type Session = Record<string, unknown> | null;

export type SessionChangeHandler = (newSession: Session, prevSession: Session) => void;

export type Unsubscribe = () => void;

interface SessionEmitter {
  subscribe: (handler: SessionChangeHandler) => Unsubscribe;
  setSession: (newSession: Session) => void;
  getSession: () => Session;
}

/**
 * Creates a new session change emitter.
 *
 * @returns An object with `subscribe`, `setSession`, and `getSession`.
 *
 * @example
 * const emitter = createSessionEmitter();
 *
 * const unsubscribe = emitter.subscribe((newSession, prevSession) => {
 *   console.log('Session changed:', { newSession, prevSession });
 * });
 *
 * emitter.setSession({ userId: '123', token: 'abc' });
 * unsubscribe(); // stop receiving updates
 */
export function createSessionEmitter(): SessionEmitter {
  let currentSession: Session = null;
  const handlers = new Set<SessionChangeHandler>();

  function subscribe(handler: SessionChangeHandler): Unsubscribe {
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
    };
  }

  function setSession(newSession: Session): void {
    const prevSession = currentSession;
    currentSession = newSession;
    for (const handler of handlers) {
      handler(newSession, prevSession);
    }
  }

  function getSession(): Session {
    return currentSession;
  }

  return { subscribe, setSession, getSession };
}
