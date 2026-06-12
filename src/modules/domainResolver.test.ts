import { describe, expect, it, vi } from "vitest";
import { resolveCompanyDomain } from "./domainResolver.js";

vi.mock("node:dns/promises", () => ({
  resolveMx: vi.fn().mockImplementation((domain) => {
    if (domain === "infosys.com") {
      return Promise.resolve([{ exchange: "mx.infosys.com", priority: 10 }]);
    }
    return Promise.reject(new Error("ENOTFOUND"));
  })
}));

describe("resolveCompanyDomain", () => {
  it("trusts user-provided domains first", async () => {
    await expect(resolveCompanyDomain("Example Inc", "https://www.example.com/about")).resolves.toEqual({
      domain: "example.com",
      confidence: 100,
      source: "user_input"
    });
  });

  it("uses the built-in known company map when no domain is provided", async () => {
    await expect(resolveCompanyDomain("OpenAI")).resolves.toEqual({
      domain: "openai.com",
      confidence: 85,
      source: "known_company_map"
    });
  });

  it("cleans title and timeline garbage from scraped company names", async () => {
    await expect(resolveCompanyDomain("Power Programmer Infosys · Full-time")).resolves.toEqual({
      domain: "infosys.com",
      confidence: 55,
      source: "company_name_guess_mx_confirmed"
    });
  });
});

