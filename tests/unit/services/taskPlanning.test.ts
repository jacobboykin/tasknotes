import {
	getPlanningList,
	getPlanningStateUpdate,
	getScheduledPlanningUpdate,
	normalizePlanningState,
} from "../../../src/core/taskPlanning";
import { FieldMapper } from "../../../src/core/FieldMapper";
import { DEFAULT_FIELD_MAPPING } from "../../../src/core/defaultFieldMapping";
import { resolveTaskPropertyFrontmatterField } from "../../../src/services/task-service/taskPropertyFrontmatterField";
import { buildTaskPropertyUpdatePlan } from "../../../src/services/task-service/taskPropertyUpdate";

const incomplete = (status: string): boolean => status === "done";

describe("task planning", () => {
	it("normalizes missing and invalid states to anytime", () => {
		expect(normalizePlanningState(undefined)).toBe("anytime");
		expect(normalizePlanningState("later")).toBe("anytime");
		expect(normalizePlanningState("someday")).toBe("someday");
	});

	it("classifies every task into one planning list", () => {
		const base = { status: "open", archived: false };
		expect(getPlanningList({ ...base, planningState: "inbox" }, "2026-08-13", incomplete)).toBe("inbox");
		expect(getPlanningList({ ...base, planningState: "someday" }, "2026-08-13", incomplete)).toBe("someday");
		expect(getPlanningList({ ...base, planningState: "anytime" }, "2026-08-13", incomplete)).toBe("anytime");
		expect(getPlanningList({ ...base, scheduled: "2026-08-13" }, "2026-08-13", incomplete)).toBe("today");
		expect(getPlanningList({ ...base, scheduled: "2026-08-12T09:00" }, "2026-08-13", incomplete)).toBe("today");
		expect(getPlanningList({ ...base, scheduled: "2026-08-14" }, "2026-08-13", incomplete)).toBe("upcoming");
		expect(getPlanningList({ ...base, due: "2026-08-12" }, "2026-08-13", incomplete)).toBe("today");
		expect(getPlanningList({ ...base, due: "2026-08-14" }, "2026-08-13", incomplete)).toBe("upcoming");
		expect(getPlanningList({ ...base, status: "done" }, "2026-08-13", incomplete)).toBe("logbook");
		expect(getPlanningList({ ...base, archived: true }, "2026-08-13", incomplete)).toBe("logbook");
	});

	it("keeps planning states mutually exclusive with scheduled dates", () => {
		expect(getPlanningStateUpdate("someday")).toEqual({
			planningState: "someday",
			scheduled: undefined,
		});
		expect(getPlanningStateUpdate("anytime")).toEqual({
			planningState: "anytime",
			scheduled: undefined,
		});
		expect(getScheduledPlanningUpdate("2026-08-14")).toEqual({
			planningState: "anytime",
			scheduled: "2026-08-14",
		});
	});

	it("round-trips native planning and relationship fields through frontmatter", () => {
		const mapper = new FieldMapper(DEFAULT_FIELD_MAPPING);
		const mapped = mapper.mapFromFrontmatter(
			{
				planning: "someday",
				areas: "[[Work]]",
				goals: ["[[Launch]]"],
				relations: ["[[Brief]]", "[[Meeting]]"],
				projectSection: "Research",
				review: "2026-09-01",
			},
			"Tasks/example.md"
		);

		expect(mapped).toEqual(
			expect.objectContaining({
				planningState: "someday",
				areas: ["[[Work]]"],
				goals: ["[[Launch]]"],
				relations: ["[[Brief]]", "[[Meeting]]"],
				projectSection: "Research",
				reviewDate: "2026-09-01",
			})
		);

		expect(mapper.mapToFrontmatter(mapped)).toEqual(
			expect.objectContaining({
				planning: "someday",
				areas: ["[[Work]]"],
				goals: ["[[Launch]]"],
				relations: ["[[Brief]]", "[[Meeting]]"],
				projectSection: "Research",
				review: "2026-09-01",
			})
		);
	});

	it("maps native property updates to their stable frontmatter names", () => {
		const mapper = new FieldMapper(DEFAULT_FIELD_MAPPING);
		expect(resolveTaskPropertyFrontmatterField(mapper, "planningState")).toBe("planning");
		expect(resolveTaskPropertyFrontmatterField(mapper, "reviewDate")).toBe("review");
	});

	it("keeps direct scheduled and planning updates mutually exclusive", () => {
		const base = {
			title: "Plan",
			status: "open",
			priority: "normal",
			path: "Tasks/Plan.md",
			archived: false,
			planningState: "someday" as const,
		};
		const common = {
			currentTimestamp: "2026-08-13T12:00:00Z",
			currentDateString: "2026-08-13",
			normalizeStatusValue: String,
			isCompletedStatus: () => false,
		};

		expect(
			buildTaskPropertyUpdatePlan({
				...common,
				freshTask: base,
				property: "scheduled",
				value: "2026-08-14",
			}).updatedTask
		).toEqual(expect.objectContaining({ planningState: "anytime", scheduled: "2026-08-14" }));

		expect(
			buildTaskPropertyUpdatePlan({
				...common,
				freshTask: { ...base, scheduled: "2026-08-14" },
				property: "planningState",
				value: "inbox",
			}).updatedTask
		).toEqual(expect.objectContaining({ planningState: "inbox", scheduled: undefined }));
	});
});
