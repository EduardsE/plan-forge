import { describe, expect, it } from "vitest";
import { formatLength, formatLengthValue, parseLength } from "./units";

describe("formatLength", () => {
	it("renders meters with two decimals", () => {
		expect(formatLength(6.4, "m")).toBe("6.40 m");
		expect(formatLength(0.5, "m")).toBe("0.50 m");
	});

	it("renders centimeters as whole numbers", () => {
		expect(formatLength(6.4, "cm")).toBe("640 cm");
		expect(formatLength(0.955, "cm")).toBe("96 cm");
	});
});

describe("formatLengthValue", () => {
	it("drops the suffix in both units", () => {
		expect(formatLengthValue(2.8, "m")).toBe("2.80");
		expect(formatLengthValue(2.8, "cm")).toBe("280");
	});
});

describe("parseLength", () => {
	it("reads the typed value in the active unit back to meters", () => {
		expect(parseLength("2.80", "m")).toBe(2.8);
		expect(parseLength("280", "cm")).toBe(2.8);
	});

	it("accepts a decimal comma", () => {
		expect(parseLength("2,5", "m")).toBe(2.5);
	});

	it("rejects junk, zero, and negative lengths", () => {
		expect(parseLength("abc", "m")).toBeNull();
		expect(parseLength("", "m")).toBeNull();
		expect(parseLength("0", "m")).toBeNull();
		expect(parseLength("-3", "cm")).toBeNull();
	});
});
