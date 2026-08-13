import { buildTaskEntityContent } from "../../../src/core/taskEntity";

describe("taskEntity", () => {
	it("builds a typed project workspace with useful sections", () => {
		const content = buildTaskEntityContent("project", "Launch site");
		expect(content).toContain("tasknotesType: project");
		expect(content).toContain("title: Launch site");
		expect(content).toContain("## Next actions");
		expect(content).toContain("## Notes");
	});
});
