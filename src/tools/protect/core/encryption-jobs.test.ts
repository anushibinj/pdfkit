import { describe, expect, it } from "vitest";
import { encryptJob, passwordCheckJob } from "./encryption-jobs";

describe("encryptJob", () => {
  it("encrypts with AES-256, the same user and owner password, no restrictions", () => {
    expect(encryptJob({ input: "/i.pdf", output: "/o.pdf" }, "s3cret")).toEqual(
      {
        inputFile: "/i.pdf",
        outputFile: "/o.pdf",
        encrypt: {
          userPassword: "s3cret",
          ownerPassword: "s3cret",
          "256bit": {},
        },
      },
    );
  });

  it("never leaves the owner password empty", () => {
    const job = encryptJob({ input: "/i.pdf", output: "/o.pdf" }, "x");
    expect(job.encrypt?.ownerPassword).toBe("x");
  });
});

describe("passwordCheckJob", () => {
  it("checks the exact password, without qpdf's encoding retries", () => {
    expect(passwordCheckJob("/o.pdf", "पासवर्ड")).toEqual({
      inputFile: "/o.pdf",
      password: "पासवर्ड",
      suppressPasswordRecovery: "",
      requiresPassword: "",
    });
  });
});
