import { describe, expect, it } from "vitest";
import { getExternalHost } from "../lib/presentation/urls";

describe("getExternalHost", () => {
  it("strips the www prefix from the hostname", () => {
    expect(getExternalHost("https://www.example.com/inscripcio")).toBe(
      "example.com",
    );
  });

  it("keeps subdomains and the port-free hostname", () => {
    expect(getExternalHost("https://inscripcions.mountainrunners.cat/x")).toBe(
      "inscripcions.mountainrunners.cat",
    );
  });
});
