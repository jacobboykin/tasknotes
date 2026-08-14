import {
	buildOccurrenceTemplateConversion,
	getOccurrenceDateOverrides,
	getRollingOccurrenceDates,
	isAutomaticOccurrenceTemplate,
} from "../../../src/services/task-service/rollingOccurrencePlanning";
import type { TaskInfo } from "../../../src/types";

const parent = (overrides: Partial<TaskInfo> = {}): TaskInfo => ({
	title: "File report",
	path: "Tasks/File report.md",
	status: "open",
	priority: "normal",
	archived: false,
	recurrence: "DTSTART:20260814;FREQ=DAILY",
	recurrence_anchor: "scheduled",
	occurrence_materialization: "rolling",
	...overrides,
});

describe("rolling occurrence planning", () => {
	it("identifies automatic templates", () => {
		expect(isAutomaticOccurrenceTemplate(parent())).toBe(true);
		expect(isAutomaticOccurrenceTemplate(parent({ occurrence_materialization: undefined }))).toBe(false);
	});
	it("creates every scheduled occurrence regardless of unfinished copies", () => {
		const tasks = [
			parent(),
			{
				...parent(),
				path: "Tasks/File report 2026-08-14.md",
				recurrence: undefined,
				recurrence_parent: "[[Tasks/File report]]",
				occurrence_date: "2026-08-14",
				status: "open",
			},
		];

		expect(
			getRollingOccurrenceDates(parent(), tasks, new Date("2026-08-15T12:00:00Z"))
		).toEqual(["2026-08-15"]);
	});

	it("catches up every occurrence since the latest generated copy", () => {
		const tasks = [
			parent(),
			{
				...parent(),
				path: "Tasks/File report 2026-08-14.md",
				recurrence: undefined,
				recurrence_parent: "[[Tasks/File report]]",
				occurrence_date: "2026-08-14",
			},
		];

		expect(
			getRollingOccurrenceDates(parent(), tasks, new Date("2026-10-14T12:00:00Z"))
		).toHaveLength(61);
	});

	it("creates the first future occurrence so later catch-up has an anchor", () => {
		expect(
			getRollingOccurrenceDates(
				parent({ recurrence: "DTSTART:20260801;FREQ=WEEKLY" }),
				[],
				new Date("2026-08-16T12:00:00Z")
			)
		).toEqual(["2026-08-22"]);
	});

	it("uses the deadline recurrence date and schedules the copy days earlier", () => {
		expect(
			getOccurrenceDateOverrides(parent({ recurrence_start_offset: 3 }), "2026-08-21")
		).toEqual({ scheduled: "2026-08-18", due: "2026-08-21" });

		expect(
			getRollingOccurrenceDates(
				parent({
					recurrence: "DTSTART:20260821;FREQ=WEEKLY",
					recurrence_start_offset: 3,
				}),
				[],
				new Date("2026-08-18T12:00:00Z")
			)
		).toEqual(["2026-08-21"]);
	});

	it("converts the first task dates into template configuration", () => {
		expect(
			buildOccurrenceTemplateConversion(
				parent({
					recurrence: "DTSTART:20260818;FREQ=WEEKLY",
					scheduled: "2026-08-18",
					due: "2026-08-21",
				})
			)
		).toEqual({
			recurrence: "DTSTART:20260821;FREQ=WEEKLY",
			recurrence_start_offset: 3,
			scheduled: undefined,
			due: undefined,
		});
	});
});
