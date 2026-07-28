import { describe, expect, it } from "vitest";
import { AddressBook, DuplicateNameError } from "./address-book";

describe("AddressBook", () => {
  it("adds and looks up an entry", () => {
    const book = new AddressBook();
    book.add("Alice", "GALICE");
    expect(book.lookup("Alice")).toBe("GALICE");
  });

  it("returns undefined for an unknown name rather than throwing", () => {
    const book = new AddressBook();
    expect(book.lookup("Nobody")).toBeUndefined();
  });

  it("rejects adding a duplicate name with a clear error", () => {
    const book = new AddressBook();
    book.add("Alice", "GALICE");
    expect(() => book.add("Alice", "GDIFFERENT")).toThrow(DuplicateNameError);
  });

  it("removes an entry, after which lookup returns undefined", () => {
    const book = new AddressBook();
    book.add("Alice", "GALICE");
    book.remove("Alice");
    expect(book.lookup("Alice")).toBeUndefined();
  });

  it("allows re-adding a name after it was removed", () => {
    const book = new AddressBook();
    book.add("Alice", "GALICE");
    book.remove("Alice");
    expect(() => book.add("Alice", "GNEWADDRESS")).not.toThrow();
    expect(book.lookup("Alice")).toBe("GNEWADDRESS");
  });

  it("removing an unknown name is a no-op", () => {
    const book = new AddressBook();
    expect(() => book.remove("Nobody")).not.toThrow();
  });
});
