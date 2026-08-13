import {
	parseChipValues,
	uniqueChipValues,
} from "../../../src/modals/taskModalChipInput";

describe("task modal chip values", () => {
	it("parses, trims, and de-duplicates values without changing their display case", () => {
		expect(parseChipValues(" Work, home, work, , Deep Work ")).toEqual([
			"Work",
			"home",
			"Deep Work",
		]);
	});

	it("preserves the order in which values were selected", () => {
		expect(uniqueChipValues(["goal", "project", "area", "project"])).toEqual([
			"goal",
			"project",
			"area",
		]);
	});

	it("preserves commas inside wiki links", () => {
		expect(parseChipValues("[[Health, Fitness]], [[Work]]")).toEqual([
			"[[Health, Fitness]]",
			"[[Work]]",
		]);
	});
});
