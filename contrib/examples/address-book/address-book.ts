// Example: a simple in-memory address book mapping friendly names to
// Stellar addresses, with add, remove, and lookup functions.
//
// Run with: npx tsx address-book.ts

export class DuplicateNameError extends Error {
  constructor(name: string) {
    super(`An address book entry named "${name}" already exists`);
    this.name = "DuplicateNameError";
  }
}

export class AddressBook {
  #entries = new Map<string, string>();

  /** Adds a name -> address mapping. Throws DuplicateNameError if the name
   * is already in use — callers must remove() it first to replace it. */
  add(name: string, address: string): void {
    if (this.#entries.has(name)) {
      throw new DuplicateNameError(name);
    }
    this.#entries.set(name, address);
  }

  /** Looks up an address by name. Returns undefined for an unknown name
   * rather than throwing — a lookup miss is a normal, expected case. */
  lookup(name: string): string | undefined {
    return this.#entries.get(name);
  }

  /** Removes an entry. A no-op if the name doesn't exist. */
  remove(name: string): void {
    this.#entries.delete(name);
  }
}

function main() {
  const book = new AddressBook();

  book.add("Alice", "GALICEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
  console.log("Added Alice.");
  console.log("Lookup Alice:", book.lookup("Alice"));
  console.log("Lookup Unknown:", book.lookup("Unknown"));

  try {
    book.add("Alice", "GDIFFERENTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
  } catch (err) {
    console.log(`Adding duplicate name rejected: ${err instanceof Error ? err.message : String(err)}`);
  }

  book.remove("Alice");
  console.log("Lookup Alice after remove:", book.lookup("Alice"));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
