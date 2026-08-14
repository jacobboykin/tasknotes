import type { TaskInfo } from "../../types";
import { generateRecurringInstances } from "../../utils/helpers";
import { parseLinkToPath } from "../../utils/linkUtils";
import { getNextUncompletedOccurrence } from "../../core/recurrence";

const DAY_MS = 86_400_000;

function datePart(value: string | undefined): string | undefined {
	return value?.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
}

function parseDate(value: string): Date {
	const [year, month, day] = value.split("-").map(Number);
	return new Date(Date.UTC(year, month - 1, day));
}

function formatDate(value: Date): string {
	return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number): Date {
	return new Date(value.getTime() + days * DAY_MS);
}

function horizonDays(value: string | undefined, fallback: number): number {
	const match = value?.trim().match(/^P(\d+)([DW])$/i);
	if (!match) return fallback;
	return Number(match[1]) * (match[2].toUpperCase() === "W" ? 7 : 1);
}

function normalizedReference(value: string): string {
	return parseLinkToPath(value)
		.replace(/\\/g, "/")
		.replace(/^\/+/, "")
		.replace(/\.md$/i, "")
		.trim()
		.toLocaleLowerCase();
}

export function isOccurrenceOf(task: TaskInfo, parent: TaskInfo): boolean {
	if (!task.recurrence_parent || !task.occurrence_date) return false;
	const reference = normalizedReference(task.recurrence_parent);
	const parentPath = normalizedReference(parent.path);
	const parentName = normalizedReference(parent.path.split("/").pop() || parent.path);
	return reference === parentPath || reference === parentName;
}

export function isAutomaticOccurrenceTemplate(task: TaskInfo): boolean {
	return Boolean(
		task.recurrence &&
			task.occurrence_materialization &&
			task.occurrence_materialization !== "manual"
	);
}

export function getOccurrenceDateOverrides(
	parent: TaskInfo,
	targetDate: string
): Pick<TaskInfo, "scheduled" | "due"> | Record<string, never> {
	if (parent.recurrence_start_offset === undefined) return {};
	const offset = Math.max(0, Math.floor(parent.recurrence_start_offset));
	return {
		scheduled: formatDate(addDays(parseDate(targetDate.slice(0, 10)), -offset)),
		due: targetDate.slice(0, 10),
	};
}

export function getGeneratedOccurrenceDateOverrides(
	parent: TaskInfo,
	targetDate: string
): Pick<TaskInfo, "scheduled" | "due"> {
	return parent.recurrence_start_offset === undefined
		? { scheduled: targetDate.slice(0, 10), due: undefined }
		: getOccurrenceDateOverrides(parent, targetDate);
}

export function buildOccurrenceTemplateConversion(
	task: TaskInfo
): Pick<TaskInfo, "recurrence" | "recurrence_start_offset" | "scheduled" | "due"> {
	const scheduled = datePart(task.scheduled);
	const due = datePart(task.due);
	let recurrence = task.recurrence;
	let recurrenceStartOffset = task.recurrence_start_offset;

	if (due) {
		const start = scheduled ? parseDate(scheduled) : parseDate(due);
		recurrenceStartOffset = Math.max(
			0,
			Math.round((parseDate(due).getTime() - start.getTime()) / DAY_MS)
		);
		const compactDue = due.replace(/-/g, "");
		recurrence = recurrence?.match(/DTSTART(?:;[^:]*)?:\d{8}/)
			? recurrence.replace(/(DTSTART(?:;[^:]*)?:)\d{8}/, `$1${compactDue}`)
			: recurrence
				? `DTSTART:${compactDue};${recurrence.replace(/^RRULE:/, "")}`
				: recurrence;
	}

	return {
		recurrence,
		recurrence_start_offset: recurrenceStartOffset,
		scheduled: undefined,
		due: undefined,
	};
}

export function getRollingOccurrenceDates(
	parent: TaskInfo,
	allTasks: readonly TaskInfo[],
	today: Date
): string[] {
	if (!parent.recurrence || parent.occurrence_materialization !== "rolling") return [];

	const todayUtc = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
	const existingDates = allTasks
		.filter((task) => isOccurrenceOf(task, parent))
		.map((task) => task.occurrence_date as string)
		.sort();
	const latest = existingDates[existingDates.length - 1];
	const firstPatternDate = latest
		? undefined
		: getNextUncompletedOccurrence(parent, { minOccurrenceDate: formatDate(todayUtc) }) ??
			undefined;
	const start = latest ? addDays(parseDate(latest), 1) : todayUtc;
	const startOffset = Math.max(0, Math.floor(parent.recurrence_start_offset ?? 0));
	const futureDays = Math.max(horizonDays(parent.occurrence_future_horizon, 0), startOffset);
	const normalEnd = addDays(todayUtc, futureDays);
	const end = !latest && firstPatternDate && firstPatternDate > normalEnd
		? firstPatternDate
		: normalEnd;
	if (start > end) return [];

	return generateRecurringInstances(parent, start, end)
		.map(formatDate)
		.filter((date) => !existingDates.includes(date))
		.filter((date) => {
			if (!latest && firstPatternDate && date === formatDate(firstPatternDate)) return true;
			const scheduled = getOccurrenceDateOverrides(parent, date).scheduled ?? date;
			return scheduled <= formatDate(todayUtc) || futureDays > startOffset;
		});
}
