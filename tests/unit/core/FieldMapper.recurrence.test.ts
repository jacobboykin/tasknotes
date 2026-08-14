import { FieldMapper } from "../../../src/core/FieldMapper";
import { DEFAULT_FIELD_MAPPING } from "../../../src/core/defaultFieldMapping";

describe("FieldMapper recurrence start offset", () => {
	it("round-trips a custom mapped offset", () => {
		const mapper = new FieldMapper({
			...DEFAULT_FIELD_MAPPING,
			recurrenceStartOffset: "start_before_deadline",
		});

		expect(
			mapper.mapFromFrontmatter(
				{ title: "Review", start_before_deadline: "3" },
				"Tasks/Review.md"
			).recurrence_start_offset
		).toBe(3);
		expect(
			mapper.mapToFrontmatter({ recurrence_start_offset: 3 })
		).toMatchObject({ start_before_deadline: 3 });
	});
});
